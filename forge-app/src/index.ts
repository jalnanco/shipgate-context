import Resolver from '@forge/resolver';
import {
  DEFAULT_DATASET,
  evaluateIssueReadiness
} from './contextEngine';
import { seedRealisticDemoWorkspace } from './seeder';
import {
  createJiraSubtaskOrSeeded,
  fetchLiveTeamworkGraphContext,
  ForgeKvsStorage,
  ShipGateStorage
} from './teamworkGraphClient';
import { ShipReadinessReport } from './types';

export class ShipGateService {
  constructor(private readonly storage: ShipGateStorage = new ForgeKvsStorage()) {}

  async fetchContextGraph(params: {
    issueKey: string;
    depth?: number;
  }): Promise<ShipReadinessReport & { graphSource: string }> {
    const dataset = (await this.storage.getSeededDataset()) || DEFAULT_DATASET;
    const state = await this.storage.getIssueState(params.issueKey);
    const live = await fetchLiveTeamworkGraphContext(params.issueKey);

    if (live.liveDescription && state.specOverride === undefined) {
      state.specOverride = live.liveDescription;
    }

    const report = evaluateIssueReadiness(params.issueKey, state, dataset);
    const maxDepth = params.depth !== undefined ? Math.max(1, Math.min(3, Number(params.depth))) : 2;
    const filteredNodes = report.graph.nodes.filter((n) => n.hopDistance <= maxDepth);
    const allowedIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = report.graph.edges.filter(
      (e) => allowedIds.has(e.source) && allowedIds.has(e.target)
    );

    return {
      ...report,
      graph: {
        ...report.graph,
        nodes: filteredNodes,
        edges: filteredEdges
      },
      graphSource: live.source
    };
  }

  async verifyAdrCompliance(params: {
    issueKey: string;
    configSpec?: string;
  }): Promise<ShipReadinessReport> {
    const dataset = (await this.storage.getSeededDataset()) || DEFAULT_DATASET;
    const state = await this.storage.getIssueState(params.issueKey);
    if (params.configSpec !== undefined) {
      state.specOverride = params.configSpec;
      await this.storage.saveIssueState(params.issueKey, state);
    }
    return evaluateIssueReadiness(params.issueKey, state, dataset);
  }

  async createMitigationSubtasks(params: {
    issueKey: string;
    mitigationIds?: string[];
  }): Promise<{
    createdSubtasks: { mitigationId: string; subtaskKey: string; mode: string }[];
    updatedReport: ShipReadinessReport;
  }> {
    const dataset = (await this.storage.getSeededDataset()) || DEFAULT_DATASET;
    const state = await this.storage.getIssueState(params.issueKey);
    const initialReport = evaluateIssueReadiness(params.issueKey, state, dataset);

    const targetIds =
      params.mitigationIds && params.mitigationIds.length > 0
        ? params.mitigationIds
        : initialReport.mitigationItems
            .filter((m) => !m.completed)
            .map((m) => m.id);

    const createdSubtasks: {
      mitigationId: string;
      subtaskKey: string;
      mode: string;
    }[] = [];

    let seq = Object.keys(state.createdSubtaskMap).length + 1;
    for (const mitId of targetIds) {
      const item = initialReport.mitigationItems.find((m) => m.id === mitId);
      if (!item) continue;

      if (!state.completedMitigationIds.includes(mitId)) {
        state.completedMitigationIds.push(mitId);
      }

      if (item.sourceType === 'BLOCKER' && !state.resolvedBlockers.includes(item.sourceId)) {
        state.resolvedBlockers.push(item.sourceId);
      }

      if (!state.createdSubtaskMap[mitId]) {
        const created = await createJiraSubtaskOrSeeded(
          params.issueKey,
          item.summary,
          seq++
        );
        state.createdSubtaskMap[mitId] = created.key;
        createdSubtasks.push({
          mitigationId: mitId,
          subtaskKey: created.key,
          mode: created.mode
        });
      }
    }

    await this.storage.saveIssueState(params.issueKey, state);
    const updatedReport = evaluateIssueReadiness(params.issueKey, state, dataset);
    return { createdSubtasks, updatedReport };
  }

  async logReleaseAttestation(params: {
    issueKey: string;
    approverNote: string;
    attestedBy?: string;
  }): Promise<ShipReadinessReport> {
    const dataset = (await this.storage.getSeededDataset()) || DEFAULT_DATASET;
    const state = await this.storage.getIssueState(params.issueKey);
    const current = evaluateIssueReadiness(params.issueKey, state, dataset);

    state.attestation = {
      issueKey: current.issueKey,
      attestedBy: params.attestedBy || 'ShipGate Release Auditor',
      attestedAt: new Date().toISOString(),
      approverNote: params.approverNote,
      scoreAtAttestation: current.confidenceScore,
      graphEntityAri: `ari:cloud:graph:shipgate:attestation/${current.issueKey.toLowerCase()}-${Date.now()}`
    };

    await this.storage.saveIssueState(params.issueKey, state);
    return evaluateIssueReadiness(params.issueKey, state, dataset);
  }

  async seedWorkspace(options?: {
    jiraProjectKey?: string;
    confluenceSpaceId?: string;
  }) {
    return seedRealisticDemoWorkspace(this.storage, options);
  }
}

const defaultService = new ShipGateService();

// 1. Jira Issue Panel Resolver
const panelResolverInstance = new Resolver();

panelResolverInstance.define('getIssueReadiness', async (req) => {
  const issueKey =
    (req.payload as { issueKey?: string })?.issueKey ||
    (req.context as { extension?: { issue?: { key?: string } } })?.extension?.issue?.key ||
    'PAY-482';
  return defaultService.fetchContextGraph({ issueKey, depth: 2 });
});

panelResolverInstance.define('verifyAdrCompliance', async (req) => {
  const { issueKey = 'PAY-482', configSpec } = (req.payload || {}) as {
    issueKey?: string;
    configSpec?: string;
  };
  return defaultService.verifyAdrCompliance({ issueKey, configSpec });
});

panelResolverInstance.define('createMitigationSubtasks', async (req) => {
  const { issueKey = 'PAY-482', mitigationIds } = (req.payload || {}) as {
    issueKey?: string;
    mitigationIds?: string[];
  };
  return defaultService.createMitigationSubtasks({ issueKey, mitigationIds });
});

panelResolverInstance.define('logReleaseAttestation', async (req) => {
  const { issueKey = 'PAY-482', approverNote = 'Verified ADR & incident guardrails' } =
    (req.payload || {}) as { issueKey?: string; approverNote?: string };
  return defaultService.logReleaseAttestation({ issueKey, approverNote });
});

panelResolverInstance.define('seedDemoWorkspace', async (req) => {
  const payload = (req.payload || {}) as {
    jiraProjectKey?: string;
    confluenceSpaceId?: string;
  };
  return defaultService.seedWorkspace(payload);
});

export const panelResolver = panelResolverInstance.getDefinitions();

// 2. Jira Admin Page Resolver (1-Click Judge Sandbox Seeder)
const adminResolverInstance = new Resolver();

adminResolverInstance.define('seedDemoWorkspace', async (req) => {
  const payload = (req.payload || {}) as {
    jiraProjectKey?: string;
    confluenceSpaceId?: string;
  };
  return defaultService.seedWorkspace(payload);
});

adminResolverInstance.define('listSeededCatalog', async () => {
  return DEFAULT_DATASET;
});

export const adminResolver = adminResolverInstance.getDefinitions();

// 3. Rovo Actions & Atlassian MCP Tool Handlers (reusable across rovo:agent and rovo:mcp)
export async function fetchContextGraphAction(payload: {
  issueKey: string;
  depth?: number;
}) {
  return defaultService.fetchContextGraph({
    issueKey: payload.issueKey || 'PAY-482',
    depth: payload.depth
  });
}

export async function verifyAdrComplianceAction(payload: {
  issueKey: string;
  configSpec?: string;
}) {
  return defaultService.verifyAdrCompliance({
    issueKey: payload.issueKey || 'PAY-482',
    configSpec: payload.configSpec
  });
}

export async function createMitigationSubtasksAction(payload: {
  issueKey: string;
  mitigationIds?: string;
}) {
  const parsedIds = payload.mitigationIds
    ? payload.mitigationIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  return defaultService.createMitigationSubtasks({
    issueKey: payload.issueKey || 'PAY-482',
    mitigationIds: parsedIds
  });
}

export async function logReleaseAttestationAction(payload: {
  issueKey: string;
  approverNote: string;
}) {
  return defaultService.logReleaseAttestation({
    issueKey: payload.issueKey || 'PAY-482',
    approverNote: payload.approverNote || 'Attested via ShipGate MCP / Rovo Auditor'
  });
}
