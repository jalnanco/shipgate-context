export type GraphNodeType =
  | 'JIRA_ISSUE'
  | 'CONFLUENCE_ADR'
  | 'JSM_INCIDENT'
  | 'COMPASS_COMPONENT'
  | 'SERVICE_OWNER'
  | 'RELEASE_ATTESTATION';

export type GraphEdgeRelation =
  | 'TOUCHES_COMPONENT'
  | 'GOVERNED_BY_ADR'
  | 'CAUSED_INCIDENT'
  | 'BLOCKS_RELEASE'
  | 'OWNED_BY'
  | 'MITIGATED_BY'
  | 'ATTESTED_BY';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type ReadinessStatus = 'SHIP_READY' | 'ACTION_REQUIRED' | 'BLOCKED';

export interface GraphNode {
  id: string;
  ari: string;
  type: GraphNodeType;
  label: string;
  subtitle: string;
  url?: string;
  hopDistance: number;
  riskLevel: 'CRITICAL' | 'WARNING' | 'SAFE' | 'INFO';
  metadata?: Record<string, string | number | boolean>;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: GraphEdgeRelation;
  status: 'VIOLATED' | 'UNLINKED_RISK' | 'VERIFIED' | 'ACTIVE';
  annotation?: string;
}

export type AdrConstraintKind =
  | 'NUMERIC_MAX_MS'
  | 'NUMERIC_MIN_SEC'
  | 'REQUIRED_TOKEN'
  | 'FORBIDDEN_TOKEN'
  | 'NUMERIC_MAX_PERCENT';

export interface AdrConstraint {
  id: string;
  paramKey: string;
  kind: AdrConstraintKind;
  thresholdValue: number | string;
  unit?: string;
  severity: Severity;
  rationale: string;
  remediationHint: string;
}

export interface ConfluenceAdrDoc {
  id: string;
  ari: string;
  title: string;
  spaceKey: string;
  status: 'APPROVED' | 'SUPERSEDED';
  lastUpdated: string;
  author: string;
  componentIds: string[];
  summary: string;
  constraints: AdrConstraint[];
}

export interface JsmIncidentRecord {
  id: string;
  ari: string;
  title: string;
  severity: 'SEV-1' | 'SEV-2';
  occurredAt: string;
  componentIds: string[];
  rootCause: string;
  triggerPattern: string;
  requiredChecklist: {
    id: string;
    title: string;
    ownerRole: string;
  }[];
}

export interface CompassComponent {
  id: string;
  ari: string;
  name: string;
  tier: 'TIER-1' | 'TIER-2';
  ownerId: string;
  ownerName: string;
  ownerHandle: string;
  repoSlug: string;
}

export interface JiraReleaseIssue {
  key: string;
  ari: string;
  summary: string;
  issueType: 'Release' | 'Story' | 'Task';
  priority: 'Highest' | 'High' | 'Medium';
  assignee: string;
  reporter: string;
  sprint: string;
  componentIds: string[];
  explicitLinkedIds: string[];
  openBlockerKeys: string[];
  descriptionSpec: string;
}

export interface AdrViolation {
  adrId: string;
  adrTitle: string;
  constraintId: string;
  severity: Severity;
  paramKey: string;
  observedRaw: string;
  observedNormalized: number | string;
  expectedRule: string;
  rationale: string;
  remediationHint: string;
  mitigated: boolean;
}

export interface IncidentExposure {
  incidentId: string;
  incidentTitle: string;
  severity: 'SEV-1' | 'SEV-2';
  sharedComponentId: string;
  wasExplicitlyLinked: boolean;
  rootCause: string;
  uncompletedChecks: {
    id: string;
    title: string;
    ownerRole: string;
    completed: boolean;
    createdSubtaskKey?: string;
  }[];
}

export interface MitigationActionItem {
  id: string;
  sourceId: string;
  sourceType: 'ADR' | 'INCIDENT' | 'BLOCKER';
  severity: Severity;
  summary: string;
  suggestedAssignee: string;
  completed: boolean;
  createdSubtaskKey?: string;
}

export interface ReleaseAttestation {
  issueKey: string;
  attestedBy: string;
  attestedAt: string;
  approverNote: string;
  scoreAtAttestation: number;
  graphEntityAri: string;
}

export interface ScoreBreakdown {
  baseScore: number;
  adrPenalty: number;
  incidentPenalty: number;
  blockerPenalty: number;
  attestationBonus: number;
  finalScore: number;
}

export interface ShipReadinessReport {
  issueKey: string;
  issueSummary: string;
  evaluatedAt: string;
  confidenceScore: number;
  status: ReadinessStatus;
  breakdown: ScoreBreakdown;
  extractedParams: Record<string, string>;
  adrViolations: AdrViolation[];
  compliantAdrs: string[];
  incidentExposures: IncidentExposure[];
  mitigationItems: MitigationActionItem[];
  recommendedReviewers: {
    name: string;
    handle: string;
    reason: string;
  }[];
  attestation?: ReleaseAttestation;
  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    stats: {
      totalNodes: number;
      maxHopDepth: number;
      hiddenUnlinkedRisks: number;
      violatedEdges: number;
    };
  };
}
