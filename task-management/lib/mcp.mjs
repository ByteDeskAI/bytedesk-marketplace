/**
 * The store as MCP tools. Same data, same gates as `tm` — an agent that reaches
 * for a tool must not get an easier ride than one that shells out to the CLI.
 *
 * handleRequest is pure (request in, response out) so the protocol is testable
 * without a process; bin/tm-mcp is nothing but the stdin loop around it.
 *
 * ponytail: tool definitions carry their own `run`, so there is one list to keep
 * in sync instead of a definitions table plus a dispatch switch.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { currentCheckout, paths } from "./paths.mjs";
import { claimTask, claimant, releaseClaim } from "./claims.mjs";
import { actor, actorLabel, sessionId, stamp } from "./actor.mjs";
import { config, create, editTask, kindOf, list, logEvent, moveTask, nextTasks, now, read, readEvents, removeCriterion, setCriterion, staleTasks, state, update, writeState } from "./store.mjs";
import { gateDone, gateStart, gateTaskCreate } from "./enforce.mjs";
import { COLUMNS, board, collapseLog, handoff, renderHistory, sprintReport, standup, taskLine } from "./render.mjs";
import { graphData, mermaid, renderWhy, why } from "./graph.mjs";
import { MAX_CHARS, listResources, readResource } from "./resources.mjs";
import { describeQuery, matchesQuery, parseQuery } from "./query.mjs";
import { accept, drop, propose, ranked, score, ship } from "./capability.mjs";
import { attachEvidence } from "./evidence.mjs";
import { LINK_TYPES, TYPES, addComment, addLink, assign, dependencies, estimate, labelCatalog, labels as setLabels, prioritise, rank, removeLink, setType, subtasks } from "./issue.mjs";
import { listWorktrees, provision, unprovision } from "./worktree.mjs";
import { diagnose, render as renderDoctor, repairAll } from "./doctor.mjs";
import { FORMATS, exportStore } from "./export.mjs";
import { cycleTime, summary as timeSummary, taskTimeline, throughput, timeInStatus } from "./time.mjs";
import { batches } from "./parallel.mjs";
import { importGoalDoc, importManifest } from "./goal-import.mjs";
import { record as recordTouches } from "./touches.mjs";
import { CATALOG } from "./ntfy.mjs";
import { heartbeatAgent, listAgents, reapAgents, renderAgents } from "./agents.mjs";
import { dispatch } from "./dispatch/index.mjs";
import { envRegistry } from "./dispatch/backend.mjs";
import { collect } from "./dispatch/collect.mjs";

/**
 * MCP `serverInfo.version` must be a non-empty string on the wire.
 *
 * Prefer the plugin manifest when it still declares `version`. Internal ByteDesk plugins often
 * omit that field so installs track by commit SHA (directory names like `30ee6c8dd411`); in that
 * case advertise the install-dir SHA when it looks like one. Never leave the field out — Grok's
 * MCP client type-checks InitializeResult and fails the whole handshake when `version` is
 * missing (`CustomResult` instead of `InitializeResult`), which is how tools silently vanish.
 *
 * Do not hardcode a semver here: that reintroduces the "handshake version ≠ plugin identity"
 * drift `tests/unit/mcp.test.mjs` exists to catch.
 */
const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const serverVersion = () => {
  try {
    const v = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8")).version;
    if (v != null && String(v).length > 0) return String(v);
  } catch {
    // fall through
  }
  const dir = basename(PLUGIN_ROOT);
  if (/^[0-9a-f]{7,40}$/i.test(dir)) return dir;
  /**
   * A source checkout: no manifest version by design, and no SHA in the path to read.
   *
   * `dev` was the honest answer and a useless one — every build says it, so a client cannot tell
   * which code it is talking to, which is the only reason the handshake carries a version. Ask git
   * instead, and let it say `-dirty` when the working tree has moved on: a client comparing two
   * handshakes should be able to see that they differ.
   */
  try {
    const sha = execFileSync("git", ["-C", PLUGIN_ROOT, "describe", "--always", "--dirty"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (sha) return sha;
  } catch {
    // not a repo, or no git — `dev` is then true rather than merely default
  }
  return "dev";
};

export const SERVER_INFO = { name: "task-management", version: serverVersion() };

const ok = (fields = {}) => ({ ok: true, ...fields });
const fail = (error) => ({ ok: false, error });
const session = () => sessionId();

/** Task fields the CLI stamps on creation; kept identical so both paths produce one shape. */
const NEW_TASK = { acceptance: [], evidence: [], commits: [], blockedBy: [], blocks: [] };

const str = (description) => ({ type: "string", description });
/** Doctor findings carry a fix closure; JSON cannot. */
const plain = (findings) => findings.map(({ fix, ...f }) => f);
/** The resources' cap, for the same reason: a 5 MB export is not a tool result. */
const clamp = (text) => (text.length <= MAX_CHARS ? text : `${text.slice(0, MAX_CHARS)}\n\n…truncated at ${MAX_CHARS} characters. Use the CLI for the whole thing.`);

// ── tools ────────────────────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: "tm_board",
    description:
      "The whole board as text: active epic, in-progress, blocked, open, parked and stale tasks. Read this first when resuming a session or when you are unsure what is already tracked — the store is the truth, your memory is not.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, p) => ok({ board: board(p) }),
  },
  {
    name: "tm_next",
    description:
      "The tasks that are open with every dependency satisfied. Use when you are asking 'what should I work on now' instead of guessing from the board.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, p) => ok({ tasks: nextTasks(p).map((t) => ({ id: t.id, title: t.title, line: taskLine(t) })) }),
  },
  {
    name: "tm_show",
    description:
      "Full record for one epic, task or ADR (EP-/TM-/ADR- id), including body, acceptance criteria, evidence and commits. Use before editing or closing anything, so you act on the stored state rather than the summary you remember.",
    inputSchema: { type: "object", properties: { id: str("Entity id, e.g. TM-001, EP-002, ADR-0001.") }, required: ["id"] },
    run: ({ id }, p) => {
      const doc = read(id, p);
      return doc ? ok({ doc }) : fail(`not found: ${id}`);
    },
  },
  {
    name: "tm_find",
    description:
      "Search every epic, task and ADR. Bare words are a case-insensitive substring over titles and bodies; `field:value` tokens narrow, and a leading `-` negates one. Fields: status, epic, assignee, actor, priority, type, label, kind, id. Use before creating anything to avoid filing a duplicate, to locate the id behind a half-remembered title, or to answer a question about the board directly — `assignee:ryan status:open`, `type:bug -label:stale` — rather than reading the whole board and filtering it yourself.",
    inputSchema: {
      type: "object",
      properties: { query: str('Words and/or field:value tokens, e.g. `status:open priority:highest "auth"`.') },
      required: ["query"],
    },
    run: ({ query }, p) => {
      let parsed;
      try {
        // Tokenised on whitespace, so one string carries the same query the CLI takes as argv.
        parsed = parseQuery(String(query).split(/\s+/).filter(Boolean));
      } catch (e) {
        return fail(e.message);
      }
      const hits = [];
      for (const kind of ["epic", "task", "adr", "capability"]) {
        for (const d of list(kind, {}, p)) {
          if (matchesQuery({ ...d, kind }, parsed)) hits.push({ id: d.id, kind, title: d.title });
        }
      }
      return ok({ hits, query: describeQuery(parsed) });
    },
  },
  {
    name: "tm_why",
    description:
      "Why a task cannot be started, walked to the root of its dependency chain: transitive blockers with the reason at each hop, a claim another session holds, a hand-written block, the WIP limit, dependency cycles, dangling refs. Call this instead of reading blockedBy — that field names the neighbour, this names the task to actually go and do. Returns `roots`: the unblocked work at the bottom of the chain.",
    inputSchema: { type: "object", properties: { id: str("Task id, e.g. TM-001.") }, required: ["id"] },
    run: ({ id }, p) => {
      const w = why(id, p);
      return w ? ok({ ...w, text: renderWhy(w) }) : fail(`not found: ${id}`);
    },
  },
  {
    name: "tm_log",
    description:
      "The tail of the append-only event log (creates, updates, gate decisions, overrides). Use to answer 'what actually happened' — including what a previous session or another agent did.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", description: "How many recent events. Defaults to 20." } },
    },
    run: ({ limit = 20 }, p) => {
      if (!existsSync(p.events)) return ok({ events: [] });
      const rows = readFileSync(p.events, "utf8")
        .split("\n")
        .filter(Boolean)
        .slice(-Number(limit))
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      return ok({ events: rows });
    },
  },
  {
    name: "tm_standup",
    description:
      "What changed since a timestamp, grouped per task, straight from the event log. Use for handover writeups and 'what did we get done yesterday' — it reports events, not recollection.",
    inputSchema: { type: "object", properties: { since: str("ISO timestamp. Defaults to 24h ago.") } },
    run: ({ since }, p) => ok({ standup: standup(since || new Date(Date.now() - 86_400_000).toISOString(), p) }),
  },
  {
    name: "tm_epic",
    description:
      "List epics, open a new one, or switch the active one. Call this FIRST when starting a new line of work: task creation is gated on an active epic, so tm_task_create fails until an epic is active.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "new", "use", "done"], description: "Defaults to list." },
        title: str("Title for action=new."),
        id: str("Epic id for action=use / action=done."),
      },
    },
    run: ({ action = "list", title, id }, p) => {
      if (action === "new") {
        if (!title) return fail("tm_epic new needs a title");
        const e = create("epic", { title, session: session() || undefined }, "", p);
        writeState({ activeEpic: e.id }, p);
        return ok({ id: e.id, title, active: true, file: e.file });
      }
      if (action === "use") {
        const epic = read(id, p);
        if (!epic) return fail(`no such epic: ${id}`);
        if (kindOf(id) !== "epic") return fail(`not an epic id: ${id}`);
        if (epic.status === "done") return fail(`${id} is done — reopen it or pick another epic`);
        writeState({ activeEpic: id }, p);
        logEvent("epic_active", { id }, p);
        return ok({ activeEpic: id });
      }
      if (action === "done") {
        if (!id) return fail("tm_epic done needs an id");
        const e = update(id, { status: "done", closed: now() }, p);
        if (state(p).activeEpic === id) writeState({ activeEpic: null }, p);
        return ok({ id: e.id, status: "done", closed: e.closed });
      }
      const active = state(p).activeEpic;
      return ok({
        activeEpic: active,
        epics: list("epic", {}, p).map((e) => {
          const kids = list("task", { epic: e.id }, p);
          return {
            id: e.id,
            title: e.title,
            status: e.status,
            active: e.id === active,
            done: kids.filter((t) => t.status === "done").length,
            total: kids.length,
          };
        }),
      });
    },
  },
  {
    name: "tm_task_create",
    description:
      "File a task under the active epic. Use for any unit of work that outlives one message. Gated: with no active epic this is refused with instructions — open one with tm_epic first rather than working untracked.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("Short imperative title."),
        body: str("Optional context: what, why, where to look."),
        acceptance: {
          type: "array",
          items: { type: "string" },
          description: "Acceptance criteria. Closing the task is gated on ticking these, so write them now.",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Labels to apply at create. Decision roles (decision:interview|research|prototype|unblock) are exclusive; triage roles too.",
        },
      },
      required: ["title"],
    },
    run: ({ title, body = "", acceptance = [], labels: tagList = [] }, p) => {
      const gate = gateTaskCreate(p);
      if (!gate.allow) return fail(gate.reason);
      const t = create(
        "task",
        {
          title,
          epic: state(p).activeEpic || null,
          ...NEW_TASK,
          acceptance: acceptance.map((text) => ({ text, done: false })),
          session: session() || undefined,
        },
        body,
        p,
      );
      if (tagList.length) setLabels(t.id, { add: tagList }, p);
      return ok({ id: t.id, title, epic: t.epic, file: t.file, labels: read(t.id, p).labels || [] });
    },
  },
  {
    name: "tm_task_update",
    description:
      "Move a task through its lifecycle: start, done, park, block, unblock, delete (soft — the file stays, restore brings it back). Call start before you touch code and done the moment it is verified — never leave a task in_progress at the end of a session. done is gated on met acceptance criteria; start is gated on the WIP limit.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Task id, e.g. TM-001."),
        action: { type: "string", enum: ["start", "done", "park", "block", "unblock", "delete", "restore"], description: "Lifecycle move." },
        reason: str("Why, for park, block and delete. Recorded on the task."),
        steal: {
          type: "boolean",
          description:
            "For start: take a task another live session holds. Refused without this, and recorded as claim_stolen when used — so taking someone's work is deliberate and traceable rather than silent.",
        },
      },
      required: ["id", "action"],
    },
    run: ({ id, action, reason, steal }, p) => {
      if (!read(id, p)) return fail(`not found: ${id}`);
      switch (action) {
        case "start": {
          const gate = gateStart(id, p);
          if (!gate.allow) return fail(gate.reason);
          // The interlock, through the one function that implements it. This used to be a
          // bare writeState, so the path Claude actually uses silently took whatever the CLI
          // refused — and the record it wrote dropped actor/worktree/branch/pid, which is what
          // expired() reads to notice a dead worktree. Claim BEFORE the status change, or a
          // refusal leaves a task in_progress that nobody holds.
          const claimed = claimTask(id, {
            session: session(),
            actor: actorLabel(actor()),
            worktree: p.root,
            steal: Boolean(steal),
            p,
          });
          if (!claimed.ok) return fail(claimed.reason);
          update(id, { status: "in_progress", session: session() || undefined }, p);
          return ok({ id, status: "in_progress", ...(claimed.stolenFrom ? { stolenFrom: claimed.stolenFrom } : {}) });
        }
        case "done": {
          const gate = gateDone(id, p);
          if (!gate.allow) return fail(gate.reason);
          update(id, { status: "done", closed: now() }, p);
          // releaseClaim, not a hand-rolled delete: it takes the lock and logs `release`,
          // which the MCP path never recorded.
          releaseClaim(id, p);
          logEvent("done", { id }, p);
          return ok({
            id,
            status: "done",
            unblocked: nextTasks(p).filter((t) => (t.blockedBy || []).includes(id)).map((t) => t.id),
          });
        }
        case "park":
          update(id, { status: "parked", parkedReason: reason || undefined }, p);
          return ok({ id, status: "parked" });
        case "block":
          update(id, { status: "blocked", blockedReason: reason || undefined }, p);
          return ok({ id, status: "blocked" });
        case "unblock":
          update(id, { status: "open", blockedReason: undefined }, p);
          return ok({ id, status: "open" });
        case "delete": {
          // Same rules as the board's delete: soft, and never someone else's in-flight work.
          const task = read(id, p);
          if (task.status === "deleted") return fail(`${id} is already deleted`);
          const held = claimant(id, p);
          if (held && held.session && held.session !== session()) {
            return fail(`${id} is claimed by ${held.actor || `session ${held.session}`} — release it first`);
          }
          const why = typeof reason === "string" && reason.trim() ? reason.trim() : undefined;
          update(id, { status: "deleted", deletedReason: why, deletedFrom: task.status }, p);
          releaseClaim(id, p);
          logEvent("deleted", { id, from: task.status, ...(why ? { why } : {}) }, p);
          return ok({ id, status: "deleted" });
        }
        case "restore": {
          const task = read(id, p);
          if (task.status !== "deleted") return fail(`${id} is not deleted`);
          const back = COLUMNS.includes(task.deletedFrom) && task.deletedFrom !== "done" ? task.deletedFrom : "open";
          update(id, { status: back, deletedReason: undefined, deletedFrom: undefined }, p);
          logEvent("reopened", { id, from: "deleted" }, p);
          return ok({ id, status: back });
        }
        default:
          return fail(`unknown action: ${action}`);
      }
    },
  },
  {
    name: "tm_task_edit",
    description:
      "Correct a task's title or body, or refile it under a different epic. Use it the moment you notice the title says the wrong thing — every other field has a tool, and for a long time these did not, so a typo made at create time survived to the export. Moving to an epic that is already done reopens that epic; moving the last unfinished task out of an epic closes it. Pass epic:\"none\" to detach.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Task id."),
        title: str("The corrected title. Omit to leave it."),
        body: str("Replacement markdown body. Omit to leave it; pass \"\" to empty it."),
        epic: str('Destination epic id, or "none" to detach.'),
      },
      required: ["id"],
    },
    run: ({ id, title, body, epic }, p) => {
      const t = read(id, p);
      if (!t) return fail(`not found: ${id}`);
      if (title === undefined && body === undefined && epic === undefined) {
        return fail("tm_task_edit needs a title, a body or an epic");
      }
      try {
        const res = { id };
        if (title !== undefined || body !== undefined) res.edited = editTask(id, { title, body }, p).changed;
        if (epic !== undefined) Object.assign(res, moveTask(id, epic, p));
        return ok(res);
      } catch (e) {
        return fail(e.message);
      }
    },
  },
  {
    name: "tm_ac_add",
    description:
      "Append an acceptance criterion to a task — one verifiable statement, not a restatement of the title. Add these when the task is created; closing it is gated on them being ticked.",
    inputSchema: {
      type: "object",
      properties: { id: str("Task id."), text: str("One verifiable criterion.") },
      required: ["id", "text"],
    },
    run: ({ id, text }, p) => {
      const t = read(id, p);
      if (!t) return fail(`not found: ${id}`);
      const acceptance = [...(t.acceptance || []), { text, done: false }];
      update(id, { acceptance }, p);
      return ok({ id, index: acceptance.length, acceptance });
    },
  },
  {
    name: "tm_ac_accept",
    description:
      "Tick an acceptance criterion once it is verifiably true — `.bytedesk/task-management/bin/tm done` is gated on all of them. Pass undo:true to untick one ticked by mistake, or remove:true to delete a criterion that should never have been there (removing renumbers the ones after it).",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Task id."),
        index: { type: "number", description: "1-based position in the acceptance list." },
        undo: { type: "boolean", description: "Untick instead of ticking." },
        remove: { type: "boolean", description: "Delete the criterion outright. Renumbers the rest." },
      },
      required: ["id", "index"],
    },
    run: ({ id, index, undo, remove }, p) => {
      try {
        if (remove) {
          const res = removeCriterion(id, index, p);
          return ok({ id, removed: res.removed, acceptance: res.acceptance });
        }
        const res = setCriterion(id, index, !undo, p);
        return ok({ id, met: res.met, acceptance: res.acceptance });
      } catch (e) {
        return fail(e.message);
      }
    },
  },

  {
    name: "tm_evidence",
    description:
      "Attach proof to a task — test output, a benchmark, a screenshot path. Use whenever you claim something works: the store keeps evidence, not assertions.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Task id."),
        text: str("Inline output to store as a log file."),
        path: str("Path to an existing file to copy into the store instead."),
      },
      required: ["id"],
    },
    run: ({ id, text, path }, p) => {
      if (!read(id, p)) return fail(`not found: ${id}`);
      if (!text && !path) return fail("tm_evidence needs text or path");
      try {
        const { ref } = attachEvidence(id, path ? { path } : { text }, p);
        return ok({ id, evidence: ref });
      } catch (e) {
        return fail(e.message);
      }
    },
  },
  {
    name: "tm_adr_new",
    description:
      "Record an architecture decision: context, decision, consequences. Use the moment a choice is made that someone would otherwise have to reverse-engineer from the diff — a decision left in the transcript is a decision lost.",
    inputSchema: {
      type: "object",
      properties: { title: str("The decision, stated as a decision."), body: str("Markdown; defaults to the ADR skeleton.") },
      required: ["title"],
    },
    run: ({ title, body }, p) => {
      const a = create(
        "adr",
        { title, status: "proposed", epic: state(p).activeEpic || null, deciders: [], date: now().slice(0, 10) },
        body || "## Context\n\n## Decision\n\n## Consequences\n",
        p,
      );
      return ok({ id: a.id, file: a.file });
    },
  },
  {
    name: "tm_cap_propose",
    description:
      "Propose a product capability: a problem worth solving, sized (impact/effort/confidence) with acceptance criteria, before anyone commits to building it. Use during /enhance or whenever the answer to 'what should we build next' needs to outlive the session. Proposing is not committing — `tm_cap_accept` is what turns it into work.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("The capability, stated as the outcome a user gets."),
        area: str("Product area, e.g. ux, platform, ops. Default: product."),
        impact: str("H | M | L — how much it moves the product. Default M."),
        effort: str("S | M | L — how much it costs to build. Default M."),
        confidence: str("H | M | L — how sure you are it is the right thing. Default M."),
        source: str("Where it came from: research, operator, incident, gap-backlog."),
        problem: str("Problem / job-to-be-done."),
        current: str("What the product does today."),
        proposal: str("The proposed enhancement."),
        criteria: { type: "array", items: { type: "string" }, description: "Acceptance criteria; they become the task's gate on accept." },
        nonGoals: { type: "array", items: { type: "string" }, description: "Explicitly out of scope." },
      },
      required: ["title"],
    },
    run: (args, p) => {
      try {
        const c = propose(args, p);
        return ok({ id: c.id, file: c.file, score: score(c) });
      } catch (e) {
        return fail(e.message);
      }
    },
  },
  {
    name: "tm_cap_list",
    description:
      "The enhancement backlog, best bet first (impact × ease × confidence). Read this before proposing anything — a capability that is already on the board must not be proposed twice.",
    inputSchema: {
      type: "object",
      properties: { status: str("Filter: open (proposed), in_progress (accepted), done (shipped), deleted (dropped).") },
    },
    run: ({ status }, p) =>
      ok({
        capabilities: ranked(p, status ? { status } : {}).map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          area: c.area,
          impact: c.impact,
          effort: c.effort,
          confidence: c.confidence,
          score: score(c),
          task: c.task || null,
        })),
      }),
  },
  {
    name: "tm_cap_accept",
    description:
      "Accept a capability and mint the task that builds it: its acceptance criteria become the task's gate and the two are linked, so the reason for the work survives the session that proposed it. Call only when the user has agreed to build this one.",
    inputSchema: { type: "object", properties: { id: str("Capability id, e.g. CAP-0046.") }, required: ["id"] },
    run: ({ id }, p) => {
      try {
        const res = accept(id, p);
        return ok({ id: res.cap.id, task: res.task.id, existing: Boolean(res.existing) });
      } catch (e) {
        return fail(e.message);
      }
    },
  },
  {
    name: "tm_cap_ship",
    description:
      "Mark a capability shipped. Refuses without evidence — attach it with tm_evidence first. A capability is never shipped on assertion.",
    inputSchema: {
      type: "object",
      properties: { id: str("Capability id."), evidence: str("Optional extra reference: commit, test path, cutover PASS.") },
      required: ["id"],
    },
    run: ({ id, evidence }, p) => {
      try {
        const doc = ship(id, { evidence }, p);
        return ok({ id: doc.id, shipped: doc.shipped });
      } catch (e) {
        return fail(e.message);
      }
    },
  },
  {
    name: "tm_cap_drop",
    description:
      "Drop a capability from the enhancement backlog. The record stays readable with the reason; this is not a delete. Use when the operator has decided not to build it.",
    inputSchema: {
      type: "object",
      properties: { id: str("Capability id."), why: str("Why it is being dropped.") },
      required: ["id"],
    },
    run: ({ id, why }, p) => {
      try {
        const doc = drop(id, why, p);
        return ok({ id: doc.id, status: doc.status, droppedReason: doc.droppedReason || "" });
      } catch (e) {
        return fail(e.message);
      }
    },
  },
  {
    name: "tm_sprint",
    description:
      "List sprints, open a new one, switch the active one, commit or remove tasks, close, or show the report. Same verbs as `tm sprint`. Creating a sprint sets it active; closing does not evaporate unfinished cards. Add requires an active sprint.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["show", "new", "use", "add", "rm", "done", "list"],
          description: "Defaults to show.",
        },
        title: str("Title for action=new."),
        id: str("Sprint id for show/use/done. Defaults to the active sprint."),
        ends: str("Optional YYYY-MM-DD end date for action=new."),
        tasks: { type: "array", items: { type: "string" }, description: "Task ids for action=add / action=rm." },
      },
    },
    run: ({ action = "show", title, id, ends, tasks = [] }, p) => {
      const active = () => state(p).activeSprint || null;

      if (action === "new") {
        if (!title) return fail("tm_sprint new needs a title");
        const until = typeof ends === "string" && ends.trim() ? ends.trim() : undefined;
        const doc = create("sprint", { title, status: "open", ...(until ? { ends: until } : {}) }, "", p);
        writeState({ activeSprint: doc.id }, p);
        logEvent("sprint", { id: doc.id, action: "new" }, p);
        return ok({ id: doc.id, title, active: true, file: doc.file, ends: doc.ends });
      }

      if (action === "use") {
        if (!id) return fail("tm_sprint use needs an id");
        if (!read(id, p)) return fail(`not found: ${id}`);
        writeState({ activeSprint: id }, p);
        return ok({ activeSprint: id });
      }

      if (action === "add" || action === "rm") {
        const sprintId = active();
        if (!sprintId && action === "add") {
          return fail('no active sprint — `.bytedesk/task-management/bin/tm sprint new "<name>"` or `.bytedesk/task-management/bin/tm sprint use <SP-id>`');
        }
        const moved = [];
        for (const task of tasks) {
          if (!read(task, p)) return fail(`not found: ${task}`);
          update(task, { sprint: action === "add" ? sprintId : undefined }, p);
          moved.push(task);
        }
        logEvent("sprint", { id: sprintId, action, tasks: moved }, p);
        return ok({ id: sprintId, action, tasks: moved });
      }

      if (action === "done") {
        const sprintId = id || active();
        if (!sprintId) return fail("no active sprint");
        if (!read(sprintId, p)) return fail(`not found: ${sprintId}`);
        update(sprintId, { status: "done", closed: now() }, p);
        if (active() === sprintId) writeState({ activeSprint: null }, p);
        logEvent("sprint", { id: sprintId, action: "done" }, p);
        const left = list("task", {}, p).filter((t) => t.sprint === sprintId && t.status !== "done");
        return ok({ id: sprintId, status: "done", unfinished: left.length });
      }

      if (action === "list") {
        const rows = list("sprint", {}, p);
        return ok({
          activeSprint: active(),
          sprints: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, ends: r.ends })),
        });
      }

      if (action === "show") {
        const sprintId = id || active();
        if (!sprintId) return fail('no active sprint — `.bytedesk/task-management/bin/tm sprint new "<name>"`');
        const doc = read(sprintId, p);
        if (!doc) return fail(`not found: ${sprintId}`);
        return ok({ doc, report: sprintReport(sprintId, p) });
      }

      return fail('usage: .bytedesk/task-management/bin/tm sprint [show|new "<name>"|use <id>|add <task>...|rm <task>...|done|list]');
    },
  },
  {
    name: "tm_handoff",
    description:
      "A self-contained brief for one task: epic context, branch, acceptance criteria, evidence, commits. Use when spawning a subagent, opening a worktree, or leaving work for tomorrow — paste this instead of re-explaining.",
    inputSchema: { type: "object", properties: { id: str("Task id.") }, required: ["id"] },
    run: ({ id }, p) => (read(id, p) ? ok({ handoff: handoff(id, p) }) : fail(`not found: ${id}`)),
  },
  {
    name: "tm_claim",
    description:
      "Take exclusive ownership of a task for this session and start it. Refuses if another session already holds the claim. Use when several agents or worktrees share one store, so two of you don't do the same task twice.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Task id. Omit to just read the current claims."),
        steal: { type: "boolean", description: "Take a claim another live session holds. Recorded as claim_stolen." },
      },
    },
    run: ({ id, steal }, p) => {
      if (!id) return ok({ claims: state(p).claims || {} });
      if (!read(id, p)) return fail(`not found: ${id}`);
      // The old check compared sessions but never asked expired(), so a claim left by a
      // crashed session blocked an MCP agent forever while the CLI treated the same claim as
      // dead — the two callers disagreed about the same state.
      const claimed = claimTask(id, {
        session: session(),
        actor: actorLabel(actor()),
        worktree: p.root,
        steal: Boolean(steal),
        p,
      });
      if (!claimed.ok) return fail(claimed.reason);
      update(id, { status: "in_progress", session: session() || undefined }, p);
      return ok({ id, status: "in_progress", session: session(), ...(claimed.stolenFrom ? { stolenFrom: claimed.stolenFrom } : {}) });
    },
  },
  {
    name: "tm_label",
    description:
      "Add or remove labels on an epic or task. Omit add/remove to read the current labels and the catalog. Decision roles (decision:interview|research|prototype|unblock) and triage roles (needs-triage|needs-info|ready-for-agent|ready-for-human|wontfix) are exclusive within their group. decision:map is epic-only. Unknown decision:* labels are refused unless force is set.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Entity id. Omit to just list the catalog."),
        add: { type: "array", items: { type: "string" }, description: "Labels to add." },
        remove: { type: "array", items: { type: "string" }, description: "Labels to remove." },
        force: { type: "boolean", description: "Allow an unknown decision:* label." },
      },
    },
    run: ({ id, add, remove, force }, p) => {
      const catalog = labelCatalog(p);
      if (!id) return ok({ catalog });
      if (!read(id, p)) return fail(`not found: ${id}`);
      if (!(add && add.length) && !(remove && remove.length)) {
        return ok({ id, labels: read(id, p).labels || [], catalog });
      }
      return ok({ id, labels: setLabels(id, { add: add || [], remove: remove || [], force: Boolean(force) }, p), catalog });
    },
  },
  // ── parity with the dashboard's write surface (CAP-0001) ─────────────────────
  // Every tool below calls the function `lib/dashboard-api.mjs` calls for the same verb, with the
  // same refusal wording, so an MCP-only session can do what a browser tab can.
  {
    name: "tm_worktree",
    description:
      "Provision an isolated git worktree for a task (claims it first — refused if another live session holds it), remove one, or list them. Same behaviour and refusals as `tm worktree` and the board.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["new", "rm", "list"], description: "new provisions and claims; rm removes and releases; list reads." },
        id: str("Task id, for new and rm."),
        base: str("For new: the ref to branch from (default: the current HEAD)."),
        share: { type: "boolean", description: "For new: share node_modules/.env from the main checkout (default true)." },
        force: { type: "boolean", description: "For rm: remove even when the worktree is dirty." },
        steal: { type: "boolean", description: "For new: take the claim another live session holds. Recorded as claim_stolen." },
      },
      required: ["action"],
    },
    run: ({ action, id, base, share, force, steal }, p) => {
      if (action === "list") return ok({ worktrees: listWorktrees(p) });
      if (!id) return fail(`tm_worktree ${action} needs an id`);
      const task = read(id, p);
      if (!task) return fail(`not found: ${id}`);
      if (task.kind !== "task") return fail(`${id} is not a task`);
      if (action === "new") {
        const res = provision(task, { base, share: share !== false, steal: Boolean(steal), session: session(), actor: actorLabel(actor()), p });
        if (!res.ok) return fail(res.reason);
        return ok({ id, worktree: res.path, branch: res.branch, shared: res.shared, stolenFrom: res.stolenFrom ?? null });
      }
      if (action === "rm") {
        const res = unprovision(task, { force: Boolean(force), p });
        if (!res.ok) return fail(res.reason);
        return ok({ id, worktree: null, removed: true, unlinked: res.unlinked });
      }
      return fail(`unknown action: ${action}`);
    },
  },
  {
    name: "tm_link",
    description:
      "Add or remove a typed link between two entities. Both ends are written — `A blocks B` gives B `blocked by A` — and removal cleans both. Types: blocks, blocked by, causes, caused by, duplicates, duplicated by, relates to.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Entity id the link is written on."),
        type: { type: "string", enum: Object.keys(LINK_TYPES), description: "Link type, read from `id`'s side." },
        to: str("The other entity id."),
        remove: { type: "boolean", description: "Remove the link instead of adding it." },
      },
      required: ["id", "type", "to"],
    },
    run: ({ id, type, to, remove }, p) => {
      if (!read(id, p)) return fail(`not found: ${id}`);
      const links = remove ? removeLink(id, type, to, p) : addLink(id, type, to, p);
      return ok({ id, links });
    },
  },
  {
    name: "tm_graph",
    description:
      "The dependency graph as data ({nodes, edges}) and as a Mermaid flowchart. Scope with epic; done work is left out unless all is set. Blockers outside the scope are still drawn, because they still explain the block.",
    inputSchema: {
      type: "object",
      properties: {
        epic: str("Scope to one epic, e.g. EP-002."),
        all: { type: "boolean", description: "Include done tasks." },
        subtasks: { type: "boolean", description: "Draw parent/subtask edges (default true)." },
      },
    },
    run: ({ epic, all, subtasks }, p) => {
      const opts = { epic: epic || null, includeDone: Boolean(all) };
      const drawn = mermaid({ ...opts, subtasks: subtasks !== false }, p);
      return ok({ ...graphData(opts, p), mermaid: drawn.mermaid, counts: { tasks: drawn.tasks, edges: drawn.edges } });
    },
  },
  {
    name: "tm_doctor",
    description:
      "Report what is inconsistent in the store — dangling deps, orphan epics, one-sided links, dead claims — and optionally repair the unambiguous half. fix rewrites files, so it also needs confirm:true, exactly like the board.",
    inputSchema: {
      type: "object",
      properties: {
        fix: { type: "boolean", description: "Apply every auto-fixable finding, repeating until the store stops changing." },
        confirm: { type: "boolean", description: "Required with fix: this rewrites markdown files." },
      },
    },
    run: ({ fix, confirm }, p) => {
      if (fix) {
        if (confirm !== true) return fail("doctor --fix rewrites files: send { confirm: true }");
        const applied = repairAll(p);
        const after = diagnose(p);
        return ok({ applied, findings: plain(after), text: renderDoctor(after, { fixed: applied }) });
      }
      const findings = diagnose(p);
      return ok({
        findings: plain(findings),
        errors: findings.filter((f) => f.level === "error").length,
        warnings: findings.filter((f) => f.level === "warning").length,
        fixable: findings.filter((f) => f.fixable).length,
        text: renderDoctor(findings),
      });
    },
  },
  {
    name: "tm_export",
    description:
      "The board out as a document: md (a report you can paste into a PR), csv (Jira's columns and status vocabulary) or json (the whole store). Filters: epic, status, open (drop done work), events (json only). Clamped at 64k characters — use the CLI for the whole thing.",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: FORMATS, description: "md, csv or json." },
        epic: str("Only this epic."),
        status: str("Only this status."),
        open: { type: "boolean", description: "Drop done and deleted work." },
        events: { type: "boolean", description: "json only: include the event log." },
        title: str("md only: the report title."),
      },
      required: ["format"],
    },
    run: ({ format, epic, status, open, events, title }, p) => {
      const text = exportStore(format, { epic, status, open: Boolean(open), events: Boolean(events), title }, p);
      return ok({ format, text: clamp(text) });
    },
  },
  {
    name: "tm_time",
    description:
      "Cycle-time numbers from the event log: median/mean, work in progress with age, the oldest open task, and daily throughput. With an id: that task's cycle time, time in each status, and its status timeline.",
    inputSchema: { type: "object", properties: { id: str("Task id. Omit for the board-wide summary.") } },
    run: ({ id }, p) => {
      if (!id) return ok({ ...timeSummary(p), throughput: throughput(p) });
      if (!read(id, p)) return fail(`not found: ${id}`);
      return ok({ id, cycle: cycleTime(id, p), inStatus: timeInStatus(id, p), timeline: taskTimeline(id, p) });
    },
  },
  {
    name: "tm_parallel",
    description:
      "Batches of unblocked, unclaimed tasks whose declared `touches` do not collide, so they can run side by side in separate worktrees. Same algorithm as `tm parallel`.",
    inputSchema: { type: "object", properties: { epic: str("Scope to one epic.") } },
    run: ({ epic }, p) => ok({ batches: batches({ epic: epic || null }, p) }),
  },
  {
    name: "tm_task_field",
    description:
      "Set one Jira-shaped field on a task: assignee, priority, estimate, type, rank, parent (subtask-ness), dep (blockedBy add/remove), comment (append), touches (declare paths). One field set per call; an empty call is refused. Same validation and refusals as the CLI verbs.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Task id."),
        assignee: { type: ["string", "null"], description: "Who; null clears." },
        priority: { type: "string", enum: ["highest", "high", "medium", "low", "lowest"], description: "Priority." },
        estimate: { type: "number", description: "Story points." },
        type: { type: "string", enum: TYPES, description: "Issue type." },
        rank: {
          type: "object",
          properties: { before: str("Place before this id."), after: str("Place after this id."), to: { type: "number", description: "An explicit rank." } },
          description: "Backlog position.",
        },
        parent: { type: ["string", "null"], description: "Parent task id, or null to detach." },
        dep: {
          type: "object",
          properties: { add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } } },
          description: "Blockers to add or remove. A cycle is refused.",
        },
        comment: str("A comment to append."),
        touches: { type: "array", items: { type: "string" }, description: "Repo-relative paths this task edits (what tm_parallel batches on)." },
      },
      required: ["id"],
    },
    run: ({ id, ...fields }, p) => {
      if (!read(id, p)) return fail(`not found: ${id}`);
      const set = Object.keys(fields).filter((k) => fields[k] !== undefined);
      if (!set.length) return fail("tm_task_field needs one field: assignee, priority, estimate, type, rank, parent, dep, comment or touches");
      const out = {};
      if ("assignee" in fields) out.assignee = assign(id, fields.assignee ?? null, p);
      if ("priority" in fields) out.priority = prioritise(id, fields.priority, p);
      if ("estimate" in fields) out.estimate = estimate(id, fields.estimate, p);
      if ("type" in fields) out.type = setType(id, fields.type ?? null, p);
      if ("rank" in fields) out.rank = rank(id, fields.rank || {}, p);
      if ("parent" in fields) {
        subtasks(id, { parent: fields.parent || null }, p);
        out.parent = read(id, p).parent ?? null;
      }
      if ("dep" in fields) out.blockedBy = dependencies(id, { add: fields.dep?.add || [], remove: fields.dep?.remove || [] }, p);
      if ("comment" in fields) out.comments = addComment(id, fields.comment, { author: actorLabel(actor()), p });
      if ("touches" in fields) {
        // An MCP agent names paths relative to the repository, not to the server's cwd.
        const base = currentCheckout(p.root) || p.root;
        recordTouches(id, fields.touches, p, { from: base, base });
        out.touches = read(id, p).touches || [];
      }
      return ok({ id, ...out });
    },
  },
  {
    name: "tm_history",
    description: "One entity's whole event history, collapsed and labelled the way `tm log <id>` and the board's activity panel are.",
    inputSchema: {
      type: "object",
      properties: { id: str("Entity id (task, epic, ADR, sprint or capability)."), limit: { type: "number", description: "Keep only the last n events." } },
      required: ["id"],
    },
    run: ({ id, limit }, p) => {
      if (!kindOf(id)) return fail(`unknown prefix: ${id}`);
      if (!read(id, p)) return fail(`not found: ${id}`);
      const rows = readEvents(p).filter((e) => e && e.id === id);
      let events = collapseLog(rows, { keep: true }).map((e) => ({ ...e, label: CATALOG.events[e.event]?.label || e.event }));
      if (Number.isFinite(limit) && limit > 0) events = events.slice(-limit);
      return ok({ id, events, text: renderHistory(id, rows, p) });
    },
  },
  {
    name: "tm_stale",
    description: "Tasks that have been in_progress longer than config.staleMinutes without a write — the work someone started and walked away from.",
    inputSchema: { type: "object", properties: {} },
    run: (_args, p) => ok({ minutes: config(p).staleMinutes, tasks: staleTasks(p).map((t) => t.id) }),
  },
  {
    name: "tm_agents",
    description: "The dispatched-worker registry on this host: list agents with liveness, record a heartbeat, or reap the dead. Claims stay the interlock; this is who is alive behind them.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "heartbeat", "reap"], description: "Default list." },
        name: str("Agent name, for heartbeat."),
      },
    },
    run: ({ action = "list", name }, p) => {
      if (action === "list") {
        const agents = listAgents(p);
        return ok({ agents, text: renderAgents(agents) });
      }
      if (action === "heartbeat") {
        if (typeof name !== "string" || !name.trim()) return fail("tm_agents heartbeat needs { name }");
        const rec = heartbeatAgent(name, p);
        if (!rec) return fail(`unknown agent: ${name}`);
        return ok({ agent: rec });
      }
      if (action === "reap") return ok({ reaped: reapAgents(p) });
      return fail(`unknown action: ${action}`);
    },
  },
  {
    name: "tm_dispatch",
    description:
      "Hand a task to a worker, end to end: claim it, mark it in progress, provision its worktree, render the handoff and launch a backend (host order: orchestration → fleet → tmux → manual, or one pinned with backend). Dispatch IS a start — the WIP gate applies, and a task another live session holds is refused unless steal is true. Same mechanics and same refusal wording as `tm dispatch`.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Task id, e.g. TM-001."),
        backend: str("Pin one backend by name (tmux, manual, …). Omit to walk the host's fallback order."),
        steal: {
          type: "boolean",
          description:
            "Take a task another live session holds. Refused without this, and recorded as claim_stolen when used — deliberate and traceable rather than silent.",
        },
      },
      required: ["id"],
    },
    // Async: dispatch() awaits backend resolution and the spawn. callTool unwraps
    // the promise; every other tool stays synchronous.
    run: async ({ id, backend, steal }, p) => {
      if (!read(id, p)) return fail(`not found: ${id}`);
      // Dispatch IS a start: the WIP gate binds on this surface exactly as on the CLI.
      const gate = gateStart(id, p);
      if (!gate.allow) return fail(gate.reason);
      const stamped = stamp(currentCheckout(p.root) || p.root);
      const res = await dispatch(id, {
        backend: typeof backend === "string" && backend.trim() ? backend.trim() : null,
        session: stamped.session,
        actor: stamped.actor,
        steal: Boolean(steal),
        p,
        registry: await envRegistry(),
      });
      return res.ok ? ok(res) : fail(res.reason);
    },
  },
  {
    name: "tm_collect",
    description:
      "Pull a dispatched worker's result into the store: asks the backend's collector (orchestration run state, tmux session liveness, fleet events), records a task_result event, and parks the task with the reason on failure — never leaves a dead worker's task in_progress. Same mechanics as `tm collect <id>`.",
    inputSchema: {
      type: "object",
      properties: { id: str("Task id, e.g. TM-001.") },
      required: ["id"],
    },
    run: async ({ id }, p) => {
      if (!read(id, p)) return fail(`not found: ${id}`);
      const res = await collect(id, p);
      return res.ok ? ok(res) : fail(res.reason);
    },
  },
  {
    name: "tm_goal_import",
    description:
      "Turn a goal doc into a task whose acceptance criteria are the goal's own success criteria, or a `*.plan.json` manifest into a whole epic. Refuses a doc with no parseable criteria. path is confined to the repository; content takes the doc itself.",
    inputSchema: {
      type: "object",
      properties: {
        path: str("Repo-relative path to a goal .md or a .plan.json manifest."),
        content: str("The goal doc text, instead of a path."),
        name: str("With content: what to call the source."),
        epic: str("File the task under this epic instead of the active one."),
      },
    },
    run: ({ path, content, name, epic }, p) => {
      const opts = { epic: epic || null, stamp: stamp(currentCheckout(p.root) || p.root) };
      try {
        if (typeof content === "string") {
          const { task, parsed, doc } = importGoalDoc(content, { ...opts, source: String(name || "pasted goal").trim() || "pasted goal" }, p);
          return ok({ id: task.id, title: task.title, epic: task.epic ?? null, criteria: parsed.criteria.length, doc });
        }
        if (typeof path !== "string" || !path.trim()) return fail("tm_goal_import needs { path } or { content, name }");
        const full = isAbsolute(path) ? resolve(path) : resolve(p.root, path);
        if (full !== p.root && !full.startsWith(p.root + sep)) return fail(`path must be inside ${p.root}`);
        if (!existsSync(full)) return fail(`no such file: ${path}`);
        if (/\.json$/i.test(full)) {
          const res = importManifest(full, { stamp: opts.stamp }, p);
          return ok({ epic: res.epic.id, title: res.epic.title, tasks: res.tasks, skipped: res.skipped, edges: res.edges, danglingDeps: res.danglingDeps, touched: res.touched });
        }
        const { task, parsed, doc } = importGoalDoc(readFileSync(full, "utf8"), { ...opts, source: full }, p);
        return ok({ id: task.id, title: task.title, epic: task.epic ?? null, criteria: parsed.criteria.length, doc });
      } catch (e) {
        return fail(e.message);
      }
    },
  },
];

// ── protocol ─────────────────────────────────────────────────────────────────

export function callTool(name, args = {}, p = paths()) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`Unknown tool name: ${name}`);
  if (!p.root) return fail(p.unavailable);
  try {
    const out = tool.run(args, p);
    /**
     * A tool's run MAY be async (tm_dispatch launches a backend; dispatch()
     * awaits). Sync tools keep their exact old return shape so handleRequest
     * stays synchronous for them; a thenable is unwrapped by the protocol
     * layer below, never JSON.stringified into a pending-Promise-shaped lie.
     */
    return out && typeof out.then === "function" ? out.catch((err) => fail(err.message)) : out;
  } catch (err) {
    return fail(err.message);
  }
}

const reply = (id, result) => ({ jsonrpc: "2.0", id, result });
const error = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
/** The spec's own code for an unknown resource, with the uri in `data` so a client can say which. */
const notFound = (id, uri) => ({ jsonrpc: "2.0", id, error: { code: -32002, message: "Resource not found", data: { uri } } });

/** Pure: one request object in, one response object (or null for notifications) out. */
export function handleRequest(request, { p = paths() } = {}) {
  const { method, id = null } = request;

  if (method === "initialize") {
    // Both capabilities are MANDATORY declarations for the features we serve, and both are
    // empty objects because we support neither sub-feature (no listChanged, no subscribe).
    //
    // `tools: {}` was missing entirely. Claude Code is lenient enough that 18 tools worked
    // anyway, so nothing looked wrong — but a stricter client is entitled to ignore an
    // undeclared capability, and `resources` has no such slack: leave it out and the client
    // never calls resources/list, `@` shows nothing, and no error surfaces anywhere. That
    // silent-success failure is the single easiest way to ship this broken.
    return reply(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {}, resources: {} },
      serverInfo: SERVER_INFO,
    });
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") {
    return reply(id, { tools: TOOLS.map(({ run, ...def }) => def) });
  }
  if (method === "resources/list") {
    // Must not throw: an error on a discovery call is retried and then abandoned, taking the
    // whole resource surface with it for the rest of the session.
    try {
      return reply(id, { resources: p.root ? listResources(p) : [] });
    } catch {
      return reply(id, { resources: [] });
    }
  }
  if (method === "resources/read") {
    const uri = String(request.params?.uri || "");
    let result = null;
    try {
      result = p.root ? readResource(uri, p) : null;
    } catch (err) {
      return error(id, -32603, `could not read ${uri}: ${err.message}`);
    }
    // -32002 is "resource not found". NOT -32601: that means the METHOD is missing, and a
    // client can reasonably read it as "this server does not do resources" and stop asking —
    // losing every resource over one bad id.
    if (!result) return notFound(id, uri);
    return reply(id, result);
  }
  if (method === "tools/call") {
    const params = request.params || {};
    const result = callTool(String(params.name || ""), params.arguments || {}, p);
    const wrap = (r) => reply(id, { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
    // An async tool answers with a promise of the response; everything else stays inline.
    return result && typeof result.then === "function" ? result.then(wrap) : wrap(result);
  }
  return error(id, -32601, `Method not found: ${method}`);
}

/**
 * One line of stdin → one response object, or null when nothing should be written.
 * For an async tool the response is a PROMISE of the object — bin/tm-mcp resolves it.
 */
export function respondToLine(line, deps = {}) {
  if (!line.trim()) return null;
  let request;
  try {
    request = JSON.parse(line);
  } catch (err) {
    return error(null, -32700, err.message);
  }
  return handleRequest(request, deps);
}
