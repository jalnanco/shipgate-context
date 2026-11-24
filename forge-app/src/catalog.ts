import {
  CompassComponent,
  ConfluenceAdrDoc,
  JiraReleaseIssue,
  JsmIncidentRecord
} from './types';

export const COMPASS_COMPONENTS: CompassComponent[] = [
  {
    id: 'comp-checkout-gw',
    ari: 'ari:cloud:compass:demo:component/comp-checkout-gw',
    name: 'checkout-payment-gateway',
    tier: 'TIER-1',
    ownerId: 'owner-mina-park',
    ownerName: 'Mina Park (Staff Payments SRE)',
    ownerHandle: '@mina.park',
    repoSlug: 'acme-pay/checkout-payment-gateway'
  },
  {
    id: 'comp-webhook-idem',
    ari: 'ari:cloud:compass:demo:component/comp-webhook-idem',
    name: 'webhook-idempotency-store',
    tier: 'TIER-1',
    ownerId: 'owner-liam-chen',
    ownerName: 'Liam Chen (Principal Security Architect)',
    ownerHandle: '@liam.chen',
    repoSlug: 'acme-pay/webhook-idempotency-store'
  },
  {
    id: 'comp-ledger-db',
    ari: 'ari:cloud:compass:demo:component/comp-ledger-db',
    name: 'core-ledger-postgres',
    tier: 'TIER-1',
    ownerId: 'owner-elena-rossi',
    ownerName: 'Elena Rossi (Lead Database Reliability Engineer)',
    ownerHandle: '@elena.rossi',
    repoSlug: 'acme-pay/core-ledger-migrations'
  },
  {
    id: 'comp-otel-collector',
    ari: 'ari:cloud:compass:demo:component/comp-otel-collector',
    name: 'observability-otel-gateway',
    tier: 'TIER-2',
    ownerId: 'owner-devon-brooks',
    ownerName: 'Devon Brooks (Platform Observability Lead)',
    ownerHandle: '@devon.brooks',
    repoSlug: 'acme-pay/otel-collector-fleet'
  }
];

export const CONFLUENCE_ADRS: ConfluenceAdrDoc[] = [
  {
    id: 'ADR-014',
    ari: 'ari:cloud:confluence:demo:page/90014',
    title: 'ADR-014: Checkout Upstream Payment Timeout & Circuit-Breaker Ceiling',
    spaceKey: 'ARCH',
    status: 'APPROVED',
    lastUpdated: '2026-06-18',
    author: 'Mina Park',
    componentIds: ['comp-checkout-gw'],
    summary:
      'Synchronous upstream PSP calls inside checkout-payment-gateway must never exceed 3000ms timeout to prevent Tomcat/worker thread-pool starvation during provider brownouts.',
    constraints: [
      {
        id: 'ADR-014-C1',
        paramKey: 'checkout.payment.timeout',
        kind: 'NUMERIC_MAX_MS',
        thresholdValue: 3000,
        unit: 'ms',
        severity: 'CRITICAL',
        rationale:
          'Worker pool holds 256 synchronous slots; timeouts > 3000ms saturate all checkout pods within 18 seconds at peak RPS.',
        remediationHint:
          'Cap checkout.payment.timeout <= 3000ms (e.g., 2800ms) and route slow PSP retries to async webhook reconciliation queue.'
      },
      {
        id: 'ADR-014-C2',
        paramKey: 'checkout.circuit_breaker.enabled',
        kind: 'REQUIRED_TOKEN',
        thresholdValue: 'true',
        severity: 'HIGH',
        rationale:
          'Circuit breaker must remain enabled on synchronous checkout PSP clients so degraded acquirers fail fast.',
        remediationHint: 'Set checkout.circuit_breaker.enabled=true in release configuration.'
      }
    ]
  },
  {
    id: 'ADR-021',
    ari: 'ari:cloud:confluence:demo:page/90021',
    title: 'ADR-021: Payment Webhook Idempotency Key Retention Window',
    spaceKey: 'ARCH',
    status: 'APPROVED',
    lastUpdated: '2026-07-29',
    author: 'Liam Chen',
    componentIds: ['comp-webhook-idem', 'comp-checkout-gw'],
    summary:
      'External PSP webhook delivery retries span up to 24 hours with exponential backoff. Redis idempotency keys must retain state for at least 86400s (24h).',
    constraints: [
      {
        id: 'ADR-021-C1',
        paramKey: 'redis.idempotency.ttl',
        kind: 'NUMERIC_MIN_SEC',
        thresholdValue: 86400,
        unit: 's',
        severity: 'CRITICAL',
        rationale:
          'Expiring idempotency keys earlier than 24h causes delayed PSP webhook retries to execute duplicate captures on customer cards.',
        remediationHint:
          'Set redis.idempotency.ttl >= 24h (86400s); reclaim memory via key-prefix hash compression instead of shortening TTL.'
      }
    ]
  },
  {
    id: 'ADR-033',
    ari: 'ari:cloud:confluence:demo:page/90033',
    title: 'ADR-033: Zero-Downtime PostgreSQL Schema & Index Migration Policy',
    spaceKey: 'DBRE',
    status: 'APPROVED',
    lastUpdated: '2026-08-11',
    author: 'Elena Rossi',
    componentIds: ['comp-ledger-db'],
    summary:
      'All index creations on core ledger tables (>10M rows) must use CONCURRENTLY and enforce db.migration.lock_timeout <= 2000ms.',
    constraints: [
      {
        id: 'ADR-033-C1',
        paramKey: 'sql.index_mode',
        kind: 'REQUIRED_TOKEN',
        thresholdValue: 'CONCURRENTLY',
        severity: 'CRITICAL',
        rationale:
          'Standard CREATE INDEX acquires SHARE lock blocking all INSERT/UPDATE ledger writes until index build completes.',
        remediationHint:
          'Rewrite DDL to CREATE INDEX CONCURRENTLY outside an explicit transaction block.'
      },
      {
        id: 'ADR-033-C2',
        paramKey: 'db.migration.lock_timeout',
        kind: 'NUMERIC_MAX_MS',
        thresholdValue: 2000,
        unit: 'ms',
        severity: 'HIGH',
        rationale:
          'Unbounded lock_timeout queues behind long-running analytics queries and blocks all incoming read/write queries.',
        remediationHint: 'Set db.migration.lock_timeout=1500ms with bounded retry loop.'
      }
    ]
  },
  {
    id: 'ADR-041',
    ari: 'ari:cloud:confluence:demo:page/90041',
    title: 'ADR-041: Progressive Canary Rollout Ceiling for Fleet Collectors',
    spaceKey: 'PLAT',
    status: 'APPROVED',
    lastUpdated: '2026-09-04',
    author: 'Devon Brooks',
    componentIds: ['comp-otel-collector'],
    summary:
      'Initial stage-1 canary rollout traffic for telemetry collectors must not exceed 25% of production ingest.',
    constraints: [
      {
        id: 'ADR-041-C1',
        paramKey: 'rollout.canary_percent',
        kind: 'NUMERIC_MAX_PERCENT',
        thresholdValue: 25,
        unit: '%',
        severity: 'MEDIUM',
        rationale: 'Limits telemetry backpressure blast radius to <= 25% on initial deploy.',
        remediationHint: 'Keep rollout.canary_percent <= 25% for stage-1 canary.'
      }
    ]
  }
];

export const JSM_INCIDENTS: JsmIncidentRecord[] = [
  {
    id: 'INC-402',
    ari: 'ari:cloud:jira:demo:incident/INC-402',
    title: 'INC-402: Black Friday Checkout Pod Thread-Pool Collapse (43m SEV-1 Outage)',
    severity: 'SEV-1',
    occurredAt: '2026-05-14',
    componentIds: ['comp-checkout-gw'],
    rootCause:
      'Hotfix raised upstream PSP timeout from 2.5s to 12s during acquirer latency spike, exhausting all 256 synchronous checkout threads across 18 pods.',
    triggerPattern: 'checkout.payment.timeout',
    requiredChecklist: [
      {
        id: 'CHK-402-1',
        title: 'Run k6 brownout load test verifying p99 thread saturation < 65% under 4s PSP latency injection',
        ownerRole: 'Payments SRE (@mina.park)'
      },
      {
        id: 'CHK-402-2',
        title: 'Verify async fallback webhook reconciler queue depth alert is armed in PagerDuty',
        ownerRole: 'Release Engineer'
      }
    ]
  },
  {
    id: 'INC-519',
    ari: 'ari:cloud:jira:demo:incident/INC-519',
    title: 'INC-519: Duplicate Card Captures on Delayed Adyen Webhook Retries',
    severity: 'SEV-1',
    occurredAt: '2026-07-02',
    componentIds: ['comp-webhook-idem'],
    rootCause:
      'Redis TTL eviction removed idempotency tokens after 15 minutes while PSP retried webhooks 4 hours after network partition.',
    triggerPattern: 'redis.idempotency.ttl',
    requiredChecklist: [
      {
        id: 'CHK-519-1',
        title: 'Replay 24h delayed webhook fixture suite against staging idempotency cluster',
        ownerRole: 'Security & Payments QA (@liam.chen)'
      }
    ]
  },
  {
    id: 'INC-608',
    ari: 'ari:cloud:jira:demo:incident/INC-608',
    title: 'INC-608: Ledger Write Freeze from Blocking Index DDL Migration',
    severity: 'SEV-2',
    occurredAt: '2026-08-03',
    componentIds: ['comp-ledger-db'],
    rootCause:
      'Flyway migration ran non-concurrent CREATE INDEX without lock_timeout on 85M-row ledger_entries table, stalling writes for 11 minutes.',
    triggerPattern: 'sql.index_mode',
    requiredChecklist: [
      {
        id: 'CHK-608-1',
        title: 'Validate migration script with pg_stat_activity lock-observer on production clone',
        ownerRole: 'DBRE (@elena.rossi)'
      }
    ]
  }
];

export const SEED_RELEASE_ISSUES: JiraReleaseIssue[] = [
  {
    key: 'PAY-482',
    ari: 'ari:cloud:jira:demo:issue/PAY-482',
    summary: 'Increase Checkout PSP Retry Timeout to 15s for Holiday Flash Sale',
    issueType: 'Release',
    priority: 'Highest',
    assignee: 'Alex Rivera',
    reporter: 'Jordan Vance',
    sprint: 'FY26-Q4 Holiday Readiness',
    componentIds: ['comp-checkout-gw'],
    explicitLinkedIds: [],
    openBlockerKeys: ['SRE-118'],
    descriptionSpec: [
      'Release candidate config change for holiday flash-sale traffic:',
      'checkout.payment.timeout = 15s',
      'checkout.circuit_breaker.enabled = false',
      'rollout.region = us-east-1,eu-central-1',
      '',
      'Goal: reduce false timeout declines when secondary European PSP responds slowly.'
    ].join('\n')
  },
  {
    key: 'AUTH-319',
    ari: 'ari:cloud:jira:demo:issue/AUTH-319',
    summary: 'Reduce Webhook Idempotency Redis TTL to 10m to Cut ElastiCache Memory 40%',
    issueType: 'Story',
    priority: 'High',
    assignee: 'Samira Patel',
    reporter: 'Chris Park',
    sprint: 'Infra Cost Efficiency W47',
    componentIds: ['comp-webhook-idem'],
    explicitLinkedIds: ['ADR-021'],
    openBlockerKeys: [],
    descriptionSpec: [
      'Memory optimization proposal on webhook-idempotency-store:',
      'redis.idempotency.ttl = 10m',
      'redis.compression = zstd',
      '',
      'Expected savings: $1,900/mo across primary + replica shards.'
    ].join('\n')
  },
  {
    key: 'DATA-704',
    ari: 'ari:cloud:jira:demo:issue/DATA-704',
    summary: 'Add Composite Reconciliation Index on ledger_entries During Tuesday Deploy',
    issueType: 'Task',
    priority: 'Highest',
    assignee: 'Taylor Kim',
    reporter: 'Elena Rossi',
    sprint: 'Ledger Settlement v4.2',
    componentIds: ['comp-ledger-db'],
    explicitLinkedIds: [],
    openBlockerKeys: [],
    descriptionSpec: [
      'Flyway V20261124__add_ledger_recon_idx.sql:',
      'CREATE INDEX idx_ledger_merchant_settled ON ledger_entries (merchant_id, settled_at);',
      'sql.index_mode = STANDARD',
      'db.migration.lock_timeout = 15000ms'
    ].join('\n')
  },
  {
    key: 'OBS-910',
    ari: 'ari:cloud:jira:demo:issue/OBS-910',
    summary: 'Roll Out OpenTelemetry Tail-Based Error Sampling at 10% Stage-1 Canary',
    issueType: 'Release',
    priority: 'Medium',
    assignee: 'Devon Brooks',
    reporter: 'Devon Brooks',
    sprint: 'Platform Observability Q4',
    componentIds: ['comp-otel-collector'],
    explicitLinkedIds: ['ADR-041'],
    openBlockerKeys: [],
    descriptionSpec: [
      'Stage-1 progressive delivery for tail-based trace sampling:',
      'rollout.canary_percent = 10%',
      'otel.tail_sampling.error_keep = 100%'
    ].join('\n')
  }
];
