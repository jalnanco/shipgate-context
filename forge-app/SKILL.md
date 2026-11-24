---
name: shipgate-atlassian-context
description: Pre-merge and pre-deploy organizational context gate powered by ShipGate Context on Atlassian Forge MCP (`rovo:mcp`). Use before opening a PR, modifying infrastructure/SQL migrations, or approving a Jira release ticket to verify Confluence ADR compliance, traverse multi-hop Teamwork Graph blast radius, surface hidden JSM postmortem guardrails, create Jira mitigation subtasks, and record release attestations.
---

# ShipGate Context — Open-Source Agent Skill (`SKILL.md`)

Connects third-party coding agents (**Claude Code**, **Cursor**, **Google Antigravity**, **OpenAI Codex CLI**) directly to your Atlassian Cloud workspace's **`shipgate-mcp-server`** (`rovo:mcp` module deployed via Atlassian Forge).

## Exposed Atlassian MCP Tools (`rovo:mcp`)

1. **`fetch-context-graph`** (`GET`)
   - **Inputs**: `issueKey` (required string, e.g. `PAY-482`), `depth` (optional integer `1..3`, default `2`)
   - **Purpose**: Traverses the Atlassian Teamwork Graph from the target Jira issue across touched Compass components, governed Confluence ADRs, upstream open blockers, and unlinked 2-hop JSM SEV-1/SEV-2 postmortems.
2. **`verify-adr-compliance`** (`GET`)
   - **Inputs**: `issueKey` (required string), `configSpec` (optional string containing proposed config key-values or SQL DDL diff)
   - **Purpose**: Evaluates your local code/config diff or Flyway SQL migration against approved Confluence ADR constraints and returns a recalculated **Ship Confidence Score (`0–100`)**.
3. **`create-mitigation-subtasks`** (`CREATE`)
   - **Inputs**: `issueKey` (required string), `mitigationIds` (optional comma-separated IDs)
   - **Purpose**: Creates tracked Jira subtasks for unresolved ADR policy drifts and JSM postmortem checklists.
4. **`log-release-attestation`** (`UPDATE`)
   - **Inputs**: `issueKey` (required string), `approverNote` (required string)
   - **Purpose**: Writes a signed Release Readiness Attestation back to Forge Hosted Storage (`@forge/kvs`) and Teamwork Graph lineage once all `CRITICAL` drifts are cleared.

## Mandatory Pre-PR / Pre-Deploy Agent Workflow

1. **Identify Jira Key**: Extract the Jira issue key from the current Git branch (e.g. `feat/PAY-482-psp-timeout` -> `PAY-482`) or user prompt.
2. **Fetch Organizational Context**: Call `fetch-context-graph` with `depth: 2` **before** finalizing configuration, timeout, cache TTL, canary rollout, or database DDL changes.
3. **Validate Local Diff Against ADRs**: Pass modified configuration keys or SQL statements to `verify-adr-compliance`.
   - If `status === "BLOCKED"` or any `CRITICAL` `adrViolations` exist, **do not proceed with the violating values**—apply the `remediationHint` in code and re-run `verify-adr-compliance` until `adrViolations` is empty.
4. **Close Incident Guardrails**: If historical JSM postmortems require load-testing or observability verification, call `create-mitigation-subtasks` so nothing slips through unlinked tickets.
5. **Attest Readiness**: Once `status === "SHIP_READY"` (`confidenceScore >= 85`), call `log-release-attestation` with a concise verification summary and tag `recommendedReviewers` in the PR description.
