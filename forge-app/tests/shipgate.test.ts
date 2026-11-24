import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FullValidationProcessor } from '@forge/manifest';
import {
  evaluateIssueReadiness,
  extractParametersFromText,
  parseDurationToMs,
  parseDurationToSec
} from '../src/contextEngine';
import { InMemoryShipGateStorage } from '../src/teamworkGraphClient';
import { ShipGateService } from '../src/index';

describe('ShipGate Context — Forge Engine & Manifest Verification Suite', () => {
  it('1. passes official @forge/manifest FullValidationProcessor with 0 errors', async () => {
    const manifestPath = path.resolve(__dirname, '..', 'manifest.yml');
    const result = await new FullValidationProcessor({}).process(manifestPath);
    assert.equal(result.success, true, `Expected manifest valid, got: ${JSON.stringify(result.errors)}`);
    assert.equal(result.errors.length, 0);
  });

  it('2. normalizes duration units across ms, s, m, h, and d accurately', () => {
    assert.equal(parseDurationToMs('2800ms'), 2800);
    assert.equal(parseDurationToMs('15s'), 15000);
    assert.equal(parseDurationToMs('2.5m'), 150000);
    assert.equal(parseDurationToSec('10m'), 600);
    assert.equal(parseDurationToSec('24h'), 86400);
    assert.equal(parseDurationToSec('2d'), 172800);
  });

  it('3. extracts dotted configuration keys and PostgreSQL index DDL lock traits', () => {
    const ddlSpec = [
      'CREATE INDEX idx_ledger_settled ON ledger_entries (settled_at);',
      'SET lock_timeout = "1500ms";',
      'rollout.canary_percent: 15%'
    ].join('\n');
    const params = extractParametersFromText(ddlSpec);
    assert.equal(params['sql.index_mode'], 'STANDARD');
    assert.equal(params['db.migration.lock_timeout'], '1500ms');
    assert.equal(params['rollout.canary_percent'], '15%');

    const concurrentSpec = 'CREATE UNIQUE INDEX CONCURRENTLY idx_safe ON ledger_entries (id);';
    assert.equal(extractParametersFromText(concurrentSpec)['sql.index_mode'], 'CONCURRENTLY');
  });

  it('4. blocks PAY-482 due to ADR-014 CRITICAL timeout drift, open blocker SRE-118, and hidden 2-hop INC-402', () => {
    const report = evaluateIssueReadiness('PAY-482');
    assert.equal(report.status, 'BLOCKED');
    assert.ok(report.confidenceScore < 60, `Expected score < 60, got ${report.confidenceScore}`);
    assert.equal(report.adrViolations.length, 2);
    assert.equal(report.adrViolations[0].adrId, 'ADR-014');
    assert.equal(report.adrViolations[0].severity, 'CRITICAL');
    assert.equal(report.graph.stats.hiddenUnlinkedRisks, 1);
    assert.equal(report.incidentExposures[0].incidentId, 'INC-402');
    assert.equal(report.incidentExposures[0].wasExplicitlyLinked, false);
    assert.equal(report.recommendedReviewers[0].handle, '@mina.park');
  });

  it('5. detects AUTH-319 webhook idempotency Redis TTL violation against ADR-021 and INC-519', () => {
    const report = evaluateIssueReadiness('AUTH-319');
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.adrViolations.length, 1);
    assert.equal(report.adrViolations[0].adrId, 'ADR-021');
    assert.equal(report.adrViolations[0].observedNormalized, 600);
    assert.equal(report.incidentExposures[0].incidentId, 'INC-519');
  });

  it('6. blocks DATA-704 non-concurrent PostgreSQL index migration and unlocks when rewritten to CONCURRENTLY', () => {
    const blocked = evaluateIssueReadiness('DATA-704');
    assert.equal(blocked.status, 'BLOCKED');
    assert.equal(blocked.adrViolations.length, 2);

    const remediated = evaluateIssueReadiness('DATA-704', {
      specOverride: [
        'CREATE INDEX CONCURRENTLY idx_ledger_merchant_settled ON ledger_entries (merchant_id, settled_at);',
        'db.migration.lock_timeout = 1500ms'
      ].join('\n'),
      completedMitigationIds: ['MIT-CHK-608-1']
    });
    assert.equal(remediated.adrViolations.length, 0);
    assert.equal(remediated.status, 'SHIP_READY');
    assert.equal(remediated.confidenceScore, 100);
  });

  it('7. approves OBS-910 compliant 10% stage-1 canary with SHIP_READY status', () => {
    const report = evaluateIssueReadiness('OBS-910');
    assert.equal(report.status, 'SHIP_READY');
    assert.equal(report.confidenceScore, 100);
    assert.equal(report.adrViolations.length, 0);
    assert.deepEqual(report.compliantAdrs, ['ADR-041']);
  });

  it('8. executes end-to-end ShipGateService workflow: 1-Click Seed -> Verify Override -> Create Subtasks -> Attest', async () => {
    const storage = new InMemoryShipGateStorage();
    const service = new ShipGateService(storage);

    const seedRes = await service.seedWorkspace();
    assert.equal(seedRes.seededIssues.length, 4);
    assert.equal(seedRes.seededAdrs.length, 4);
    assert.equal(seedRes.seededIncidents.length, 3);

    const initial = await service.fetchContextGraph({ issueKey: 'PAY-482', depth: 2 });
    assert.equal(initial.status, 'BLOCKED');

    // Coding agent / engineer fixes config drift via verify-adr-compliance MCP tool
    const afterConfigFix = await service.verifyAdrCompliance({
      issueKey: 'PAY-482',
      configSpec: [
        'checkout.payment.timeout = 2800ms',
        'checkout.circuit_breaker.enabled = true'
      ].join('\n')
    });
    assert.equal(afterConfigFix.adrViolations.length, 0);
    assert.equal(afterConfigFix.status, 'ACTION_REQUIRED'); // Still has blocker SRE-118 & INC-402 checks

    // Rovo agent / MCP creates mitigation subtasks for remaining incident & blocker guardrails
    const { createdSubtasks, updatedReport } = await service.createMitigationSubtasks({
      issueKey: 'PAY-482'
    });
    assert.equal(createdSubtasks.length, 3);
    assert.equal(updatedReport.status, 'SHIP_READY');
    assert.ok(updatedReport.confidenceScore >= 95);

    // Log release readiness attestation back into graph lineage
    const attested = await service.logReleaseAttestation({
      issueKey: 'PAY-482',
      approverNote: 'k6 brownout test passed; approved for holiday release',
      attestedBy: 'Mina Park (@mina.park)'
    });
    assert.equal(attested.status, 'SHIP_READY');
    assert.equal(attested.confidenceScore, 100);
    assert.ok(attested.attestation?.graphEntityAri.startsWith('ari:cloud:graph:shipgate:attestation/'));
    assert.ok(attested.graph.nodes.some((n) => n.type === 'RELEASE_ATTESTATION'));
  });
});
