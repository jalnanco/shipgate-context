import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { DEFAULT_DATASET, IssueWorkspaceState, WorkspaceDataset } from './contextEngine';

export const SHIPGATE_TWG_QUERY = `
  query ShipGateBlastRadius($issueAri: ID!) {
    graph {
      node(id: $issueAri) {
        id
        ... on JiraIssue {
          key
          summary
          links {
            edges {
              relationshipType
              node {
                id
                __typename
              }
            }
          }
        }
      }
    }
  }
`;

export interface ShipGateStorage {
  getIssueState(issueKey: string): Promise<IssueWorkspaceState>;
  saveIssueState(issueKey: string, state: IssueWorkspaceState): Promise<void>;
  getSeededDataset(): Promise<WorkspaceDataset | null>;
  saveSeededDataset(dataset: WorkspaceDataset): Promise<void>;
}

export class ForgeKvsStorage implements ShipGateStorage {
  async getIssueState(issueKey: string): Promise<IssueWorkspaceState> {
    const key = `shipgate:state:${issueKey.toUpperCase()}`;
    const stored = (await kvs.get(key)) as IssueWorkspaceState | undefined;
    return (
      stored || {
        completedMitigationIds: [],
        createdSubtaskMap: {},
        resolvedBlockers: []
      }
    );
  }

  async saveIssueState(issueKey: string, state: IssueWorkspaceState): Promise<void> {
    const key = `shipgate:state:${issueKey.toUpperCase()}`;
    await kvs.set(key, state);
  }

  async getSeededDataset(): Promise<WorkspaceDataset | null> {
    const stored = (await kvs.get('shipgate:workspace:dataset')) as
      | WorkspaceDataset
      | undefined;
    return stored || null;
  }

  async saveSeededDataset(dataset: WorkspaceDataset): Promise<void> {
    await kvs.set('shipgate:workspace:dataset', dataset);
  }
}

export class InMemoryShipGateStorage implements ShipGateStorage {
  private states = new Map<string, IssueWorkspaceState>();
  private dataset: WorkspaceDataset | null = DEFAULT_DATASET;

  async getIssueState(issueKey: string): Promise<IssueWorkspaceState> {
    const existing = this.states.get(issueKey.toUpperCase());
    if (!existing) {
      return {
        completedMitigationIds: [],
        createdSubtaskMap: {},
        resolvedBlockers: []
      };
    }
    return JSON.parse(JSON.stringify(existing));
  }

  async saveIssueState(issueKey: string, state: IssueWorkspaceState): Promise<void> {
    this.states.set(issueKey.toUpperCase(), JSON.parse(JSON.stringify(state)));
  }

  async getSeededDataset(): Promise<WorkspaceDataset | null> {
    return this.dataset;
  }

  async saveSeededDataset(dataset: WorkspaceDataset): Promise<void> {
    this.dataset = JSON.parse(JSON.stringify(dataset));
  }
}

/**
 * Queries Atlassian Teamwork Graph GraphQL API via @forge/api requestTeamworkGraph,
 * enriching local seeded lineage with live tenant graph edges when running inside Atlassian Cloud.
 */
export async function fetchLiveTeamworkGraphContext(issueKey: string): Promise<{
  liveConnectedAris: string[];
  liveDescription?: string;
  source: 'atlassian-twg-live' | 'forge-hosted-kvs';
}> {
  try {
    const jiraRes = await api
      .asUser()
      .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description`, {
        headers: { Accept: 'application/json' }
      });

    if (!jiraRes.ok) {
      return { liveConnectedAris: [], source: 'forge-hosted-kvs' };
    }

    const issueJson = await jiraRes.json();
    const issueAri =
      issueJson?.id
        ? `ari:cloud:jira::issue/${issueJson.id}`
        : `ari:cloud:jira:demo:issue/${issueKey}`;

    const twgRes = await api
      .asUser()
      .requestTeamworkGraph(
        SHIPGATE_TWG_QUERY,
        { issueAri },
        'ShipGateBlastRadius'
      );

    const liveConnectedAris: string[] = [];
    if (twgRes.ok) {
      const twgBody = await twgRes.json();
      const edges = twgBody?.data?.graph?.node?.links?.edges || [];
      for (const edge of edges) {
        if (edge?.node?.id) {
          liveConnectedAris.push(String(edge.node.id));
        }
      }
    }

    const plainDesc = extractPlainTextFromAdf(issueJson?.fields?.description);
    return {
      liveConnectedAris,
      liveDescription: plainDesc || undefined,
      source: 'atlassian-twg-live'
    };
  } catch {
    return { liveConnectedAris: [], source: 'forge-hosted-kvs' };
  }
}

/**
 * Creates a real Jira subtask when running on an authenticated Jira Cloud site,
 * falling back deterministically to a Forge KVS subtask key in sandbox/seeded mode.
 */
export async function createJiraSubtaskOrSeeded(
  parentIssueKey: string,
  summary: string,
  indexSuffix: number
): Promise<{ key: string; mode: 'jira-rest-v3' | 'forge-kvs-sandbox' }> {
  try {
    const projectKey = parentIssueKey.split('-')[0] || 'SHIP';
    const response = await api.asUser().requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          parent: { key: parentIssueKey },
          summary,
          issuetype: { name: 'Sub-task' }
        }
      })
    });
    if (response.ok) {
      const data = await response.json();
      if (data?.key) {
        return { key: String(data.key), mode: 'jira-rest-v3' };
      }
    }
  } catch {
    // Runs seamlessly in Forge KVS sandbox when parent key is a demo seed key
  }
  const projectPrefix = parentIssueKey.split('-')[0] || 'SHIP';
  return {
    key: `${projectPrefix}-MIT-${indexSuffix}`,
    mode: 'forge-kvs-sandbox'
  };
}

function extractPlainTextFromAdf(adfNode: unknown): string {
  if (!adfNode || typeof adfNode !== 'object') return '';
  const node = adfNode as { text?: string; content?: unknown[] };
  let out = node.text || '';
  if (Array.isArray(node.content)) {
    out += node.content.map(extractPlainTextFromAdf).join('\n');
  }
  return out.trim();
}
