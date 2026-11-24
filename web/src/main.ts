import {
  DEFAULT_DATASET,
  evaluateIssueReadiness,
  IssueWorkspaceState
} from '../../forge-app/src/contextEngine';
import { GraphNode, ShipReadinessReport } from '../../forge-app/src/types';

const COMPLIANT_SPEC_FIXES: Record<string, string> = {
  'PAY-482': [
    '# Remediated per ADR-014 & INC-402 async fallback policy:',
    'checkout.payment.timeout = 2800ms',
    'checkout.circuit_breaker.enabled = true',
    'rollout.region = us-east-1,eu-central-1'
  ].join('\n'),
  'AUTH-319': [
    '# Remediated per ADR-021 (>= 24h webhook retry window):',
    'redis.idempotency.ttl = 24h',
    'redis.compression = zstd-key-hash'
  ].join('\n'),
  'DATA-704': [
    '-- Remediated per ADR-033 zero-downtime migration policy:',
    'CREATE INDEX CONCURRENTLY idx_ledger_merchant_settled ON ledger_entries (merchant_id, settled_at);',
    'db.migration.lock_timeout = 1500ms'
  ].join('\n'),
  'OBS-910': [
    'rollout.canary_percent = 10%',
    'otel.tail_sampling.error_keep = 100%'
  ].join('\n')
};

const ROVO_STARTERS = [
  'Audit PAY-482 against Confluence ADRs and hidden JSM incidents',
  'Check blast-radius graph and missing guardrails for DATA-704',
  'Create mitigation subtasks for AUTH-319 idempotency drift',
  'Draft release readiness attestation for OBS-910'
];

// Browser-hosted Forge KVS simulation map
const workspaceStates = new Map<string, IssueWorkspaceState>();
let currentIssueKey = 'PAY-482';
let selectedGraphNodeId: string | null = null;

function getOrInitState(issueKey: string): IssueWorkspaceState {
  const k = issueKey.toUpperCase();
  if (!workspaceStates.has(k)) {
    workspaceStates.set(k, {
      completedMitigationIds: [],
      createdSubtaskMap: {},
      resolvedBlockers: []
    });
  }
  return workspaceStates.get(k)!;
}

function resetAndSeedWorkspace(): void {
  workspaceStates.clear();
  for (const issue of DEFAULT_DATASET.issues) {
    workspaceStates.set(issue.key, {
      completedMitigationIds: [],
      createdSubtaskMap: {},
      resolvedBlockers: []
    });
  }
  const banner = document.getElementById('seedStatusBanner')!;
  banner.textContent = `✓ Seeded at ${new Date().toLocaleTimeString('en-US', { hour12: false })} · 4 Jira Issues · 4 Confluence ADRs · 3 JSM SEV-1/2 Postmortems`;
}

function populateIssueSelect(): void {
  const select = document.getElementById('issueSelect') as HTMLSelectElement;
  select.innerHTML = '';
  for (const issue of DEFAULT_DATASET.issues) {
    const opt = document.createElement('option');
    opt.value = issue.key;
    opt.textContent = `${issue.key} — ${issue.summary.slice(0, 52)}${issue.summary.length > 52 ? '…' : ''}`;
    if (issue.key === currentIssueKey) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderPanelView(): ShipReadinessReport {
  const state = getOrInitState(currentIssueKey);
  const issueObj = DEFAULT_DATASET.issues.find((i) => i.key === currentIssueKey)!;
  const report = evaluateIssueReadiness(currentIssueKey, state, DEFAULT_DATASET);

  document.getElementById('jiraMetaEyebrow')!.textContent =
    `JIRA ${issueObj.issueType.toUpperCase()} · ${issueObj.priority.toUpperCase()} PRIORITY · ${issueObj.sprint.toUpperCase()}`;
  document.getElementById('jiraIssueHeading')!.textContent =
    `${report.issueKey}: ${report.issueSummary}`;
  document.getElementById('reviewerChip')!.textContent =
    `Owner Review: ${report.recommendedReviewers[0]?.handle || '@sre-lead'}`;

  const metaStrip = document.getElementById('jiraMetaStrip')!;
  metaStrip.innerHTML = [
    `<span class="meta-tag">Assignee: <strong>${issueObj.assignee}</strong></span>`,
    `<span class="meta-tag">Component: <strong>${issueObj.componentIds.join(', ')}</strong></span>`,
    `<span class="meta-tag">Explicit Links: <strong>${issueObj.explicitLinkedIds.length ? issueObj.explicitLinkedIds.join(', ') : 'None (0 linked)'}</strong></span>`,
    `<span class="meta-tag">Hidden 2-Hop Incidents: <strong>${report.graph.stats.hiddenUnlinkedRisks} detected</strong></span>`
  ].join('');

  const editor = document.getElementById('specEditor') as HTMLTextAreaElement;
  const effectiveSpec = state.specOverride !== undefined ? state.specOverride : issueObj.descriptionSpec;
  if (document.activeElement !== editor) {
    editor.value = effectiveSpec;
  }

  // Score Gauge & Breakdown
  const circumference = 314.16;
  const offset = circumference - (report.confidenceScore / 100) * circumference;
  const arc = document.getElementById('scoreArc')!;
  arc.setAttribute('stroke-dashoffset', offset.toFixed(2));
  const arcColor =
    report.status === 'BLOCKED'
      ? '#EF4444'
      : report.status === 'ACTION_REQUIRED'
        ? '#F59E0B'
        : '#10B981';
  arc.setAttribute('stroke', arcColor);

  document.getElementById('scoreNumber')!.textContent = String(report.confidenceScore);

  const badge = document.getElementById('readinessBadge')!;
  badge.className = `status-badge ${report.status}`;
  badge.textContent = report.status.replace('_', ' ');

  document.getElementById('graphSummaryTag')!.textContent =
    `${report.graph.stats.totalNodes} Teamwork Graph Nodes · ${report.graph.stats.violatedEdges} Active Risk Edges`;

  const verdictEl = document.getElementById('scoreVerdictText')!;
  if (report.status === 'BLOCKED') {
    verdictEl.textContent = `Deployment blocked: ${report.adrViolations.filter((v) => !v.mitigated).length} Confluence ADR policy drift(s) and ${report.graph.stats.hiddenUnlinkedRisks} unlinked 2-hop SEV-1 incident guardrail(s) require action.`;
  } else if (report.status === 'ACTION_REQUIRED') {
    verdictEl.textContent = `ADR parameters pass, but ${report.mitigationItems.filter((m) => !m.completed).length} postmortem / upstream blocker guardrail subtask(s) remain open before release.`;
  } else {
    verdictEl.textContent = report.attestation
      ? `Ship Ready & Attested (${report.attestation.attestedBy}): All governed ADRs and postmortem guardrails verified in Teamwork Graph.`
      : `Ship Ready: All Confluence ADR thresholds and historical JSM incident guardrails are satisfied.`;
  }

  const bd = report.breakdown;
  document.getElementById('breakdownChips')!.innerHTML = [
    `<span class="bd-chip">Base: 100</span>`,
    `<span class="bd-chip">ADR Drift: -${bd.adrPenalty}</span>`,
    `<span class="bd-chip">JSM Guardrails: -${bd.incidentPenalty}</span>`,
    `<span class="bd-chip">Blockers: -${bd.blockerPenalty}</span>`,
    `<span class="bd-chip">Attestation: +${bd.attestationBonus}</span>`
  ].join('');

  // Guardrails List
  const grList = document.getElementById('guardrailsList')!;
  const pendingCount = report.mitigationItems.filter((m) => !m.completed).length;
  document.getElementById('guardrailCountPill')!.textContent =
    pendingCount === 0
      ? `All ${report.mitigationItems.length} verified ✓`
      : `${pendingCount} open / ${report.mitigationItems.length} total`;

  if (report.mitigationItems.length === 0) {
    grList.innerHTML = `<div class="guardrail-item VERIFIED"><div class="gr-top"><span class="gr-badge VERIFIED">COMPLIANT</span><span class="gr-source">${report.compliantAdrs.join(', ')}</span></div><div class="gr-summary">All governed Confluence ADR constraints and JSM postmortem checks passed with zero drift.</div></div>`;
  } else {
    grList.innerHTML = report.mitigationItems
      .map((item) => {
        const cls = item.completed ? 'VERIFIED' : item.severity;
        const badgeLabel = item.completed
          ? `VERIFIED ${item.createdSubtaskKey ? '· ' + item.createdSubtaskKey : ''}`
          : `${item.severity} · ${item.sourceType}`;
        return `<div class="guardrail-item ${cls}">
          <div class="gr-top">
            <span class="gr-badge ${cls}">${badgeLabel}</span>
            <span class="gr-source">${item.sourceId} · ${item.suggestedAssignee}</span>
          </div>
          <div class="gr-summary">${escapeHtml(item.summary)}</div>
        </div>`;
      })
      .join('');
  }

  renderBlastRadiusSvg(report);
  return report;
}

function renderBlastRadiusSvg(report: ShipReadinessReport): void {
  const svg = document.getElementById('blastGraphSvg')!;
  const coords = new Map<string, { x: number; y: number; w: number; h: number }>();

  const focal = report.graph.nodes.find((n) => n.hopDistance === 0)!;
  const attNode = report.graph.nodes.find((n) => n.type === 'RELEASE_ATTESTATION');
  const hop1 = report.graph.nodes.filter(
    (n) => n.hopDistance === 1 && n.type !== 'RELEASE_ATTESTATION'
  );
  const hop2 = report.graph.nodes.filter((n) => n.hopDistance === 2);

  // Column 0 (x = 24, w = 212)
  coords.set(focal.id, { x: 24, y: attNode ? 92 : 126, w: 212, h: 72 });
  if (attNode) {
    coords.set(attNode.id, { x: 24, y: 212, w: 212, h: 66 });
  }

  // Column 1 (x = 344, w = 224)
  hop1.forEach((node, idx) => {
    const totalH = hop1.length * 72 + (hop1.length - 1) * 34;
    const startY = Math.max(28, Math.round((330 - totalH) / 2));
    coords.set(node.id, { x: 344, y: startY + idx * 106, w: 224, h: 72 });
  });

  // Column 2 (x = 672, w = 226)
  hop2.forEach((node, idx) => {
    const gap = hop2.length >= 4 ? 14 : 22;
    const boxH = hop2.length >= 4 ? 64 : 70;
    const totalH = hop2.length * boxH + (hop2.length - 1) * gap;
    const startY = Math.max(16, Math.round((330 - totalH) / 2));
    coords.set(node.id, { x: 672, y: startY + idx * (boxH + gap), w: 226, h: boxH });
  });

  const edgePaths: string[] = [];
  const edgeBadges: string[] = [];

  report.graph.edges.forEach((edge) => {
    const s = coords.get(edge.source);
    const t = coords.get(edge.target);
    if (!s || !t) return;

    const stroke =
      edge.status === 'VIOLATED'
        ? '#EF4444'
        : edge.status === 'UNLINKED_RISK'
          ? '#F59E0B'
          : edge.status === 'VERIFIED'
            ? '#10B981'
            : '#64748B';
    const dash =
      edge.status === 'VIOLATED' || edge.status === 'UNLINKED_RISK'
        ? 'stroke-dasharray="6 4"'
        : '';

    let d = '';
    let labelX = 0;
    let labelY = 0;

    if (s.x === t.x) {
      // Vertical attestation edge inside Column 0
      const xMid = s.x + s.w / 2;
      d = `M ${xMid} ${s.y + s.h} L ${xMid} ${t.y}`;
      labelX = xMid;
      labelY = (s.y + s.h + t.y) / 2;
    } else if (s.x < t.x) {
      const x1 = s.x + s.w;
      const y1 = s.y + s.h / 2;
      const x2 = t.x;
      const y2 = t.y + t.h / 2;
      const cx = (x1 + x2) / 2;
      d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
      labelX = x1 + (x2 - x1) * 0.52;
      labelY = y1 + (y2 - y1) * 0.65;
    } else {
      // Blocker in Col 1 pointing back to Focal in Col 0
      const x1 = s.x;
      const y1 = s.y + s.h / 2;
      const x2 = t.x + t.w;
      const y2 = t.y + t.h * 0.72;
      const cx = (x1 + x2) / 2;
      d = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
      labelX = x2 + (x1 - x2) * 0.52;
      labelY = y2 + (y1 - y2) * 0.68;
    }

    edgePaths.push(
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="2.3" ${dash} />`
    );

    if (edge.annotation) {
      const shortText = truncate(edge.annotation, 20);
      const pillW = Math.max(76, shortText.length * 5.7 + 14);
      edgeBadges.push(
        `<g transform="translate(${(labelX - pillW / 2).toFixed(1)}, ${(labelY - 9).toFixed(1)})">
          <rect width="${pillW.toFixed(1)}" height="18" rx="9" fill="#0B1324" stroke="${stroke}" stroke-width="1.2" />
          <text x="${(pillW / 2).toFixed(1)}" y="12.5" text-anchor="middle" fill="#E2E8F0" font-size="9.5" font-weight="700">${escapeHtml(shortText)}</text>
        </g>`
      );
    }
  });

  const nodeBoxes = report.graph.nodes
    .map((node) => {
      const box = coords.get(node.id);
      if (!box) return '';
      const borderCol =
        node.riskLevel === 'CRITICAL'
          ? '#EF4444'
          : node.riskLevel === 'WARNING'
            ? '#F59E0B'
            : node.riskLevel === 'SAFE'
              ? '#10B981'
              : '#3B82F6';
      const isSelected = (selectedGraphNodeId || focal.id) === node.id;
      const fillCol = isSelected ? '#172542' : '#0F172A';
      const typeLabel = node.type.replace('_', ' ');

      return `<g class="graph-node" data-node-id="${node.id}" style="cursor:pointer" transform="translate(${box.x}, ${box.y})">
        <rect width="${box.w}" height="${box.h}" rx="10" fill="${fillCol}" stroke="${borderCol}" stroke-width="${isSelected ? '2.5' : '1.6'}" />
        <text x="12" y="18" fill="#93C5FD" font-size="9.5" font-weight="800" letter-spacing="0.5">${escapeHtml(typeLabel)}</text>
        <text x="12" y="36" fill="#F8FAFC" font-size="12.5" font-weight="800">${escapeHtml(truncate(node.label, 25))}</text>
        <text x="12" y="53" fill="#94A3B8" font-size="10.5">${escapeHtml(truncate(node.subtitle, 30))}</text>
      </g>`;
    })
    .join('');

  svg.innerHTML = `<g>${edgePaths.join('')}</g><g>${nodeBoxes}</g><g>${edgeBadges.join('')}</g>`;

  svg.querySelectorAll('.graph-node').forEach((el) => {
    el.addEventListener('click', () => {
      selectedGraphNodeId = el.getAttribute('data-node-id');
      renderBlastRadiusSvg(report);
    });
  });

  const inspected: GraphNode =
    report.graph.nodes.find((n) => n.id === selectedGraphNodeId) ||
    report.graph.nodes.find((n) => n.riskLevel === 'CRITICAL' || n.riskLevel === 'WARNING') ||
    focal;

  document.getElementById('nodeInspectorBar')!.innerHTML =
    `<strong>Selected Graph Entity:</strong> <code>${escapeHtml(inspected.ari)}</code> — <strong>${escapeHtml(inspected.label)}</strong>: ${escapeHtml(inspected.subtitle)} (Hop ${inspected.hopDistance})`;
}

// Rovo Chat Tab Logic
function initRovoTab(): void {
  const starterWrap = document.getElementById('rovoStarterList')!;
  starterWrap.innerHTML = ROVO_STARTERS.map(
    (prompt) => `<button type="button" class="starter-btn" data-prompt="${escapeHtml(prompt)}">💬 "${escapeHtml(prompt)}"</button>`
  ).join('');

  starterWrap.querySelectorAll('.starter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const prompt = btn.getAttribute('data-prompt') || '';
      runRovoAgentPrompt(prompt);
    });
  });

  // Seed initial welcome audit message so Tab 2 looks rich immediately
  runRovoAgentPrompt(ROVO_STARTERS[0]);

  const form = document.getElementById('rovoChatForm') as HTMLFormElement;
  const input = document.getElementById('rovoChatInput') as HTMLInputElement;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    runRovoAgentPrompt(q);
  });
}

function runRovoAgentPrompt(prompt: string): void {
  const feed = document.getElementById('rovoChatFeed')!;
  const keyMatch = prompt.toUpperCase().match(/\b(PAY-482|AUTH-319|DATA-704|OBS-910)\b/);
  const targetKey = keyMatch ? keyMatch[1] : currentIssueKey;
  const state = getOrInitState(targetKey);

  const wantsSubtasks = /create mitigation|subtask/i.test(prompt);
  const wantsAttest = /attest/i.test(prompt);

  const invokedTools = ['action: fetch-context-graph', 'action: verify-adr-compliance'];

  let report = evaluateIssueReadiness(targetKey, state, DEFAULT_DATASET);
  if (wantsSubtasks) {
    invokedTools.push('action: create-mitigation-subtasks');
    let idx = Object.keys(state.createdSubtaskMap).length + 1;
    for (const m of report.mitigationItems) {
      if (!state.completedMitigationIds.includes(m.id)) {
        state.completedMitigationIds.push(m.id);
      }
      if (m.sourceType === 'BLOCKER' && !state.resolvedBlockers.includes(m.sourceId)) {
        state.resolvedBlockers.push(m.sourceId);
      }
      if (!state.createdSubtaskMap[m.id]) {
        state.createdSubtaskMap[m.id] = `${targetKey.split('-')[0]}-MIT-${idx++}`;
      }
    }
    report = evaluateIssueReadiness(targetKey, state, DEFAULT_DATASET);
  }

  if (wantsAttest) {
    invokedTools.push('action: log-release-attestation');
    state.attestation = {
      issueKey: targetKey,
      attestedBy: 'ShipGate Release Auditor (@rovo)',
      attestedAt: new Date().toISOString(),
      approverNote: 'Automated Rovo Readiness Attestation recorded in Teamwork Graph',
      scoreAtAttestation: report.confidenceScore,
      graphEntityAri: `ari:cloud:graph:shipgate:attestation/${targetKey.toLowerCase()}`
    };
    report = evaluateIssueReadiness(targetKey, state, DEFAULT_DATASET);
  }

  const toolBadges = invokedTools
    .map((t) => `<span class="tool-trace-pill">⚡ ${escapeHtml(t)}</span>`)
    .join('');

  const violationsSummary =
    report.adrViolations.filter((v) => !v.mitigated).length > 0
      ? report.adrViolations
          .filter((v) => !v.mitigated)
          .map(
            (v) =>
              `• [${v.severity}] ${v.adrId} (${v.paramKey} = ${v.observedRaw}, expected ${v.expectedRule}) — ${v.remediationHint}`
          )
          .join('<br/>')
      : '• Zero active Confluence ADR violations.';

  const incSummary =
    report.incidentExposures.length > 0
      ? report.incidentExposures
          .map(
            (inc) =>
              `• ${inc.incidentId} (${inc.severity}${inc.wasExplicitlyLinked ? '' : ' · Hidden 2-Hop via ' + inc.sharedComponentId}): ${inc.rootCause}`
          )
          .join('<br/>')
      : '• No historical SEV-1/SEV-2 postmortems triggered on touched components.';

  const replyHtml = `
    <div>${toolBadges}</div>
    <strong>@ShipGate Release Auditor — ${report.issueKey} (${report.status.replace('_', ' ')} · ${report.confidenceScore}/100)</strong><br/>
    <strong>Confluence ADR Lineage:</strong><br/>${violationsSummary}<br/>
    <strong>Teamwork Graph JSM Postmortem Lineage:</strong><br/>${incSummary}<br/>
    <strong>Recommended Reviewer:</strong> ${escapeHtml(report.recommendedReviewers[0]?.name || 'Platform SRE')} (${escapeHtml(report.recommendedReviewers[0]?.handle || '@sre')})
  `;

  feed.innerHTML += `<div class="chat-msg user">${escapeHtml(prompt)}</div>`;
  feed.innerHTML += `<div class="chat-msg agent">${replyHtml}</div>`;
  feed.scrollTop = feed.scrollHeight;

  if (targetKey === currentIssueKey) {
    renderPanelView();
  }
}

// MCP Inspector Tab Logic
function runMcpCall(toolName: string): void {
  const reqPre = document.getElementById('mcpRequestPre')!;
  const resPre = document.getElementById('mcpResponsePre')!;
  const state = getOrInitState(currentIssueKey);

  if (toolName === 'tools/list') {
    reqPre.textContent = JSON.stringify(
      { jsonrpc: '2.0', id: 101, method: 'tools/list', params: {} },
      null,
      2
    );
    resPre.textContent = JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 101,
        result: {
          server: 'shipgate-mcp-server (Atlassian Forge rovo:mcp)',
          tools: [
            { name: 'fetch-context-graph', actionVerb: 'GET', required: ['issueKey'] },
            { name: 'verify-adr-compliance', actionVerb: 'GET', required: ['issueKey'] },
            { name: 'create-mitigation-subtasks', actionVerb: 'CREATE', required: ['issueKey'] },
            { name: 'log-release-attestation', actionVerb: 'UPDATE', required: ['issueKey', 'approverNote'] }
          ]
        }
      },
      null,
      2
    );
    return;
  }

  if (toolName === 'verify-adr-compliance') {
    const compliantSpec = COMPLIANT_SPEC_FIXES[currentIssueKey] || '';
    state.specOverride = compliantSpec;
    const report = evaluateIssueReadiness(currentIssueKey, state, DEFAULT_DATASET);
    reqPre.textContent = JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 102,
        method: 'tools/call',
        params: {
          name: 'verify-adr-compliance',
          arguments: { issueKey: currentIssueKey, configSpec: compliantSpec }
        }
      },
      null,
      2
    );
    resPre.textContent = JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 102,
        result: {
          issueKey: report.issueKey,
          status: report.status,
          confidenceScore: report.confidenceScore,
          adrViolations: report.adrViolations,
          compliantAdrs: report.compliantAdrs,
          pendingGuardrails: report.mitigationItems.filter((m) => !m.completed).length
        }
      },
      null,
      2
    );
    renderPanelView();
    return;
  }

  if (toolName === 'create-mitigation-subtasks') {
    const initial = evaluateIssueReadiness(currentIssueKey, state, DEFAULT_DATASET);
    const created: string[] = [];
    let seq = Object.keys(state.createdSubtaskMap).length + 1;
    for (const item of initial.mitigationItems) {
      if (!state.completedMitigationIds.includes(item.id)) {
        state.completedMitigationIds.push(item.id);
      }
      if (item.sourceType === 'BLOCKER' && !state.resolvedBlockers.includes(item.sourceId)) {
        state.resolvedBlockers.push(item.sourceId);
      }
      if (!state.createdSubtaskMap[item.id]) {
        const subKey = `${currentIssueKey.split('-')[0]}-MIT-${seq++}`;
        state.createdSubtaskMap[item.id] = subKey;
        created.push(subKey);
      }
    }
    const updated = evaluateIssueReadiness(currentIssueKey, state, DEFAULT_DATASET);
    reqPre.textContent = JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 103,
        method: 'tools/call',
        params: { name: 'create-mitigation-subtasks', arguments: { issueKey: currentIssueKey } }
      },
      null,
      2
    );
    resPre.textContent = JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 103,
        result: {
          createdJiraSubtasks: created,
          updatedStatus: updated.status,
          updatedConfidenceScore: updated.confidenceScore
        }
      },
      null,
      2
    );
    renderPanelView();
    return;
  }

  if (toolName === 'log-release-attestation') {
    const pre = evaluateIssueReadiness(currentIssueKey, state, DEFAULT_DATASET);
    state.attestation = {
      issueKey: currentIssueKey,
      attestedBy: 'Claude Code via Atlassian MCP',
      attestedAt: new Date().toISOString(),
      approverNote: 'Verified ADR thresholds & postmortem guardrails prior to PR merge',
      scoreAtAttestation: pre.confidenceScore,
      graphEntityAri: `ari:cloud:graph:shipgate:attestation/${currentIssueKey.toLowerCase()}`
    };
    const attested = evaluateIssueReadiness(currentIssueKey, state, DEFAULT_DATASET);
    reqPre.textContent = JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 104,
        method: 'tools/call',
        params: {
          name: 'log-release-attestation',
          arguments: {
            issueKey: currentIssueKey,
            approverNote: 'Verified ADR thresholds & postmortem guardrails prior to PR merge'
          }
        }
      },
      null,
      2
    );
    resPre.textContent = JSON.stringify(
      {
        jsonrpc: '2.0',
        id: 104,
        result: {
          issueKey: attested.issueKey,
          status: attested.status,
          confidenceScore: attested.confidenceScore,
          attestation: attested.attestation
        }
      },
      null,
      2
    );
    renderPanelView();
    return;
  }

  // Default: fetch-context-graph
  const report = evaluateIssueReadiness(currentIssueKey, state, DEFAULT_DATASET);
  reqPre.textContent = JSON.stringify(
    {
      jsonrpc: '2.0',
      id: 100,
      method: 'tools/call',
      params: {
        name: 'fetch-context-graph',
        arguments: { issueKey: currentIssueKey, depth: 2 }
      }
    },
    null,
    2
  );
  resPre.textContent = JSON.stringify(
    {
      jsonrpc: '2.0',
      id: 100,
      result: {
        issueKey: report.issueKey,
        status: report.status,
        confidenceScore: report.confidenceScore,
        graphStats: report.graph.stats,
        adrViolations: report.adrViolations,
        incidentExposures: report.incidentExposures.map((i) => ({
          incidentId: i.incidentId,
          severity: i.severity,
          wasExplicitlyLinked: i.wasExplicitlyLinked
        })),
        recommendedReviewers: report.recommendedReviewers
      }
    },
    null,
    2
  );
}

function truncate(str: string, max: number): string {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bootstrap(): void {
  resetAndSeedWorkspace();
  populateIssueSelect();
  renderPanelView();
  initRovoTab();
  runMcpCall('fetch-context-graph');

  // Issue selector
  document.getElementById('issueSelect')!.addEventListener('change', (e) => {
    currentIssueKey = (e.target as HTMLSelectElement).value;
    selectedGraphNodeId = null;
    const state = getOrInitState(currentIssueKey);
    const issueObj = DEFAULT_DATASET.issues.find((i) => i.key === currentIssueKey)!;
    (document.getElementById('specEditor') as HTMLTextAreaElement).value =
      state.specOverride !== undefined ? state.specOverride : issueObj.descriptionSpec;
    renderPanelView();
    runMcpCall('fetch-context-graph');
  });

  // 1-Click Demo Seeder button
  document.getElementById('btnSeedWorkspace')!.addEventListener('click', () => {
    resetAndSeedWorkspace();
    selectedGraphNodeId = null;
    const issueObj = DEFAULT_DATASET.issues.find((i) => i.key === currentIssueKey)!;
    (document.getElementById('specEditor') as HTMLTextAreaElement).value = issueObj.descriptionSpec;
    renderPanelView();
    runMcpCall('fetch-context-graph');
  });

  // Live Config / SQL Diff Editor actions
  document.getElementById('btnVerifySpec')!.addEventListener('click', () => {
    const val = (document.getElementById('specEditor') as HTMLTextAreaElement).value;
    getOrInitState(currentIssueKey).specOverride = val;
    renderPanelView();
  });

  document.getElementById('btnAutoFixSpec')!.addEventListener('click', () => {
    const fixed = COMPLIANT_SPEC_FIXES[currentIssueKey] || '';
    (document.getElementById('specEditor') as HTMLTextAreaElement).value = fixed;
    getOrInitState(currentIssueKey).specOverride = fixed;
    renderPanelView();
  });

  // Create Jira Mitigation Subtasks
  document.getElementById('btnCreateSubtasks')!.addEventListener('click', () => {
    const state = getOrInitState(currentIssueKey);
    const rep = evaluateIssueReadiness(currentIssueKey, state, DEFAULT_DATASET);
    let idx = Object.keys(state.createdSubtaskMap).length + 1;
    for (const item of rep.mitigationItems) {
      if (item.sourceType === 'ADR') {
        // ADR CRITICAL parameter drifts should be fixed in config or mitigated explicitly
        if (!state.completedMitigationIds.includes(item.id)) {
          state.completedMitigationIds.push(item.id);
        }
      } else {
        if (!state.completedMitigationIds.includes(item.id)) {
          state.completedMitigationIds.push(item.id);
        }
        if (item.sourceType === 'BLOCKER' && !state.resolvedBlockers.includes(item.sourceId)) {
          state.resolvedBlockers.push(item.sourceId);
        }
      }
      if (!state.createdSubtaskMap[item.id]) {
        state.createdSubtaskMap[item.id] = `${currentIssueKey.split('-')[0]}-MIT-${idx++}`;
      }
    }
    renderPanelView();
  });

  // Log Release Attestation
  document.getElementById('btnLogAttestation')!.addEventListener('click', () => {
    const state = getOrInitState(currentIssueKey);
    const cur = evaluateIssueReadiness(currentIssueKey, state, DEFAULT_DATASET);
    state.attestation = {
      issueKey: currentIssueKey,
      attestedBy: 'Mina Park (@mina.park)',
      attestedAt: new Date().toISOString(),
      approverNote: 'All ADR & JSM blast-radius guardrails verified',
      scoreAtAttestation: cur.confidenceScore,
      graphEntityAri: `ari:cloud:graph:shipgate:attestation/${currentIssueKey.toLowerCase()}`
    };
    renderPanelView();
  });

  // Tabs switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab')!;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-view').forEach((v) => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${target}`)!.classList.add('active');
    });
  });

  // MCP Trigger buttons
  document.querySelectorAll('.mcp-trigger').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tool = btn.getAttribute('data-tool') || 'fetch-context-graph';
      runMcpCall(tool);
    });
  });
}

bootstrap();
