import {
  COMPASS_COMPONENTS,
  CONFLUENCE_ADRS,
  JSM_INCIDENTS,
  SEED_RELEASE_ISSUES
} from './catalog';
import {
  AdrConstraint,
  AdrViolation,
  CompassComponent,
  ConfluenceAdrDoc,
  GraphEdge,
  GraphNode,
  IncidentExposure,
  JiraReleaseIssue,
  JsmIncidentRecord,
  MitigationActionItem,
  ReadinessStatus,
  ReleaseAttestation,
  ShipReadinessReport
} from './types';

export interface IssueWorkspaceState {
  specOverride?: string;
  completedMitigationIds: string[];
  createdSubtaskMap: Record<string, string>;
  resolvedBlockers: string[];
  attestation?: ReleaseAttestation;
}

export interface WorkspaceDataset {
  issues: JiraReleaseIssue[];
  adrs: ConfluenceAdrDoc[];
  incidents: JsmIncidentRecord[];
  components: CompassComponent[];
}

export const DEFAULT_DATASET: WorkspaceDataset = {
  issues: SEED_RELEASE_ISSUES,
  adrs: CONFLUENCE_ADRS,
  incidents: JSM_INCIDENTS,
  components: COMPASS_COMPONENTS
};

/**
 * Normalizes human duration strings (e.g. "2800ms", "15s", "2.5m", "1h") into milliseconds.
 */
export function parseDurationToMs(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase();
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*(ms|msec|s|sec|seconds?|m|min|minutes?|h|hr|hours?|d|days?)?$/);
  if (!match) return null;
  const val = parseFloat(match[1]);
  const unit = match[2] || 'ms';
  if (unit === 'ms' || unit === 'msec') return val;
  if (unit.startsWith('s')) return val * 1000;
  if (unit.startsWith('m')) return val * 60 * 1000;
  if (unit.startsWith('h')) return val * 3600 * 1000;
  if (unit.startsWith('d')) return val * 86400 * 1000;
  return val;
}

/**
 * Normalizes human duration strings into seconds.
 */
export function parseDurationToSec(raw: string): number | null {
  const ms = parseDurationToMs(
    /^\d+(\.\d+)?$/.test(raw.trim()) ? `${raw.trim()}s` : raw
  );
  return ms === null ? null : ms / 1000;
}

export function parsePercentage(raw: string): number | null {
  const cleaned = raw.trim().replace(/%$/, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return parseFloat(cleaned);
}

/**
 * Extracts structured configuration parameters and SQL DDL traits from free-form Jira descriptions, PR diffs, or YAML/properties blocks.
 */
export function extractParametersFromText(specText: string): Record<string, string> {
  const params: Record<string, string> = {};
  const lines = specText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Match key = value or key: value for dotted/underscored config keys
    const kvMatch = line.match(/^([a-zA-Z][a-zA-Z0-9_.-]{2,})\s*(?:=|:)\s*([^\s#;]+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim().toLowerCase();
      const val = kvMatch[2].trim().replace(/^['"]|['"]$/g, '');
      params[key] = val;
    }

    // Detect PostgreSQL index creation mode directly from DDL statements
    if (/create\s+(?:unique\s+)?index\s+concurrently\b/i.test(line)) {
      params['sql.index_mode'] = 'CONCURRENTLY';
    } else if (/create\s+(?:unique\s+)?index\b/i.test(line) && !params['sql.index_mode']) {
      params['sql.index_mode'] = 'STANDARD';
    }

    // Detect SET lock_timeout = '1500ms' in raw SQL
    const lockMatch = line.match(/lock_timeout\s*=\s*['"]?([0-9a-zA-Z.]+)['"]?/i);
    if (lockMatch && !keyExists(params, 'db.migration.lock_timeout')) {
      params['db.migration.lock_timeout'] = lockMatch[1];
    }
  }

  return params;
}

function keyExists(obj: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function evaluateSingleConstraint(
  adr: ConfluenceAdrDoc,
  constraint: AdrConstraint,
  extractedParams: Record<string, string>,
  mitigatedIds: Set<string>
): AdrViolation | null {
  const rawVal = extractedParams[constraint.paramKey.toLowerCase()];
  if (rawVal === undefined) {
    return null;
  }

  const mitigationId = `MIT-${constraint.id}`;
  const isMitigated = mitigatedIds.has(mitigationId) || mitigatedIds.has(constraint.id);

  if (constraint.kind === 'NUMERIC_MAX_MS') {
    const observedMs = parseDurationToMs(rawVal);
    const maxMs = Number(constraint.thresholdValue);
    if (observedMs !== null && observedMs > maxMs) {
      return {
        adrId: adr.id,
        adrTitle: adr.title,
        constraintId: constraint.id,
        severity: constraint.severity,
        paramKey: constraint.paramKey,
        observedRaw: rawVal,
        observedNormalized: observedMs,
        expectedRule: `<= ${maxMs}ms`,
        rationale: constraint.rationale,
        remediationHint: constraint.remediationHint,
        mitigated: isMitigated
      };
    }
  } else if (constraint.kind === 'NUMERIC_MIN_SEC') {
    const observedSec = parseDurationToSec(rawVal);
    const minSec = Number(constraint.thresholdValue);
    if (observedSec !== null && observedSec < minSec) {
      return {
        adrId: adr.id,
        adrTitle: adr.title,
        constraintId: constraint.id,
        severity: constraint.severity,
        paramKey: constraint.paramKey,
        observedRaw: rawVal,
        observedNormalized: observedSec,
        expectedRule: `>= ${minSec}s (${Math.round(minSec / 3600)}h)`,
        rationale: constraint.rationale,
        remediationHint: constraint.remediationHint,
        mitigated: isMitigated
      };
    }
  } else if (constraint.kind === 'NUMERIC_MAX_PERCENT') {
    const observedPct = parsePercentage(rawVal);
    const maxPct = Number(constraint.thresholdValue);
    if (observedPct !== null && observedPct > maxPct) {
      return {
        adrId: adr.id,
        adrTitle: adr.title,
        constraintId: constraint.id,
        severity: constraint.severity,
        paramKey: constraint.paramKey,
        observedRaw: rawVal,
        observedNormalized: observedPct,
        expectedRule: `<= ${maxPct}%`,
        rationale: constraint.rationale,
        remediationHint: constraint.remediationHint,
        mitigated: isMitigated
      };
    }
  } else if (constraint.kind === 'REQUIRED_TOKEN') {
    const expected = String(constraint.thresholdValue).toLowerCase();
    if (rawVal.trim().toLowerCase() !== expected) {
      return {
        adrId: adr.id,
        adrTitle: adr.title,
        constraintId: constraint.id,
        severity: constraint.severity,
        paramKey: constraint.paramKey,
        observedRaw: rawVal,
        observedNormalized: rawVal,
        expectedRule: `== ${constraint.thresholdValue}`,
        rationale: constraint.rationale,
        remediationHint: constraint.remediationHint,
        mitigated: isMitigated
      };
    }
  } else if (constraint.kind === 'FORBIDDEN_TOKEN') {
    const forbidden = String(constraint.thresholdValue).toLowerCase();
    if (rawVal.trim().toLowerCase() === forbidden) {
      return {
        adrId: adr.id,
        adrTitle: adr.title,
        constraintId: constraint.id,
        severity: constraint.severity,
        paramKey: constraint.paramKey,
        observedRaw: rawVal,
        observedNormalized: rawVal,
        expectedRule: `!= ${constraint.thresholdValue}`,
        rationale: constraint.rationale,
        remediationHint: constraint.remediationHint,
        mitigated: isMitigated
      };
    }
  }

  return null;
}

/**
 * Core multi-hop Teamwork Graph traversal + ADR drift & JSM incident readiness evaluator.
 */
export function evaluateIssueReadiness(
  issueKey: string,
  state?: Partial<IssueWorkspaceState>,
  dataset: WorkspaceDataset = DEFAULT_DATASET
): ShipReadinessReport {
  const normalizedKey = issueKey.trim().toUpperCase();
  const issue: JiraReleaseIssue =
    dataset.issues.find((i) => i.key.toUpperCase() === normalizedKey) || {
      key: normalizedKey,
      ari: `ari:cloud:jira:demo:issue/${normalizedKey}`,
      summary: `Custom Release Candidate (${normalizedKey})`,
      issueType: 'Release',
      priority: 'High',
      assignee: 'Unassigned',
      reporter: 'ShipGate Evaluator',
      sprint: 'Active Sprint',
      componentIds: ['comp-checkout-gw'],
      explicitLinkedIds: [],
      openBlockerKeys: [],
      descriptionSpec: state?.specOverride || ''
    };

  const effectiveSpec =
    state?.specOverride !== undefined ? state.specOverride : issue.descriptionSpec;
  const mitigatedSet = new Set(state?.completedMitigationIds || []);
  const subtaskMap = state?.createdSubtaskMap || {};
  const resolvedBlockers = new Set(state?.resolvedBlockers || []);

  const extractedParams = extractParametersFromText(effectiveSpec);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const recommendedReviewers: { name: string; handle: string; reason: string }[] = [];

  // Hop 0: Focal Jira Issue
  nodes.push({
    id: issue.key,
    ari: issue.ari,
    type: 'JIRA_ISSUE',
    label: issue.key,
    subtitle: issue.summary,
    hopDistance: 0,
    riskLevel: 'INFO',
    metadata: {
      priority: issue.priority,
      issueType: issue.issueType,
      sprint: issue.sprint
    }
  });

  // Hop 1: Touched Compass Components + Service Owners (Hop 2)
  const touchedComponents = dataset.components.filter((c) =>
    issue.componentIds.includes(c.id)
  );

  for (const comp of touchedComponents) {
    nodes.push({
      id: comp.id,
      ari: comp.ari,
      type: 'COMPASS_COMPONENT',
      label: comp.name,
      subtitle: `${comp.tier} · ${comp.repoSlug}`,
      hopDistance: 1,
      riskLevel: 'INFO'
    });
    edges.push({
      id: `edge-${issue.key}-${comp.id}`,
      source: issue.key,
      target: comp.id,
      relation: 'TOUCHES_COMPONENT',
      status: 'ACTIVE'
    });

    nodes.push({
      id: comp.ownerId,
      ari: `ari:cloud:identity:demo:user/${comp.ownerId}`,
      type: 'SERVICE_OWNER',
      label: comp.ownerHandle,
      subtitle: comp.ownerName,
      hopDistance: 2,
      riskLevel: 'SAFE'
    });
    edges.push({
      id: `edge-${comp.id}-${comp.ownerId}`,
      source: comp.id,
      target: comp.ownerId,
      relation: 'OWNED_BY',
      status: 'ACTIVE'
    });

    recommendedReviewers.push({
      name: comp.ownerName,
      handle: comp.ownerHandle,
      reason: `Owns ${comp.tier} component ${comp.name}`
    });
  }

  // Hop 1: Upstream Open Blockers
  const activeBlockers: string[] = [];
  const mitigationItems: MitigationActionItem[] = [];

  for (const blockerKey of issue.openBlockerKeys) {
    const mitId = `MIT-BLK-${blockerKey}`;
    const isResolved =
      resolvedBlockers.has(blockerKey) || mitigatedSet.has(mitId);
    if (!isResolved) {
      activeBlockers.push(blockerKey);
    }
    nodes.push({
      id: blockerKey,
      ari: `ari:cloud:jira:demo:issue/${blockerKey}`,
      type: 'JIRA_ISSUE',
      label: blockerKey,
      subtitle: isResolved
        ? 'Upstream SRE Blocker (Mitigated)'
        : 'Open Upstream Blocker Ticket',
      hopDistance: 1,
      riskLevel: isResolved ? 'SAFE' : 'WARNING'
    });
    edges.push({
      id: `edge-${blockerKey}-${issue.key}`,
      source: blockerKey,
      target: issue.key,
      relation: 'BLOCKS_RELEASE',
      status: isResolved ? 'VERIFIED' : 'VIOLATED',
      annotation: isResolved ? 'Cleared' : 'Unresolved blocker'
    });

    mitigationItems.push({
      id: mitId,
      sourceId: blockerKey,
      sourceType: 'BLOCKER',
      severity: 'HIGH',
      summary: `Resolve or link sign-off for upstream blocker ${blockerKey} before production deploy`,
      suggestedAssignee: touchedComponents[0]?.ownerHandle || '@sre-oncall',
      completed: isResolved,
      createdSubtaskKey: subtaskMap[mitId]
    });
  }

  // Hop 2: Governed Confluence ADRs via Component Lineage
  const relevantAdrs = dataset.adrs.filter(
    (adr) =>
      adr.status === 'APPROVED' &&
      adr.componentIds.some((cid) => issue.componentIds.includes(cid))
  );

  const adrViolations: AdrViolation[] = [];
  const compliantAdrs: string[] = [];

  for (const adr of relevantAdrs) {
    const violationsForThisAdr: AdrViolation[] = [];
    for (const constraint of adr.constraints) {
      const violation = evaluateSingleConstraint(
        adr,
        constraint,
        extractedParams,
        mitigatedSet
      );
      if (violation) {
        violationsForThisAdr.push(violation);
        adrViolations.push(violation);

        const mitId = `MIT-${constraint.id}`;
        mitigationItems.push({
          id: mitId,
          sourceId: adr.id,
          sourceType: 'ADR',
          severity: constraint.severity,
          summary: `[${adr.id}] ${constraint.remediationHint}`,
          suggestedAssignee: `@${adr.author.toLowerCase().replace(/\s+/g, '.')}`,
          completed: violation.mitigated,
          createdSubtaskKey: subtaskMap[mitId]
        });
      }
    }

    const unmitigatedCount = violationsForThisAdr.filter((v) => !v.mitigated).length;
    if (unmitigatedCount === 0) {
      compliantAdrs.push(adr.id);
    }

    nodes.push({
      id: adr.id,
      ari: adr.ari,
      type: 'CONFLUENCE_ADR',
      label: adr.id,
      subtitle: adr.title.replace(/^ADR-\d+:\s*/, ''),
      hopDistance: 2,
      riskLevel:
        unmitigatedCount > 0
          ? violationsForThisAdr.some((v) => v.severity === 'CRITICAL' && !v.mitigated)
            ? 'CRITICAL'
            : 'WARNING'
          : 'SAFE',
      metadata: {
        space: adr.spaceKey,
        author: adr.author,
        lastUpdated: adr.lastUpdated
      }
    });

    for (const cid of adr.componentIds) {
      if (issue.componentIds.includes(cid)) {
        edges.push({
          id: `edge-${cid}-${adr.id}`,
          source: cid,
          target: adr.id,
          relation: 'GOVERNED_BY_ADR',
          status: unmitigatedCount > 0 ? 'VIOLATED' : 'VERIFIED',
          annotation:
            unmitigatedCount > 0
              ? `${unmitigatedCount} policy drift`
              : 'ADR compliant'
        });
      }
    }
  }

  // Hop 2: Historical JSM Postmortem Incidents on Shared Components
  const relevantIncidents = dataset.incidents.filter((inc) =>
    inc.componentIds.some((cid) => issue.componentIds.includes(cid))
  );

  const incidentExposures: IncidentExposure[] = [];
  let hiddenUnlinkedRisks = 0;

  for (const inc of relevantIncidents) {
    const touchesTriggerKey = keyExists(
      extractedParams,
      inc.triggerPattern.toLowerCase()
    );
    // An incident is an active exposure if the release modifies the same risk surface or touches a TIER-1 component with historical SEV-1/2 postmortems
    if (!touchesTriggerKey && inc.severity !== 'SEV-1') {
      continue;
    }

    const wasExplicitlyLinked = issue.explicitLinkedIds.includes(inc.id);
    const checks = inc.requiredChecklist.map((chk) => {
      const mitId = `MIT-${chk.id}`;
      const completed = mitigatedSet.has(mitId) || mitigatedSet.has(chk.id);
      mitigationItems.push({
        id: mitId,
        sourceId: inc.id,
        sourceType: 'INCIDENT',
        severity: inc.severity === 'SEV-1' ? 'HIGH' : 'MEDIUM',
        summary: `[${inc.id} Guardrail] ${chk.title}`,
        suggestedAssignee: chk.ownerRole,
        completed,
        createdSubtaskKey: subtaskMap[mitId]
      });
      return {
        ...chk,
        completed,
        createdSubtaskKey: subtaskMap[mitId]
      };
    });

    const pendingChecks = checks.filter((c) => !c.completed);
    if (!wasExplicitlyLinked && pendingChecks.length > 0) {
      hiddenUnlinkedRisks += 1;
    }

    incidentExposures.push({
      incidentId: inc.id,
      incidentTitle: inc.title,
      severity: inc.severity,
      sharedComponentId:
        inc.componentIds.find((cid) => issue.componentIds.includes(cid)) ||
        inc.componentIds[0],
      wasExplicitlyLinked,
      rootCause: inc.rootCause,
      uncompletedChecks: checks
    });

    nodes.push({
      id: inc.id,
      ari: inc.ari,
      type: 'JSM_INCIDENT',
      label: `${inc.id} (${inc.severity})`,
      subtitle: inc.title.replace(/^INC-\d+:\s*/, ''),
      hopDistance: 2,
      riskLevel: pendingChecks.length > 0 ? 'WARNING' : 'SAFE',
      metadata: {
        occurredAt: inc.occurredAt,
        wasExplicitlyLinked
      }
    });

    for (const cid of inc.componentIds) {
      if (issue.componentIds.includes(cid)) {
        edges.push({
          id: `edge-${cid}-${inc.id}`,
          source: cid,
          target: inc.id,
          relation: 'CAUSED_INCIDENT',
          status:
            pendingChecks.length === 0
              ? 'VERIFIED'
              : wasExplicitlyLinked
                ? 'VIOLATED'
                : 'UNLINKED_RISK',
          annotation:
            pendingChecks.length === 0
              ? 'Postmortem checks verified'
              : wasExplicitlyLinked
                ? `${pendingChecks.length} guardrail pending`
                : `Hidden 2-hop incident (${pendingChecks.length} pending)`
        });
      }
    }
  }

  // Optional Release Attestation Node written back to Teamwork Graph / Storage
  if (state?.attestation) {
    const attNodeId = `ATT-${issue.key}`;
    nodes.push({
      id: attNodeId,
      ari: state.attestation.graphEntityAri,
      type: 'RELEASE_ATTESTATION',
      label: 'Release Attested',
      subtitle: `${state.attestation.attestedBy} · ${state.attestation.approverNote}`,
      hopDistance: 1,
      riskLevel: 'SAFE'
    });
    edges.push({
      id: `edge-${issue.key}-${attNodeId}`,
      source: issue.key,
      target: attNodeId,
      relation: 'ATTESTED_BY',
      status: 'VERIFIED',
      annotation: 'Graph attestation recorded'
    });
  }

  // Compute Quantitative Ship Confidence Score (0..100)
  const baseScore = 100;
  let adrPenalty = 0;
  let hasUnmitigatedCriticalAdr = false;

  for (const v of adrViolations) {
    if (v.mitigated) continue;
    if (v.severity === 'CRITICAL') {
      adrPenalty += 26;
      hasUnmitigatedCriticalAdr = true;
    } else if (v.severity === 'HIGH') {
      adrPenalty += 14;
    } else {
      adrPenalty += 8;
    }
  }

  let incidentPenalty = 0;
  for (const exp of incidentExposures) {
    const openCount = exp.uncompletedChecks.filter((c) => !c.completed).length;
    if (openCount > 0) {
      incidentPenalty += exp.severity === 'SEV-1' ? openCount * 9 : openCount * 7;
      if (!exp.wasExplicitlyLinked) {
        incidentPenalty += 4; // Extra blast-radius penalty for unlinked hidden incident lineage
      }
    }
  }

  const blockerPenalty = activeBlockers.length * 12;
  const attestationBonus = state?.attestation ? 4 : 0;

  const rawScore =
    baseScore - adrPenalty - incidentPenalty - blockerPenalty + attestationBonus;
  const confidenceScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  let status: ReadinessStatus = 'SHIP_READY';
  if (hasUnmitigatedCriticalAdr || confidenceScore < 60) {
    status = 'BLOCKED';
  } else if (confidenceScore < 85 || activeBlockers.length > 0) {
    status = 'ACTION_REQUIRED';
  }

  // Update focal issue node risk badge
  nodes[0].riskLevel =
    status === 'BLOCKED'
      ? 'CRITICAL'
      : status === 'ACTION_REQUIRED'
        ? 'WARNING'
        : 'SAFE';

  const violatedEdges = edges.filter(
    (e) => e.status === 'VIOLATED' || e.status === 'UNLINKED_RISK'
  ).length;

  return {
    issueKey: issue.key,
    issueSummary: issue.summary,
    evaluatedAt: new Date().toISOString(),
    confidenceScore,
    status,
    breakdown: {
      baseScore,
      adrPenalty,
      incidentPenalty,
      blockerPenalty,
      attestationBonus,
      finalScore: confidenceScore
    },
    extractedParams,
    adrViolations,
    compliantAdrs,
    incidentExposures,
    mitigationItems,
    recommendedReviewers,
    attestation: state?.attestation,
    graph: {
      nodes,
      edges,
      stats: {
        totalNodes: nodes.length,
        maxHopDepth: Math.max(...nodes.map((n) => n.hopDistance)),
        hiddenUnlinkedRisks,
        violatedEdges
      }
    }
  };
}
