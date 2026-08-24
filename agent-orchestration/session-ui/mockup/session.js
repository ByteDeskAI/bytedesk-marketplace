/* Agent Orchestration Session mockup — fixture-driven projection of one run. */

const RUN_ID = "run_e4b06416-b931-4064-977d-9f828136cb4d";
const SHORT_ID = "e4b06416";
const TASK = "Design the Agent Orchestration Session operator window for one broker run.";
const WORKSPACE = "/home/ryan/.grok/worktrees/bytedeskai-paperclip/iso-365908";
const STARTED = Date.parse("2026-08-22T21:52:00Z");

const FIXTURE_STAGES = [
  { id: "proposal", name: "proposal", role: "proposer", provider: "Claude", model: "claude-fable-5" },
  { id: "critique", name: "critique", role: "adversary", provider: "Codex", model: "gpt-5.6-sol" },
  { id: "revision", name: "revision", role: "reviser", provider: "Claude", model: "claude-fable-5" },
  { id: "decision_gate", name: "decision_gate", role: "gate", provider: "broker", model: "deterministic" },
];

const live = {
  runId: null,
  snapshot: null,
  events: [],
  connection: "detached",
  lastEventAt: null,
};

function isLive() {
  return Boolean(live.runId);
}

function mapBrokerState(state) {
  return {
    queued: "empty",
    preparing: "empty",
    running: "running",
    verifying: "running",
    waiting_for_decision: "waiting_for_decision",
    cancelling: "cancelling",
    cleanup_required: "failed",
    recovery_required: "failed",
    timed_out: "failed",
    rejected: "failed",
    succeeded: "succeeded",
    failed: "failed",
    cancelled: "cancelled",
  }[state] || "running";
}

function providerLabel(id) {
  return { claude: "Claude", codex: "Codex", "grok-build": "Grok", kimi: "Kimi" }[id] || id || "unassigned";
}

function protocolStages() {
  const stages = live.snapshot?.plan?.stages;
  if (isLive() && Array.isArray(stages) && stages.length) {
    return stages.map((stage) => ({
      id: stage.stageId,
      name: stage.stageId,
      role: stage.role ?? "",
      provider: providerLabel(stage.route?.selected?.providerId),
      model: stage.route?.selected?.modelId ?? "",
    }));
  }
  return FIXTURE_STAGES;
}

const ACTIVITY = [
  { t: "21:52:01", stage: "proposal", provider: "claude", kind: "broker", summary: "run_created · architecture.adversarial.v1", result: "ok" },
  { t: "21:52:02", stage: "proposal", provider: "claude", kind: "broker", summary: "profile enforced: read", result: "ok" },
  { t: "21:52:08", stage: "proposal", provider: "claude", kind: "tool", summary: "read_file docs/plans — denied (host ACP fs)", result: "denied" },
  { t: "21:54:11", stage: "proposal", provider: "claude", kind: "tool", summary: "grep ROADMAP operator|session|approval", result: "ok" },
  { t: "21:57:40", stage: "proposal", provider: "claude", kind: "broker", summary: "stage_completed proposal", result: "ok" },
  { t: "21:57:41", stage: "critique", provider: "codex", kind: "broker", summary: "handoff packet: proposal.output → critique", result: "ok" },
  { t: "21:58:02", stage: "critique", provider: "codex", kind: "tool", summary: "write session-http.mjs — blocked by profile", result: "blocked" },
  { t: "21:58:04", stage: "critique", provider: "codex", kind: "broker", summary: "decision_waiting_for_approval", result: "ok" },
];

const ui = {
  state: "running",
  tab: "activity",
  stage: "critique",
  filter: "all",
  connection: "live",
  queued: null,
  cancelArmed: false,
  decisionNote: "",
  decisionResolved: null,
  selectedActivity: null,
  composerError: "",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function clock(iso) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  return new Date(at).toISOString().slice(11, 16);
}

function runStartedAt() {
  if (isLive() && live.snapshot?.createdAt) return Date.parse(live.snapshot.createdAt);
  return STARTED;
}

function elapsed() {
  const sec = Math.max(0, Math.floor((Date.now() - runStartedAt()) / 1000));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function stageMarks() {
  const stages = protocolStages();
  if (isLive()) {
    const marks = {};
    const completed = new Set((live.snapshot?.outputs ?? []).map((item) => item.stageId).filter(Boolean));
    const started = new Set((live.snapshot?.sessions ?? []).map((item) => item.stageId).filter(Boolean));
    const s = ui.state;
    let seenCurrent = false;
    for (const stage of stages) {
      if (completed.has(stage.id)) {
        marks[stage.id] = "done";
        continue;
      }
      if (!seenCurrent) {
        seenCurrent = true;
        if (s === "empty") marks[stage.id] = "pending";
        else if (s === "waiting_for_decision") marks[stage.id] = "waiting";
        else if (s === "failed") marks[stage.id] = "failed";
        else if (s === "cancelled" || s === "cancelling") marks[stage.id] = "cancelled";
        else marks[stage.id] = "running";
        continue;
      }
      marks[stage.id] = (s === "failed" || s === "cancelled" || s === "cancelling") ? "skipped" : "pending";
    }
    return marks;
  }
  const s = ui.state;
  if (s === "empty") return { proposal: "pending", critique: "pending", revision: "pending", decision_gate: "pending" };
  if (s === "running") return { proposal: "done", critique: "running", revision: "pending", decision_gate: "pending" };
  if (s === "waiting_for_decision") return { proposal: "done", critique: "waiting", revision: "pending", decision_gate: "pending" };
  if (s === "failed") return { proposal: "done", critique: "failed", revision: "skipped", decision_gate: "skipped" };
  if (s === "succeeded") return { proposal: "done", critique: "done", revision: "done", decision_gate: "done" };
  if (s === "cancelled" || s === "cancelling") {
    return { proposal: "done", critique: "cancelled", revision: "skipped", decision_gate: "skipped" };
  }
  return { proposal: "pending", critique: "pending", revision: "pending", decision_gate: "pending" };
}

function pillLabel() {
  return {
    empty: "idle",
    running: "running",
    waiting_for_decision: "waiting for you",
    cancelling: "cancelling",
    failed: "failed",
    succeeded: "succeeded",
    cancelled: "cancelled",
  }[ui.state];
}

function liveActivityRows() {
  return live.events.map((event) => {
    const providerEvent = event.payload?.patch?.lastProviderEvent;
    const fallback = event.payload?.patch?.lastRouteFallback;
    if (event.type === "provider_event" && providerEvent) {
      const kind = providerEvent.type === "tool_call" ? "tool" : "broker";
      return {
        t: clock(event.at),
        stage: providerEvent.stageId ?? "",
        provider: "",
        kind,
        summary: (providerEvent.text || providerEvent.type || "provider_event").slice(0, 200),
        result: "ok",
      };
    }
    if (event.type === "route_fallback" && fallback) {
      return {
        t: clock(event.at),
        stage: fallback.stageId ?? "",
        provider: fallback.rejected?.providerId ?? "",
        kind: "broker",
        summary: `route_fallback ${fallback.rejected?.providerId ?? ""}`.trim(),
        result: "ok",
      };
    }
    const extra = event.payload?.to ? ` · ${event.payload.to}` : event.payload?.text ? ` · ${event.payload.text.slice(0, 80)}` : "";
    return {
      t: clock(event.at),
      stage: "",
      provider: "broker",
      kind: "broker",
      summary: `${event.type}${extra}`,
      result: event.type === "cancel_requested" ? "ok" : "ok",
    };
  });
}

function activityRows() {
  if (isLive()) {
    let rows = liveActivityRows();
    if (ui.filter === "failures") rows = rows.filter((row) => row.result !== "ok");
    else if (ui.filter !== "all") rows = rows.filter((row) => row.kind === ui.filter);
    return rows;
  }
  let rows = ACTIVITY;
  if (ui.state === "empty") rows = [];
  if (ui.filter === "failures") rows = rows.filter((r) => r.result !== "ok");
  else if (ui.filter !== "all") rows = rows.filter((r) => r.kind === ui.filter);
  if (ui.state === "failed") rows = ACTIVITY.filter((r) => r.result !== "ok" || r.stage === "critique");
  return rows;
}

function announce(text) {
  const live = document.getElementById("live");
  live.textContent = text;
}

function copy(text) {
  navigator.clipboard?.writeText(text);
}

function headerModel() {
  if (!isLive() || !live.snapshot) {
    return {
      runId: RUN_ID,
      shortId: SHORT_ID,
      intent: "architecture",
      role: "adversary",
      task: TASK,
      host: "Grok · grok-4-fast",
      profile: "read",
      workspace: WORKSPACE,
    };
  }
  const snapshot = live.snapshot;
  const session = (snapshot.sessions ?? []).at(-1);
  const host = session
    ? `${providerLabel(session.providerId ?? session.provider)} · ${session.model ?? ""}`.trim()
    : "host";
  const workspace = snapshot.workspace?.cwd
    ?? snapshot.workspace?.path
    ?? snapshot.consumer?.checkoutRoot
    ?? "";
  const runId = snapshot.runId;
  return {
    runId,
    shortId: runId.replace(/^run_/, "").slice(0, 8),
    intent: snapshot.input?.intent ?? "",
    role: protocolStages().find((stage) => stage.id === ui.stage)?.role ?? snapshot.plan?.stages?.[0]?.role ?? "",
    task: snapshot.input?.task ?? "",
    host,
    profile: snapshot.input?.permissionProfile ?? "read",
    workspace,
  };
}

function renderHeader() {
  const pulse = ui.state === "running" || ui.state === "cancelling" ? "dot--pulse" : "";
  const h = headerModel();
  const profileClass = h.profile === "write" ? "chip--write" : "chip--read";
  return `
    <header class="header">
      <div class="header-left">
        <button class="run-id" type="button" data-copy="${h.runId}" title="${h.runId}">RUN ${h.shortId}</button>
        ${h.intent ? `<span class="chip">${h.intent}</span>` : ""}
        ${h.role ? `<span class="chip">${h.role}</span>` : ""}
      </div>
      <h1 class="header-title">${h.task}</h1>
      <div class="header-right">
        <span class="chip">${h.host}</span>
        <span class="chip ${profileClass}">${h.profile}</span>
        <span class="chip chip--yolo">yolo (skip-permissions)</span>
        <button class="workspace" type="button" data-copy="${h.workspace}" title="${h.workspace}">${h.workspace}</button>
        <span class="chip">sandbox mount</span>
        <span class="pill" data-state="${ui.state}"><span class="dot ${pulse}"></span>${pillLabel()}</span>
        <span class="chip" id="elapsed">${elapsed()}</span>
      </div>
    </header>`;
}

function renderRail() {
  const marks = stageMarks();
  const items = protocolStages().map((stage) => {
    const mark = marks[stage.id];
    const current = mark === "running" || mark === "waiting";
    return `
      <li>
        <button class="stage ${current ? "is-current" : ""} ${ui.stage === stage.id ? "is-selected" : ""}"
          type="button" data-stage="${stage.id}" data-mark="${mark}">
          <span class="stage-mark" aria-hidden="true"></span>
          <span>
            <span class="stage-name">${stage.name}</span>
            <span class="stage-meta">→ ${stage.provider} · ${stage.role}</span>
          </span>
        </button>
      </li>`;
  }).join("");
  const first = protocolStages()[0];
  const evidence = first && marks[first.id] === "done" ? `from ${first.name}` : "none";
  return `
    <aside class="rail">
      <div class="rail-head">protocol stages</div>
      <ol class="stages">${items}</ol>
      <div class="rail-foot">Earlier-stage evidence: ${evidence}</div>
    </aside>`;
}

function contractBlock() {
  return `
    <div class="contract">
      <p>Session HTTP belongs in the broker, not in Bubblewrap. One loopback listener, capability token in the path, SSE over the hash-chained journal.</p>
      <details open>
        <summary>claims</summary>
        <pre>Per-run operator window. Print URL. Open browser. Live events, handoffs, approvals, cancel.</pre>
      </details>
      <details>
        <summary>evidence</summary>
        <pre>RunStore events.ndjson hash chain. slirp4netns host loopback disabled.</pre>
      </details>
      <details>
        <summary>changedFiles</summary>
        <pre>none (read profile)</pre>
      </details>
      <details>
        <summary>verification</summary>
        <pre>Read-only inspection. Spec reviewed against requested regions and states.</pre>
      </details>
      <details open>
        <summary>unresolvedRisks</summary>
        <pre>Follow-up on terminal runs should spawn a new run. Token must not leak via snapshot.json.</pre>
      </details>
    </div>`;
}

function decisionCard() {
  if (isLive()) return liveDecisionCard();
  if (ui.state !== "waiting_for_decision" && !ui.decisionResolved) return "";
  if (ui.decisionResolved) {
    return `<article class="msg"><div class="msg-meta">decision</div>
      <div class="msg-body">approved by operator 21:58 — “${escapeHtml(ui.decisionResolved)}”</div></article>`;
  }
  return `
    <article class="decision" id="decision-card">
      <h3>Approval needed</h3>
      <blockquote>“Write session-http.mjs so the critique can leave a patch.”</blockquote>
      <dl>
        <dt>stage</dt><dd>critique · Codex</dd>
        <dt>action</dt><dd>write to session-ui/src/session-http.mjs</dd>
        <dt>blocked</dt><dd>exceeds read profile</dd>
      </dl>
      <p class="helper">A = approve · R = reject, only while this card is focused.</p>
    </article>`;
}

function liveDecisionCard() {
  const approval = live.snapshot?.decision?.approval;
  if (approval) {
    return `<article class="msg"><div class="msg-meta">decision</div>
      <div class="msg-body">${escapeHtml(approval.state)} by operator ${clock(approval.at)} — “${escapeHtml(approval.rationale ?? "")}”</div></article>`;
  }
  if (ui.state !== "waiting_for_decision") return "";
  const last = (live.snapshot?.outputs ?? []).at(-1);
  const event = live.snapshot?.lastProviderEvent;
  const quote = event?.text || last?.text || "This run is waiting for an operator decision.";
  return `
    <article class="decision" id="decision-card">
      <h3>Approval needed</h3>
      <blockquote>“${escapeHtml(String(quote).slice(0, 400))}”</blockquote>
      <dl>
        <dt>stage</dt><dd>${escapeHtml(last?.stageId ?? event?.stageId ?? "decision_gate")}</dd>
        <dt>blocked</dt><dd>${escapeHtml(live.snapshot?.decision?.reason ?? "requires human approval")}</dd>
      </dl>
      <p class="helper">A = approve · R = reject, only while this card is focused.</p>
    </article>`;
}

function renderOutputMessage(output) {
  const stage = protocolStages().find((item) => item.id === output.stageId);
  return `
    <article class="msg msg--delegated">
      <div class="msg-meta"><span>${escapeHtml(providerLabel(output.provider))} · ${escapeHtml(stage?.role || output.stageId)}</span></div>
      <div class="msg-body"><pre>${escapeHtml((output.text ?? "").slice(0, 8_000))}</pre></div>
    </article>`;
}

function renderLiveTranscript() {
  const stages = protocolStages();
  if (!live.events.length || ui.state === "empty") {
    const first = stages[0]?.name ?? "execute";
    return `<div class="transcript"><p class="placeholder">No activity yet. The host will begin with stage <strong>${escapeHtml(first)}</strong>.</p></div>`;
  }
  const parts = [];
  for (const event of live.events) {
    if (event.type === "run_created") {
      parts.push(`<p class="msg msg--broker">run created · ${escapeHtml(live.snapshot?.plan?.protocolId ?? "")}</p>`);
      parts.push(`<p class="msg msg--broker">profile enforced: ${escapeHtml(live.snapshot?.input?.permissionProfile ?? "read")}</p>`);
    } else if (event.type === "stage_completed") {
      const output = (event.payload?.patch?.outputs ?? []).at(-1);
      if (output) {
        parts.push(renderOutputMessage(output));
        const index = stages.findIndex((stage) => stage.id === output.stageId);
        const next = index >= 0 ? stages[index + 1] : null;
        if (next) {
          parts.push(`
            <div class="handoff">
              <span>handoff · ${escapeHtml(output.stageId)} (${escapeHtml(providerLabel(output.provider))}) → ${escapeHtml(next.name)} (${escapeHtml(next.provider)})
                <button type="button" data-tab="evidence">view packet</button>
              </span>
            </div>`);
          parts.push(`<p class="msg msg--broker">stage started · ${escapeHtml(next.name)} · ${escapeHtml(next.provider)}</p>`);
        }
      }
    } else if (event.type === "route_fallback") {
      const fallback = event.payload?.patch?.lastRouteFallback;
      parts.push(`<p class="msg msg--broker">route fallback · ${escapeHtml(fallback?.rejected?.providerId ?? "")}</p>`);
    } else if (event.type === "cancel_requested") {
      parts.push(`<p class="msg msg--broker">cancel requested</p>`);
    } else if (event.type === "operator_message") {
      const queued = ui.state !== "succeeded";
      parts.push(`
        <article class="msg msg--operator">
          <div class="msg-meta"><span>operator</span>${queued ? `<span class="queued">queued</span>` : ""}</div>
          <div class="msg-body">${escapeHtml(event.payload?.text ?? "")}</div>
        </article>`);
    } else if (event.type === "decision_waiting_for_approval" || event.payload?.to === "waiting_for_decision") {
      parts.push(liveDecisionCard());
    } else if (event.type === "decision_reviewed") {
      parts.push(liveDecisionCard());
    } else if (event.payload?.to === "cancelled" || event.type === "worker_cancelled" || event.type === "cancelled_without_worker") {
      parts.push(`<p class="msg msg--broker">cancelled by operator</p>`);
    } else if (["failed", "timed_out", "rejected"].includes(event.payload?.to)) {
      parts.push(`
        <article class="msg msg--delegated">
          <div class="msg-meta"><span>broker</span></div>
          <div class="msg-body">Run ${escapeHtml(event.payload.to)}. ${escapeHtml(live.snapshot?.error?.message ?? "")}</div>
        </article>`);
    }
  }
  const working = live.snapshot?.lastProviderEvent;
  if (ui.state === "running" && working?.text) {
    parts.push(`
      <article class="msg msg--delegated">
        <div class="msg-meta"><span>host working</span></div>
        <div class="msg-body">${escapeHtml(working.text)}</div>
      </article>`);
  }
  return `<div class="transcript" id="transcript">${parts.join("")}</div>`;
}

function renderTranscript() {
  if (isLive()) return renderLiveTranscript();
  if (ui.state === "empty") {
    return `<div class="transcript"><p class="placeholder">No activity yet. The host will begin with stage <strong>proposal</strong>.</p></div>`;
  }

  const parts = [];
  parts.push(`<p class="msg msg--broker">stage started · proposal · Claude</p>`);
  parts.push(`<p class="msg msg--broker">profile enforced: read</p>`);
  parts.push(`
    <article class="msg msg--host">
      <div class="msg-meta"><span>host · Claude · proposer</span><span>21:57</span></div>
      <div class="msg-body">${contractBlock()}</div>
    </article>`);
  parts.push(`
    <div class="handoff">
      <span>handoff · design (Claude) → critique (Codex)
        <button type="button" data-tab="evidence">view packet</button>
      </span>
    </div>`);
  parts.push(`<p class="msg msg--broker">stage started · critique · Codex</p>`);

  if (ui.state === "running" || ui.state === "waiting_for_decision" || ui.state === "cancelling") {
    parts.push(`
      <article class="msg msg--delegated">
        <div class="msg-meta"><span>Codex · adversary</span><span>host working</span></div>
        <div class="msg-body">codex executing stage 2/4 — checking bind address, token storage, and whether SSE re-hashes the chain.</div>
      </article>`);
  }
  if (ui.state === "waiting_for_decision") parts.push(decisionCard());
  if (ui.state === "failed") {
    parts.push(`
      <article class="msg msg--delegated">
        <div class="msg-meta"><span>broker · critique</span></div>
        <div class="msg-body">Run failed on critique (Codex): write to session-http.mjs exceeded the read profile.
          <button type="button" class="btn" data-tab="activity" data-filter="failures">show activity</button>
        </div>
      </article>`);
  }
  if (ui.state === "succeeded") {
    parts.push(decisionCard());
    parts.push(`
      <article class="msg msg--host">
        <div class="msg-meta"><span>host · final</span></div>
        <div class="msg-body">${contractBlock()}</div>
      </article>`);
  }
  if (ui.state === "cancelled") {
    parts.push(`<p class="msg msg--broker">cancelled by operator</p>`);
  }
  if (ui.queued) {
    parts.push(`
      <article class="msg msg--operator">
        <div class="msg-meta"><span>operator</span><span class="queued">queued</span></div>
        <div class="msg-body">${ui.queued}</div>
      </article>`);
  }
  return `<div class="transcript" id="transcript">${parts.join("")}</div>`;
}

function renderComposer() {
  if (ui.state === "waiting_for_decision") {
    return `
      <div class="decision-bar">
        <label for="note">Reason, sent back to the provider</label>
        <textarea id="note" maxlength="500" placeholder="Scoped to that file.">${escapeHtml(ui.decisionNote)}</textarea>
        <div class="decision-actions">
          <button class="btn btn--primary" type="button" data-act="approve">Approve</button>
          <button class="btn" type="button" data-act="reject">Reject</button>
          <button class="btn btn--danger" type="button" data-act="cancel">Cancel run</button>
        </div>
        ${ui.composerError ? `<p class="helper helper--error">${escapeHtml(ui.composerError)}</p>` : ""}
      </div>`;
  }
  const terminal = ["failed", "succeeded", "cancelled"].includes(ui.state);
  const writeProfile = isLive() && headerModel().profile === "write";
  const sendDisabled = terminal || writeProfile;
  const helper = ui.composerError
    ? ui.composerError
    : writeProfile
      ? "AO_WRITE_FOLLOWUP_REQUIRES_NEW_RUN"
      : terminal
        ? "Run ended. Start a new run to continue."
        : ui.state === "running"
          ? "Follow-up is queued for the host after the current step. ⌘↵ to send."
          : "Send follow-up to host…";
  const shortId = headerModel().shortId;
  return `
    <form class="composer" id="composer">
      <label for="followup">Send follow-up to host</label>
      <div class="composer-row">
        <textarea id="followup" ${sendDisabled ? "disabled" : ""} placeholder="Ask the host to tighten the bind test."></textarea>
        <div class="composer-actions">
          <button class="btn btn--primary" type="submit" ${sendDisabled ? "disabled" : ""}>Send follow-up</button>
          ${terminal
            ? `<button class="btn" type="button" data-act="copy-summary">Copy run summary</button>`
            : `<button class="btn btn--danger" type="button" data-act="cancel">Cancel run</button>`}
        </div>
      </div>
      <p class="helper ${ui.cancelArmed || ui.composerError ? "helper--error" : ""}" id="composer-help">
        ${ui.cancelArmed ? `Cancel run ${shortId}? Running provider work is interrupted; completed stages are kept.` : helper}
      </p>
      ${ui.cancelArmed ? `<div class="btn-row">
        <button class="btn btn--danger" type="button" data-act="cancel-confirm">Cancel run</button>
        <button class="btn" type="button" data-act="cancel-keep">Keep running</button>
      </div>` : ""}
    </form>`;
}

function renderInspector() {
  const rows = activityRows();
  const activity = rows.length
    ? `<div class="activity">${rows.map((r, i) => `
        <button class="activity-row" type="button" data-activity="${i}">
          <span class="t">${r.t.slice(3)}</span>
          <span class="s">${r.kind} · ${r.summary}</span>
          <span class="result result--${r.result}">${r.result === "blocked" ? "blocked by profile" : r.result}</span>
        </button>`).join("")}</div>`
    : `<p class="empty-note">no events</p>`;

  const approvals = isLive()
    ? (ui.state === "waiting_for_decision"
      ? `<div class="approval-item"><strong>pending</strong><p>${escapeHtml(live.snapshot?.decision?.reason ?? "requires human approval")}</p></div>`
      : live.snapshot?.decision?.approval
        ? `<div class="approval-item">${escapeHtml(live.snapshot.decision.approval.state)} by operator — ${escapeHtml(live.snapshot.decision.approval.rationale ?? "")}</div>`
        : `<p class="empty-note">No approvals on this run.</p>`)
    : (ui.state === "waiting_for_decision"
      ? `<div class="approval-item"><strong>pending</strong><p>write session-http.mjs · exceeds read profile</p></div>`
      : ui.decisionResolved
        ? `<div class="approval-item">approved by operator — ${escapeHtml(ui.decisionResolved)}</div>`
        : `<p class="empty-note">No approvals on this run.</p>`);

  const liveOutputs = live.snapshot?.outputs ?? [];
  const evidence = isLive()
    ? (liveOutputs.length
      ? liveOutputs.map((output) => `<div class="evidence-item">
          <div class="msg-meta">${escapeHtml(output.stageId)} · ${escapeHtml(providerLabel(output.provider))}</div>
          <pre>${escapeHtml((output.text ?? "").slice(0, 4_000))}</pre>
          <button class="btn" type="button" data-copy="${escapeHtml((output.text ?? "").slice(0, 4_000))}">copy</button>
        </div>`).join("")
      : `<p class="empty-note">No handoff packets yet.</p>`)
    : (ui.state === "empty"
      ? `<p class="empty-note">No handoff packets yet.</p>`
      : `<div class="evidence-item">
        <div class="msg-meta">proposal.output → critique</div>
        <pre>{ "outputContract": "architecture.proposal.v1", "bind": "127.0.0.1", "events": "hash-chained ndjson" }</pre>
        <button class="btn" type="button" data-copy="proposal.output">copy</button>
      </div>`);

  const pending = ui.state === "waiting_for_decision"
    ? ` <span class="badge" aria-label="1 pending">1</span>`
    : "";
  return `
    <aside class="inspector">
      <div class="tabs" role="tablist">
        <button class="tab ${ui.tab === "activity" ? "is-active" : ""}" data-tab="activity" type="button">Activity</button>
        <button class="tab ${ui.tab === "approvals" ? "is-active" : ""}" data-tab="approvals" type="button" aria-label="${ui.state === "waiting_for_decision" ? "Approvals, 1 pending" : "Approvals"}">Approvals${pending}</button>
        <button class="tab ${ui.tab === "evidence" ? "is-active" : ""}" data-tab="evidence" type="button">Evidence</button>
      </div>
      <section class="panel ${ui.tab === "activity" ? "is-active" : ""}">
        <div class="filters">
          ${["all", "tool", "broker", "failures"].map((f) =>
            `<button class="filter ${ui.filter === f ? "is-on" : ""}" type="button" data-filter="${f}">${f}</button>`
          ).join("")}
        </div>
        ${activity}
      </section>
      <section class="panel ${ui.tab === "approvals" ? "is-active" : ""}">${approvals}</section>
      <section class="panel ${ui.tab === "evidence" ? "is-active" : ""}">${evidence}</section>
    </aside>`;
}

function lastEventLabel() {
  if (isLive()) {
    const at = live.lastEventAt ? Date.parse(live.lastEventAt) : NaN;
    if (!Number.isFinite(at)) return "last event —";
    const sec = Math.max(0, Math.floor((Date.now() - at) / 1000));
    return `last event ${sec}s`;
  }
  return "last event 3s";
}

function renderStatus() {
  const stages = protocolStages();
  const marks = stageMarks();
  const current = stages.find((s) => marks[s.id] === "running" || marks[s.id] === "waiting") ?? stages[0];
  const conn = isLive() ? live.connection : ui.connection;
  const profile = headerModel().profile;
  return `
    <footer class="status">
      <span>${ui.state.replaceAll("_", " ")}</span>
      <span>${current?.name ?? "—"}</span>
      <span>${current?.provider ?? "—"}</span>
      <span>${profile} · yolo (skip-permissions)</span>
      <span>${lastEventLabel()}</span>
      <span class="${conn}">${conn}</span>
    </footer>`;
}

function renderPalette() {
  return `
    <dialog class="palette" id="palette">
      <input id="palette-q" type="text" placeholder="Jump to stage, fixture, inspector…" aria-label="Command palette">
      <ul class="palette-list" id="palette-list"></ul>
    </dialog>`;
}

function paletteItems() {
  return [
    ...protocolStages().map((s) => ({ id: `stage:${s.id}`, label: `Stage · ${s.name}` })),
    { id: "tab:activity", label: "Inspector · Activity" },
    { id: "tab:approvals", label: "Inspector · Approvals" },
    { id: "tab:evidence", label: "Inspector · Evidence" },
    ...["empty", "running", "waiting_for_decision", "failed", "succeeded", "cancelled"].map((s) => ({
      id: `fixture:${s}`, label: `Fixture · ${s}`,
    })),
  ];
}

function render() {
  const root = document.getElementById("app");
  root.innerHTML = `
    ${renderHeader()}
    <div class="body">
      ${renderRail()}
      <div class="main">
        ${renderTranscript()}
        ${renderComposer()}
      </div>
      ${renderInspector()}
    </div>
    ${renderStatus()}
    ${renderPalette()}
    <button class="btn jump" id="jump" type="button">↓ new</button>
    ${isLive() ? "" : `<div class="fixture">
      mockup fixture
      <select id="fixture" aria-label="Mockup fixture state">
        ${["empty", "running", "waiting_for_decision", "failed", "succeeded", "cancelled"]
          .map((s) => `<option ${s === ui.state ? "selected" : ""} value="${s}">${s}</option>`).join("")}
      </select>
    </div>`}
  `;
  document.title = (ui.state === "waiting_for_decision" ? "⏸ " : "") + `Session ${headerModel().shortId}`;
  wire();
}

function setState(next) {
  ui.state = next;
  ui.cancelArmed = false;
  ui.queued = null;
  if (next !== "succeeded") ui.decisionResolved = null;
  if (next === "waiting_for_decision") ui.tab = "approvals";
  else if (next === "failed") { ui.tab = "activity"; ui.filter = "failures"; }
  else if (next === "succeeded") ui.tab = "evidence";
  else { ui.tab = "activity"; ui.filter = "all"; }
  announce(`Run ${next.replaceAll("_", " ")}`);
  render();
}

function wire() {
  document.getElementById("fixture")?.addEventListener("change", (e) => setState(e.target.value));
  document.getElementById("elapsed").textContent = elapsed();

  document.querySelectorAll("[data-copy]").forEach((el) => {
    el.addEventListener("click", () => copy(el.getAttribute("data-copy")));
  });
  document.querySelectorAll("[data-stage]").forEach((el) => {
    el.addEventListener("click", () => {
      ui.stage = el.getAttribute("data-stage");
      ui.tab = "activity";
      render();
      document.getElementById("transcript")?.querySelector(".msg")?.scrollIntoView({ block: "start" });
    });
  });
  document.querySelectorAll("[data-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      ui.tab = el.getAttribute("data-tab");
      render();
    });
  });
  document.querySelectorAll("[data-filter]").forEach((el) => {
    el.addEventListener("click", () => {
      ui.filter = el.getAttribute("data-filter");
      ui.tab = "activity";
      render();
    });
  });

  const form = document.getElementById("composer");
  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = document.getElementById("followup")?.value.trim();
    if (!text) return;
    if (isLive()) {
      postControl("follow-up", { message: text }).then((result) => {
        if (result) announce(result.queued ? "Follow-up queued for the host" : "Follow-up sent");
      });
      return;
    }
    ui.queued = text;
    render();
    announce("Follow-up queued for the host");
  });

  document.querySelectorAll("[data-act]").forEach((el) => {
    el.addEventListener("click", () => {
      const act = el.getAttribute("data-act");
      if (act === "cancel") { ui.cancelArmed = true; render(); }
      if (act === "cancel-keep") { ui.cancelArmed = false; render(); }
      if (act === "cancel-confirm") {
        if (isLive()) postControl("cancel", {});
        else setState("cancelled");
      }
      if (act === "copy-summary") {
        const h = headerModel();
        copy(`run ${h.runId}\nstate ${ui.state}\n${h.task}`);
      }
      if (act === "approve") {
        const note = document.getElementById("note")?.value.trim() || "ok, scoped to that file";
        if (isLive()) postControl("decision", { approved: true, rationale: note });
        else {
          ui.decisionNote = note;
          ui.decisionResolved = note;
          setState("running");
        }
      }
      if (act === "reject") {
        const note = document.getElementById("note")?.value.trim() || "rejected";
        if (isLive()) postControl("decision", { approved: false, rationale: note });
        else {
          ui.decisionResolved = note;
          setState("failed");
        }
      }
    });
  });

  const palette = document.getElementById("palette");
  const q = document.getElementById("palette-q");
  const list = document.getElementById("palette-list");
  function fillPalette() {
    const query = (q.value || "").toLowerCase();
    list.innerHTML = paletteItems()
      .filter((i) => i.label.toLowerCase().includes(query))
      .map((i, idx) => `<li><button type="button" class="${idx === 0 ? "is-active" : ""}" data-cmd="${i.id}">${i.label}</button></li>`)
      .join("");
    list.querySelectorAll("[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => runCmd(btn.getAttribute("data-cmd")));
    });
  }
  function runCmd(cmd) {
    palette.close();
    if (cmd.startsWith("stage:")) { ui.stage = cmd.slice(6); render(); }
    if (cmd.startsWith("tab:")) { ui.tab = cmd.slice(4); render(); }
    if (cmd.startsWith("fixture:")) setState(cmd.slice(8));
  }
  q?.addEventListener("input", fillPalette);
  fillPalette();
}

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    const palette = document.getElementById("palette");
    if (palette.open) palette.close();
    else { palette.showModal(); document.getElementById("palette-q").focus(); }
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
    e.preventDefault();
    ui.tab = ui.tab === "activity" ? "approvals" : ui.tab === "approvals" ? "evidence" : "activity";
    render();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    document.getElementById("composer")?.requestSubmit();
  }
  if (e.key === "Escape") {
    document.getElementById("palette")?.close();
    ui.cancelArmed = false;
    render();
  }
  const decisionFocused = document.activeElement?.closest?.("#decision-card, .decision-bar");
  if (decisionFocused && ui.state === "waiting_for_decision") {
    if (e.key.toLowerCase() === "a") document.querySelector("[data-act=approve]")?.click();
    if (e.key.toLowerCase() === "r") document.querySelector("[data-act=reject]")?.click();
  }
});

setInterval(() => {
  const el = document.getElementById("elapsed");
  if (el) el.textContent = elapsed();
}, 1000);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postControl(action, body) {
  const response = await fetch(`/api/runs/${live.runId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    ui.composerError = payload.message || payload.code || `HTTP ${response.status}`;
    ui.cancelArmed = false;
    render();
    announce(ui.composerError);
    return null;
  }
  ui.composerError = "";
  ui.cancelArmed = false;
  await refreshSnapshot().catch(() => {});
  render();
  return payload;
}

async function refreshSnapshot() {
  const response = await fetch(`/api/runs/${live.runId}/snapshot`);
  if (!response.ok) throw new Error(String(response.status));
  live.snapshot = await response.json();
  ui.state = mapBrokerState(live.snapshot.state);
  const stages = protocolStages();
  if (stages.length && !stages.some((stage) => stage.id === ui.stage)) {
    ui.stage = stages[0].id;
  }
}

async function pumpEvents() {
  let after = live.events.at(-1)?.seq ?? 0;
  while (live.runId) {
    try {
      const response = await fetch(`/api/runs/${live.runId}/events?after=${after}`);
      if (response.status === 409) {
        live.connection = "detached";
        render();
        announce("Event log is corrupt. Frozen at last good sequence.");
        return;
      }
      if (!response.ok || !response.body) {
        live.connection = "reconnecting";
        render();
        await sleep(1000);
        continue;
      }
      live.connection = "live";
      render();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const event = JSON.parse(dataLine.slice(5).trim());
          live.events.push(event);
          live.lastEventAt = event.at;
          after = event.seq;
          if (["state_changed", "stage_completed", "cancel_requested", "decision_waiting_for_approval", "decision_reviewed", "operator_message", "run_succeeded", "run_created", "worker_cancelled", "cancelled_without_worker"].includes(event.type)) {
            await refreshSnapshot().catch(() => {});
          }
          render();
        }
      }
      live.connection = "reconnecting";
      render();
    } catch {
      live.connection = "reconnecting";
      render();
      await sleep(1000);
    }
  }
}

async function hydrateFromBroker() {
  const match = location.pathname.match(/\/runs\/(run_[0-9a-f-]{36})/i);
  if (!match) return;
  live.runId = match[1];
  live.connection = "reconnecting";
  try {
    await refreshSnapshot();
    render();
    announce(`Run ${ui.state.replaceAll("_", " ")}`);
  } catch {
    live.connection = "detached";
    render();
    announce("Snapshot unavailable");
    return;
  }
  pumpEvents();
}

render();
announce("Run running");
hydrateFromBroker();
