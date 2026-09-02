(() => {
  "use strict";

  const states = [
    "empty",
    "questioning",
    "attachment",
    "agent-health",
    "streaming",
    "proposed",
    "confirmation",
    "validation-failure",
    "import-success",
    "offline",
    "unavailable-agent",
  ];

  const stateMeta = {
    empty: { label: "empty", tone: "" },
    questioning: { label: "needs decisions", tone: "warn" },
    attachment: { label: "context requested", tone: "info" },
    "agent-health": { label: "agent ready", tone: "ok" },
    streaming: { label: "planning", tone: "accent" },
    proposed: { label: "approval needed", tone: "warn" },
    confirmation: { label: "permission open", tone: "warn" },
    "validation-failure": { label: "refused", tone: "bad" },
    "import-success": { label: "imported", tone: "ok" },
    offline: { label: "offline", tone: "warn" },
    "unavailable-agent": { label: "agent unavailable", tone: "bad" },
  };

  const stateEvents = {
    empty: [
      ["done", "STATE_SNAPSHOT", "scope + agent health", "14:31:02"],
    ],
    questioning: [
      ["done", "RUN_STARTED", "goal_planner", "14:31:02"],
      ["done", "STATE_SNAPSHOT", "bounded scope", "14:31:02"],
      ["active", "CUSTOM", "tm.elicitation.requested", "14:31:04"],
    ],
    attachment: [
      ["done", "RUN_STARTED", "goal_planner", "14:31:02"],
      ["done", "CUSTOM", "tm.elicitation.completed", "14:32:18"],
      ["active", "CUSTOM", "tm.attachment.requested", "14:32:19"],
    ],
    "agent-health": [
      ["done", "RUN_STARTED", "capability_probe", "14:30:58"],
      ["done", "STATE_SNAPSHOT", "agent + scope", "14:30:59"],
      ["done", "RUN_FINISHED", "ready", "14:31:00"],
    ],
    streaming: [
      ["done", "RUN_STARTED", "goal_planner", "14:31:02"],
      ["done", "TOOL_CALL_RESULT", "tm_show · EP-024", "14:31:07"],
      ["done", "TOOL_CALL_RESULT", "tm_find · planner", "14:31:10"],
      ["active", "TOOL_CALL_START", "tm_map", "14:31:12"],
      ["queued", "TOOL_CALL_ARGS", "delta · scope", "14:31:12"],
    ],
    proposed: [
      ["done", "RUN_STARTED", "goal_planner", "14:31:02"],
      ["done", "STEP_FINISHED", "build-proposal", "14:31:18"],
      ["done", "STATE_DELTA", "proposalSet · 5", "14:31:18"],
      ["active", "CUSTOM", "tm.permission.requested", "14:31:19"],
    ],
    confirmation: [
      ["done", "STATE_DELTA", "proposalSet · 5", "14:31:18"],
      ["active", "CUSTOM", "tm.permission.requested", "14:31:19"],
    ],
    "validation-failure": [
      ["done", "TOOL_CALL_START", "tm_task_create", "14:31:25"],
      ["done", "TOOL_CALL_END", "request complete", "14:31:25"],
      ["active", "TOOL_CALL_RESULT", "refused · requireOnCreate", "14:31:25"],
      ["active", "RUN_ERROR", "validation", "14:31:25"],
    ],
    "import-success": [
      ["done", "CUSTOM", "tm.permission.resolved", "14:31:24"],
      ["done", "TOOL_CALL_RESULT", "goal_import · EP-025", "14:31:28"],
      ["done", "STATE_DELTA", "board revision · 184", "14:31:28"],
      ["done", "RUN_FINISHED", "imported", "14:31:29"],
    ],
    offline: [
      ["active", "RUN_ERROR", "bridge unavailable", "14:35:02"],
      ["queued", "STATE_SNAPSHOT", "local draft retained", "14:35:02"],
    ],
    "unavailable-agent": [
      ["done", "RUN_STARTED", "capability_probe", "14:30:58"],
      ["active", "RUN_ERROR", "ACP spawn failed", "14:30:59"],
    ],
  };

  const stage = document.querySelector("#stageState");
  const scenarioSelect = document.querySelector("#scenarioSelect");
  const stateChip = document.querySelector("#workspaceStateChip");
  const eventList = document.querySelector("#eventList");
  const liveRegion = document.querySelector("#liveRegion");
  const root = document.documentElement;
  const body = document.body;
  const confirmDialog = document.querySelector("#confirmDialog");
  const importDialog = document.querySelector("#importDialog");
  const agentSelect = document.querySelector("#agentSelect");
  const agentHealth = document.querySelector("#agentHealth");
  const traceAgentName = document.querySelector("#traceAgentName");
  const healthList = document.querySelector("#healthList");
  const params = new URLSearchParams(window.location.search);
  let currentState = states.includes(params.get("state")) ? params.get("state") : "questioning";
  let attachedFiles = ["docs/architecture/bridge.md"];

  const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

  const templates = {
    empty: () => `
      <div class="state-heading">
        <div><h3>Describe one outcome</h3><p>The planner can inspect this repository and ask bounded follow-up questions. It cannot become a general assistant or mutate the board without a reviewable proposal.</p></div>
        <span class="chip"><span class="status-dot"></span>no run</span>
      </div>
      <div class="composer">
        <label for="goalOutcome">Outcome</label>
        <textarea id="goalOutcome" placeholder="What should be true when this goal is complete?">Expose the selected planner coding agent and its capability health before a goal-planning run starts.</textarea>
        <div class="composer-foot">
          <p>Repository context is read through the trusted ACP session.</p>
          <div class="inline-actions">
            <button class="button button--ghost" type="button" data-open-import>Import instead</button>
            <button class="button button--primary" type="button" id="beginPlanning">Start bounded plan</button>
          </div>
        </div>
      </div>`,

    questioning: () => `
      <div class="state-heading">
        <div><h3>Three decisions need an operator</h3><p>Repository facts are already resolved. These choices change the shape of the proposed board work, so the planner will not answer them for you.</p></div>
        <span class="chip chip--warn"><span class="status-dot"></span>decision 1 of 3</span>
      </div>
      <div class="question-set">
        <section class="question-card">
          <div><span class="caps">boundary</span><h4>Where should agent health block progress?</h4><p>The current Plans page has no preflight. A missing ACP agent can fail before any board write is proposed.</p><p class="evidence-line"><span>Evidence</span><code>src/features/plans/Plans.tsx</code></p></div>
          <div class="choice-list" role="group" aria-label="Choose health gate"><button type="button" aria-pressed="true">Before planning</button><button type="button" aria-pressed="false">Before import</button><button type="button" aria-pressed="false">Warning only</button></div>
        </section>
        <section class="question-card">
          <div><span class="caps">approval</span><h4>How should related writes be approved?</h4><p>The store applies the same completeness gates as CLI and MCP. A grouped preview keeps dependencies inspectable.</p></div>
          <div class="choice-list" role="group" aria-label="Choose approval granularity"><button type="button" aria-pressed="true">One mutation set</button><button type="button" aria-pressed="false">Each task</button></div>
        </section>
        <section class="question-card">
          <div><span class="caps">destination</span><h4>Open a new epic or add to the active epic?</h4><p>The current active epic is <span class="mono">EP-024</span>. The proposed goal is independently reviewable.</p></div>
          <div class="choice-list" role="group" aria-label="Choose destination"><button type="button" aria-pressed="true">New epic</button><button type="button" aria-pressed="false">Use EP-024</button></div>
        </section>
      </div>
      <div class="decision-foot"><button class="button button--ghost" type="button" data-state-target="empty">Back</button><button class="button button--primary" type="button" data-state-target="attachment">Continue with answers</button></div>`,

    attachment: () => `
      <div class="state-heading">
        <div><h3>Add only the evidence this goal needs</h3><p>Attachments are contextual inputs to the ACP session. Uploads do not become board evidence until a proposed action says so and you approve it.</p></div>
        <span class="chip chip--info"><span class="status-dot"></span>optional context</span>
      </div>
      <label class="upload-well" id="uploadWell">
        <input type="file" id="attachmentInput" multiple accept=".md,.txt,.json,.png,.jpg,.jpeg">
        <span><span>${icon("attach")}</span><strong>Drop files or choose from this device</strong><p>Goal docs, architecture notes, or screenshots</p><small>Each file is listed before it enters the trusted ACP session.</small></span>
      </label>
      <div class="attachment-list" id="attachmentList">${renderAttachments()}</div>
      <div class="decision-foot"><button class="button button--ghost" type="button" data-state-target="questioning">Back to decisions</button><button class="button button--primary" type="button" data-state-target="streaming">Inspect repository &amp; draft</button></div>`,

    "agent-health": () => `
      <div class="state-heading">
        <div><h3>Selected agent is ready for a bounded run</h3><p>Capability health is checked by the bridge before the goal is sent. Missing governed task-management skills are blocking, not silently substituted.</p></div>
        <span class="chip chip--ok"><span class="status-dot"></span>preflight passed</span>
      </div>
      <div class="health-cards">
        <section class="health-card"><h4>ACP session</h4><dl><div><dt>Agent</dt><dd>Codex</dd></div><div><dt>Transport</dt><dd class="mono">stdio</dd></div><div><dt>Workspace</dt><dd class="mono">/acme-tooling</dd></div><div><dt>Writes</dt><dd>ask</dd></div></dl></section>
        <section class="health-card"><h4>Governed capabilities</h4><dl><div><dt>Board reads</dt><dd class="status-text status-text--ok"><span class="status-dot"></span>ready</dd></div><div><dt>Plan skills</dt><dd class="status-text status-text--ok"><span class="status-dot"></span>ready</dd></div><div><dt>Board writes</dt><dd class="status-text"><span class="status-dot"></span>permission</dd></div><div><dt>General chat</dt><dd class="status-text status-text--bad"><span class="status-dot"></span>not exposed</dd></div></dl></section>
      </div>
      <div class="decision-foot"><button class="button button--ghost" type="button" data-open-import>Use manual import</button><button class="button button--primary" type="button" data-state-target="empty">Use this agent</button></div>`,

    streaming: () => `
      <div class="state-heading">
        <div><h3>Inspecting the repository</h3><p>AG-UI events expose run and tool progress. The planner shows tool identity, arguments, and result state—not hidden chain-of-thought.</p></div>
        <span class="chip chip--accent"><span class="status-dot"></span>streaming</span>
      </div>
      <div class="tool-stream">
        <div class="stream-head"><div><strong>Step 3 · Map governed work</strong><p>Current activity: read task-management capability contracts.</p></div><div class="stream-meter" role="progressbar" aria-label="Planning progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="64"><span></span></div></div>
        <div class="tool-row is-complete"><span class="tool-row__mark">R</span><div><strong class="mono">tm_show</strong><code>{ "id": "EP-024" }</code></div><span class="chip chip--ok"><span class="status-dot"></span>complete</span></div>
        <div class="tool-row is-complete"><span class="tool-row__mark">R</span><div><strong class="mono">tm_find</strong><code>{ "query": "planner agent health" }</code></div><span class="chip chip--ok"><span class="status-dot"></span>complete</span></div>
        <div class="tool-row is-active"><span class="tool-row__mark">P</span><div><strong class="mono">/task-management:map</strong><code>scope: plans · no writes</code></div><span class="chip chip--accent"><span class="status-dot"></span>running</span></div>
        <div class="tool-row"><span class="tool-row__mark">—</span><div><strong class="mono">proposal.validate</strong><code>waiting for mapped dependencies</code></div><span class="chip"><span class="status-dot"></span>queued</span></div>
      </div>
      <div class="decision-foot"><button class="button button--ghost" type="button" id="cancelRun">Cancel run</button><button class="button" type="button" data-state-target="proposed">Skip to proposal</button></div>`,

    proposed: () => proposalMarkup(false),
    confirmation: () => proposalMarkup(true),

    "validation-failure": () => `
      <div class="state-heading"><div><h3>The store refused one proposed write</h3><p>No partial board mutation is shown as success. The exact server wording persists beside the action that failed and in the event trace.</p></div><span class="chip chip--bad"><span class="status-dot"></span>no changes applied</span></div>
      <section class="reason-panel" role="alert"><div><span class="caps">server refusal · tm_task_create</span><h3>Acceptance criteria are required</h3></div><pre class="server-wording mono">task TM-242 cannot be created: acceptance criteria are required (requireOnCreate)</pre><p>The proposal preview remains available. Fix the missing criteria, validate again, then request a new permission decision.</p><div class="inline-actions"><button class="button button--ghost" type="button" data-state-target="proposed">Inspect proposal</button><button class="button button--primary" type="button" data-state-target="streaming">Revise with agent</button></div></section>`,

    "import-success": () => `
      <div class="state-heading"><div><h3>Goal landed in the shared store</h3><p>The result names every created entity and the new active epic. These are board links, not a conversational success message.</p></div><span class="chip chip--ok"><span class="status-dot"></span>revision 184</span></div>
      <section class="success-panel"><div><span class="caps">import result</span><h3>Landed <a href="#" class="mono">EP-025</a> with 3 tasks</h3></div><div class="result-list"><div class="result-row"><span class="chip chip--ok"><span class="status-dot"></span>epic</span><a href="#">EP-025</a><span>Planner agent preflight</span></div><div class="result-row"><span class="chip"><span class="status-dot"></span>todo</span><a href="#">TM-240</a><span>Expose selected ACP agent</span></div><div class="result-row"><span class="chip"><span class="status-dot"></span>todo</span><a href="#">TM-241</a><span>Gate planning on capability health</span></div><div class="result-row"><span class="chip"><span class="status-dot"></span>todo</span><a href="#">TM-242</a><span>Render permission cards</span></div></div><p><span class="mono">EP-025</span> is now active. The original goal is recorded as <span class="mono">docs/goals/planner-health.md</span>.</p><div class="success-actions"><button class="button button--ghost" type="button" data-state-target="empty">Plan another goal</button><button class="button" type="button" id="openCaptured">Open captured plan</button><button class="button button--primary" type="button" id="openBoard">Open EP-025 on board</button></div></section>`,

    offline: () => `
      <div class="state-heading"><div><h3>The bridge is offline</h3><p>The goal draft remains local. A new agent run cannot start, and no permission request is fabricated while the trusted ACP session is unavailable.</p></div><span class="chip chip--warn"><span class="status-dot"></span>offline</span></div>
      <section class="offline-panel" role="status"><div><span class="caps">last connected 14:35:02</span><h3>Planning paused before any board write</h3></div><p>Fully formed manual imports can use the dashboard outbox. This incomplete agent-planning run cannot be replayed as a write.</p><div class="inline-actions"><button class="button button--ghost" type="button" data-open-import>Prepare manual import</button><button class="button button--primary" type="button" id="retryBridge">Retry connection</button></div></section>`,

    "unavailable-agent": () => `
      <div class="state-heading"><div><h3>The selected planner agent is unavailable</h3><p>The bridge could not start the trusted ACP process. Choose another configured agent or use the unchanged manual import path.</p></div><span class="chip chip--bad"><span class="status-dot"></span>blocking</span></div>
      <section class="unavailable-panel" role="alert"><div><span class="caps">ACP preflight</span><h3>Could not start “Unavailable agent fixture”</h3></div><pre class="server-wording mono">ACP initialize failed: configured command was not found</pre><p>No goal content was sent and no board mutation was proposed.</p><div class="inline-actions"><button class="button button--ghost" type="button" data-open-import>Import goal manually</button><button class="button button--primary" type="button" id="chooseCodex">Select Codex</button></div></section>`,
  };

  function proposalMarkup(permissionOpen) {
    return `
      <div class="state-heading"><div><h3>Review 5 proposed board mutations</h3><p>Each card names the governed skill or tool, exact parameters, consequence, and validation state. Nothing is rendered as conversational prose.</p></div><span class="chip chip--warn"><span class="status-dot"></span>${permissionOpen ? "permission open" : "not applied"}</span></div>
      ${permissionOpen ? `<div class="permission-bar"><div><strong>ACP requests permission for this mutation set</strong><p><span class="mono">session/request_permission · perm_73a1</span> maps to one inspectable confirmation.</p></div><button class="button button--primary" type="button" id="openConfirmation">Review permission</button></div>` : ""}
      <div class="approval-stack">
        <article class="proposal-card is-claimed" tabindex="0"><div class="proposal-head"><div class="proposal-title"><span class="mono faint">01</span><h4>Create epic</h4></div><span class="chip chip--warn"><span class="status-dot"></span>write asks</span></div><p class="proposal-consequence">Adds a new independently reviewable epic to the shared task store.</p><dl class="proposal-params"><div><dt>Tool</dt><dd class="mono">tm_epic_create</dd></div><div><dt>Result id</dt><dd class="mono">EP-025</dd></div><div><dt>Title</dt><dd>Planner agent preflight</dd></div><div><dt>Source</dt><dd class="mono">planner-health.md</dd></div></dl><div class="proposal-actions"><button class="button button--ghost button--compact" type="button" data-detail-toggle>Hide parameters</button><span class="status-text status-text--ok"><span class="status-dot"></span>client validation passed</span></div></article>
        <article class="proposal-card" tabindex="0"><div class="proposal-head"><div class="proposal-title"><span class="mono faint">02–04</span><h4>Create 3 governed tasks</h4></div><span class="chip chip--warn"><span class="status-dot"></span>write asks</span></div><p class="proposal-consequence">Creates three todo tasks with bodies, acceptance criteria, dependencies, and repository touch paths.</p><dl class="proposal-params"><div><dt>Tool</dt><dd class="mono">tm_task_create × 3</dd></div><div><dt>Epic</dt><dd class="mono">EP-025</dd></div><div><dt>Dependencies</dt><dd class="mono">TM-240 → TM-241 → TM-242</dd></div><div><dt>Criteria</dt><dd>8 inspectable checks</dd></div></dl><div class="proposal-actions"><button class="button button--ghost button--compact" type="button" data-detail-toggle>Hide parameters</button><span class="status-text status-text--ok"><span class="status-dot"></span>client validation passed</span></div></article>
        <article class="proposal-card" tabindex="0"><div class="proposal-head"><div class="proposal-title"><span class="mono faint">05</span><h4>Make the new epic active</h4></div><span class="chip chip--warn"><span class="status-dot"></span>write asks</span></div><p class="proposal-consequence">Changes the board’s active epic from <span class="mono">EP-024</span> to <span class="mono">EP-025</span>.</p><dl class="proposal-params"><div><dt>Tool</dt><dd class="mono">tm_epic_use</dd></div><div><dt>Epic</dt><dd class="mono">EP-025</dd></div></dl><div class="proposal-actions"><button class="button button--ghost button--compact" type="button" data-detail-toggle>Hide parameters</button><span class="status-text status-text--ok"><span class="status-dot"></span>client validation passed</span></div></article>
      </div>
      <div class="decision-foot"><button class="button button--ghost" type="button" data-state-target="questioning">Reject set</button><button class="button button--primary" type="button" id="requestApproval">Review &amp; approve 5</button></div>`;
  }

  function renderAttachments() {
    if (!attachedFiles.length) return `<p class="faint">No attachments selected.</p>`;
    return attachedFiles.map((name) => `<div class="attachment-row"><div><strong class="mono">${escapeHtml(name)}</strong><span>ready for session context · not board evidence</span></div><span class="chip chip--ok"><span class="status-dot"></span>ready</span></div>`).join("");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]);
  }

  function renderEvents(state) {
    eventList.innerHTML = stateEvents[state].map(([status, type, detail, time]) => `
      <li class="${status === "done" ? "is-complete" : status === "active" ? "is-active" : ""}">
        <span class="event-mark"></span><div><strong>${type}</strong><code>${detail}</code></div><time>${time}</time>
      </li>`).join("");
  }

  function renderState(state, announce = true) {
    currentState = states.includes(state) ? state : "empty";
    if (currentState !== "unavailable-agent" && agentSelect.value === "unavailable") agentSelect.value = "codex";
    body.dataset.state = currentState;
    scenarioSelect.value = currentState;
    const meta = stateMeta[currentState];
    stateChip.className = `chip${meta.tone ? ` chip--${meta.tone}` : ""}`;
    stateChip.innerHTML = `<span class="status-dot"></span>${meta.label}`;
    stage.innerHTML = templates[currentState]();
    renderEvents(currentState);
    bindDynamicControls();
    setAgentStatus(currentState === "unavailable-agent");

    const nextParams = new URLSearchParams(window.location.search);
    nextParams.set("state", currentState);
    window.history.replaceState(null, "", `${window.location.pathname}?${nextParams.toString()}`);
    if (announce) liveRegion.textContent = `Mockup scenario: ${meta.label}.`;

    if (currentState === "confirmation") {
      window.requestAnimationFrame(() => {
        if (!confirmDialog.open) confirmDialog.showModal();
      });
    } else if (confirmDialog.open) {
      confirmDialog.close("state-change");
    }
  }

  function bindDynamicControls() {
    stage.querySelectorAll("[data-state-target]").forEach((button) => button.addEventListener("click", () => renderState(button.dataset.stateTarget)));
    stage.querySelectorAll("[data-open-import]").forEach((button) => button.addEventListener("click", openImport));
    stage.querySelectorAll(".choice-list button").forEach((button) => button.addEventListener("click", () => {
      button.closest(".choice-list").querySelectorAll("button").forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button)));
      liveRegion.textContent = `Selected ${button.textContent.trim()}.`;
    }));
    stage.querySelectorAll("[data-detail-toggle]").forEach((button) => button.addEventListener("click", () => {
      const paramsBlock = button.closest(".proposal-card").querySelector(".proposal-params");
      const hidden = !paramsBlock.hidden;
      paramsBlock.hidden = hidden;
      button.textContent = hidden ? "Show parameters" : "Hide parameters";
    }));

    const begin = stage.querySelector("#beginPlanning");
    if (begin) begin.addEventListener("click", () => renderState("questioning"));
    const request = stage.querySelector("#requestApproval");
    if (request) request.addEventListener("click", () => renderState("confirmation"));
    const openConfirmation = stage.querySelector("#openConfirmation");
    if (openConfirmation) openConfirmation.addEventListener("click", () => {
      if (!confirmDialog.open) confirmDialog.showModal();
    });
    const cancelRun = stage.querySelector("#cancelRun");
    if (cancelRun) cancelRun.addEventListener("click", () => renderState("empty"));
    const retryBridge = stage.querySelector("#retryBridge");
    if (retryBridge) retryBridge.addEventListener("click", () => renderState("agent-health"));
    const chooseCodex = stage.querySelector("#chooseCodex");
    if (chooseCodex) chooseCodex.addEventListener("click", () => {
      agentSelect.value = "codex";
      renderState("agent-health");
    });
    const openCaptured = stage.querySelector("#openCaptured");
    if (openCaptured) openCaptured.addEventListener("click", () => { liveRegion.textContent = "Captured plan EP-025 would open in the existing Plans preview."; });
    const openBoard = stage.querySelector("#openBoard");
    if (openBoard) openBoard.addEventListener("click", () => { liveRegion.textContent = "Epic EP-025 would open in the existing board inspector."; });
    const attachmentInput = stage.querySelector("#attachmentInput");
    const uploadWell = stage.querySelector("#uploadWell");
    if (attachmentInput && uploadWell) {
      attachmentInput.addEventListener("change", () => {
        const names = Array.from(attachmentInput.files || []).map((file) => file.name);
        attachedFiles = Array.from(new Set([...attachedFiles, ...names]));
        stage.querySelector("#attachmentList").innerHTML = renderAttachments();
        liveRegion.textContent = `${names.length} attachment${names.length === 1 ? "" : "s"} added to session context.`;
      });
      ["dragenter", "dragover"].forEach((name) => uploadWell.addEventListener(name, (event) => { event.preventDefault(); uploadWell.classList.add("is-dragging"); }));
      ["dragleave", "drop"].forEach((name) => uploadWell.addEventListener(name, (event) => { event.preventDefault(); uploadWell.classList.remove("is-dragging"); }));
      uploadWell.addEventListener("drop", (event) => {
        const names = Array.from(event.dataTransfer.files || []).map((file) => file.name);
        attachedFiles = Array.from(new Set([...attachedFiles, ...names]));
        stage.querySelector("#attachmentList").innerHTML = renderAttachments();
        liveRegion.textContent = `${names.length} dropped attachment${names.length === 1 ? "" : "s"} added to session context.`;
      });
    }
  }

  function setAgentStatus(unavailable) {
    if (unavailable) {
      agentSelect.value = "unavailable";
      agentHealth.innerHTML = `<span class="chip chip--bad"><span class="status-dot"></span>ACP unavailable</span><span class="chip chip--bad"><span class="status-dot"></span>skills unknown</span><span class="chip"><span class="status-dot"></span>no run</span>`;
      traceAgentName.textContent = "Unavailable fixture";
      healthList.innerHTML = `<div><dt>AG-UI stream</dt><dd><span class="status-text status-text--ok"><span class="status-dot"></span>connected</span></dd></div><div><dt>ACP session</dt><dd><span class="status-text status-text--bad"><span class="status-dot"></span>not started</span></dd></div><div><dt>Task skills</dt><dd><span class="status-text status-text--bad"><span class="status-dot"></span>unknown</span></dd></div><div><dt>Board writes</dt><dd><span class="status-text"><span class="status-dot"></span>not requested</span></dd></div>`;
    } else {
      const names = { codex: "Codex", kimi: "Kimi Code", "claude-acp": "Claude Code" };
      traceAgentName.textContent = names[agentSelect.value] || "Codex";
      agentHealth.innerHTML = `<span class="chip chip--ok"><span class="status-dot"></span>ACP connected</span><span class="chip chip--ok"><span class="status-dot"></span>skills ready</span><span class="chip"><span class="status-dot"></span>write asks</span>`;
      healthList.innerHTML = `<div><dt>AG-UI stream</dt><dd><span class="status-text status-text--ok"><span class="status-dot"></span>connected</span></dd></div><div><dt>ACP session</dt><dd><span class="status-text status-text--ok"><span class="status-dot"></span><span class="mono">planner-17f2</span></span></dd></div><div><dt>Task skills</dt><dd><span class="status-text status-text--ok"><span class="status-dot"></span>available</span></dd></div><div><dt>Board writes</dt><dd><span class="status-text"><span class="status-dot"></span>confirm each set</span></dd></div>`;
    }
  }

  function openImport() {
    if (!importDialog.open) importDialog.showModal();
  }

  scenarioSelect.addEventListener("change", () => renderState(scenarioSelect.value));

  document.querySelector("#themeButton").addEventListener("click", () => {
    const next = root.dataset.bdTheme === "dark" ? "light" : "dark";
    root.dataset.bdTheme = next;
    document.querySelector("#themeLabel").textContent = next === "dark" ? "Light" : "Dark";
    const nextParams = new URLSearchParams(window.location.search);
    nextParams.set("theme", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${nextParams.toString()}`);
    liveRegion.textContent = `${next} theme.`;
  });

  agentSelect.addEventListener("change", () => {
    if (agentSelect.value === "unavailable") renderState("unavailable-agent");
    else {
      setAgentStatus(false);
      renderState("agent-health");
    }
  });

  document.querySelector("#inspectHealthButton").addEventListener("click", () => {
    renderState("agent-health");
    if (window.matchMedia("(max-width: 719px)").matches) {
      body.dataset.traceOpen = "true";
      document.querySelector("#traceToggle").setAttribute("aria-expanded", "true");
    } else document.querySelector("#traceHeading").focus?.();
  });

  document.querySelector("#retryHealthButton").addEventListener("click", () => {
    setAgentStatus(currentState === "unavailable-agent");
    liveRegion.textContent = currentState === "unavailable-agent" ? "Agent is still unavailable." : "Capability health rechecked: ready.";
  });

  document.querySelector("#traceToggle").addEventListener("click", () => {
    const open = body.dataset.traceOpen !== "true";
    body.dataset.traceOpen = String(open);
    document.querySelector("#traceToggle").setAttribute("aria-expanded", String(open));
    if (open) document.querySelector("#traceClose").focus();
  });

  document.querySelector("#traceClose").addEventListener("click", () => {
    body.dataset.traceOpen = "false";
    document.querySelector("#traceToggle").setAttribute("aria-expanded", "false");
    document.querySelector("#traceToggle").focus();
  });

  document.querySelector("#importGoalButton").addEventListener("click", openImport);
  document.querySelector("#capturedPlansButton").addEventListener("click", () => { liveRegion.textContent = "Captured plans inbox would open without replacing the planner draft."; });

  document.querySelectorAll("[data-import-mode]").forEach((button) => button.addEventListener("click", () => {
    const mode = button.dataset.importMode;
    document.querySelectorAll("[data-import-mode]").forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
    document.querySelectorAll("[data-import-panel]").forEach((panel) => { panel.hidden = panel.dataset.importPanel !== mode; });
  }));

  document.querySelector("#importSubmit").addEventListener("click", (event) => {
    event.preventDefault();
    const pathMode = document.querySelector('[data-import-mode="path"]').getAttribute("aria-pressed") === "true";
    const value = pathMode ? document.querySelector("#goalPath").value.trim() : document.querySelector("#goalDoc").value.trim();
    if (!value) {
      liveRegion.textContent = "Import needs a repo-relative path or goal document.";
      return;
    }
    importDialog.close("imported");
    renderState("import-success");
  });

  document.querySelector("#confirmCheck").addEventListener("change", (event) => {
    document.querySelector("#confirmApply").disabled = !event.target.checked;
  });

  document.querySelector("#confirmApply").addEventListener("click", (event) => {
    event.preventDefault();
    if (!document.querySelector("#confirmCheck").checked) return;
    confirmDialog.close("approved");
    renderState("import-success");
  });

  document.querySelector("#backToReview").addEventListener("click", (event) => {
    event.preventDefault();
    confirmDialog.close("cancel");
    renderState("proposed");
  });

  confirmDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    confirmDialog.close("cancel");
    renderState("proposed");
  });

  confirmDialog.addEventListener("close", () => {
    if (currentState === "confirmation" && !["approved", "state-change"].includes(confirmDialog.returnValue)) renderState("proposed");
  });

  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
    if (typing || importDialog.open || confirmDialog.open) return;
    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      const direction = event.key === "]" ? 1 : -1;
      const index = states.indexOf(currentState);
      renderState(states[(index + direction + states.length) % states.length]);
    }
    if (event.key === "Escape" && body.dataset.traceOpen === "true") {
      body.dataset.traceOpen = "false";
      document.querySelector("#traceToggle").setAttribute("aria-expanded", "false");
    }
  });

  if (params.get("capture") === "1") body.classList.add("capture");
  const initialTheme = params.get("theme") === "light" ? "light" : "dark";
  root.dataset.bdTheme = initialTheme;
  document.querySelector("#themeLabel").textContent = initialTheme === "dark" ? "Light" : "Dark";
  renderState(currentState, false);
})();
