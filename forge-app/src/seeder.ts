import api, { route } from '@forge/api';
import { DEFAULT_DATASET } from './contextEngine';
import { ShipGateStorage } from './teamworkGraphClient';

export interface SeedWorkspaceResult {
  seededAt: string;
  seededIssues: string[];
  seededAdrs: string[];
  seededIncidents: string[];
  cloudProvisionedCount: number;
  storageBackend: 'forge-hosted-kvs';
}

/**
 * 1-Click Judge's Sandbox Seeder:
 * Populates Forge Hosted Storage (@forge/kvs) with 4 realistic software release tickets,
 * 4 Confluence ADRs, 3 JSM SEV-1/SEV-2 postmortems, and Compass service ownership lineage.
 * If a target Jira projectKey / Confluence spaceId is supplied on a live tenant, also provisions real cloud entities.
 */
export async function seedRealisticDemoWorkspace(
  storage: ShipGateStorage,
  options?: { jiraProjectKey?: string; confluenceSpaceId?: string }
): Promise<SeedWorkspaceResult> {
  await storage.saveSeededDataset(DEFAULT_DATASET);

  // Reset per-issue states so judges get a crisp repeatable baseline
  for (const issue of DEFAULT_DATASET.issues) {
    await storage.saveIssueState(issue.key, {
      completedMitigationIds: [],
      createdSubtaskMap: {},
      resolvedBlockers: []
    });
  }

  let cloudProvisionedCount = 0;

  if (options?.jiraProjectKey) {
    for (const sample of DEFAULT_DATASET.issues) {
      try {
        const res = await api.asUser().requestJira(route`/rest/api/3/issue`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: {
              project: { key: options.jiraProjectKey },
              summary: `[ShipGate Demo] ${sample.summary}`,
              issuetype: { name: 'Task' },
              description: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: sample.descriptionSpec }]
                  }
                ]
              }
            }
          })
        });
        if (res.ok) cloudProvisionedCount += 1;
      } catch {
        // Ignore if project lacks Task issueType; KVS seed remains 100% functional
      }
    }
  }

  if (options?.confluenceSpaceId) {
    for (const adr of DEFAULT_DATASET.adrs) {
      try {
        const res = await api.asUser().requestConfluence(route`/wiki/api/v2/pages`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            spaceId: options.confluenceSpaceId,
            status: 'current',
            title: adr.title,
            body: {
              representation: 'storage',
              value: `<p><strong>Status:</strong> ${adr.status}</p><p>${adr.summary}</p>`
            }
          })
        });
        if (res.ok) cloudProvisionedCount += 1;
      } catch {
        // KVS seed remains authoritative fallback
      }
    }
  }

  return {
    seededAt: new Date().toISOString(),
    seededIssues: DEFAULT_DATASET.issues.map((i) => i.key),
    seededAdrs: DEFAULT_DATASET.adrs.map((a) => a.id),
    seededIncidents: DEFAULT_DATASET.incidents.map((inc) => inc.id),
    cloudProvisionedCount,
    storageBackend: 'forge-hosted-kvs'
  };
}
