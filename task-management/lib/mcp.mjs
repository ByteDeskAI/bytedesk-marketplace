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
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { paths } from "./paths.mjs";
import { claimTask, releaseClaim } from "./claims.mjs";
import { actor, actorLabel, sessionId } from "./actor.mjs";
import { config, create, editTask, list, logEvent, moveTask, nextTasks, now, read, state, update, writeState } from "./store.mjs";
import { consumeOverride, enforcementOff, gateDone, gateTaskCreate } from "./enforce.mjs";
import { board, handoff, standup, taskLine } from "./render.mjs";
import { renderWhy, why } from "./graph.mjs";
import { listResources, readResource } from "./resources.mjs";
import { describeQuery, matchesQuery, parseQuery } from "./query.mjs";

export const SERVER_INFO = { name: "task-management", version: "0.3.0" };

const ok = (fields = {}) => ({ ok: true, ...fields });
const fail = (error) => ({ ok: false, error });
const session = () => sessionId();

/** Task fields the CLI stamps on creation; kept identical so both paths produce one shape. */
const NEW_TASK = { acceptance: [], evidence: [], commits: [], blockedBy: [], blocks: [] };

const str = (description) => ({ type: "string", description });

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
      for (const kind of ["epic", "task", "adr"]) {
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
        if (!read(id, p)) return fail(`no such epic: ${id}`);
        writeState({ activeEpic: id }, p);
        logEvent("epic_active", { id }, p);
        return ok({ activeEpic: id });
      }
      if (action === "done") {
        const e = update(id, { status: "done" }, p);
        if (state(p).activeEpic === id) writeState({ activeEpic: null }, p);
        return ok({ id: e.id, status: "done" });
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
      },
      required: ["title"],
    },
    run: ({ title, body = "", acceptance = [] }, p) => {
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
      return ok({ id: t.id, title, epic: t.epic, file: t.file });
    },
  },
  {
    name: "tm_task_update",
    description:
      "Move a task through its lifecycle: start, done, park, block, unblock. Call start before you touch code and done the moment it is verified — never leave a task in_progress at the end of a session. done is gated on met acceptance criteria; start is gated on the WIP limit.",
    inputSchema: {
      type: "object",
      properties: {
        id: str("Task id, e.g. TM-001."),
        action: { type: "string", enum: ["start", "done", "park", "block", "unblock"], description: "Lifecycle move." },
        reason: str("Why, for park and block. Recorded on the task."),
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
          // ponytail: mirrors the WIP check in bin/tm's `start`. Lives there, not in
          // enforce.mjs, so it is duplicated rather than bypassed — fold both into a
          // gateStart() when enforce.mjs is next opened.
          const cfg = config(p);
          const wip = list("task", { status: "in_progress" }, p);
          if (!enforcementOff(p) && cfg.wipLimit && wip.length >= cfg.wipLimit && !wip.some((w) => w.id === id)) {
            if (!consumeOverride(p)) {
              return fail(`WIP limit ${cfg.wipLimit} reached: ${wip.map((w) => w.id).join(", ")}`);
            }
          }
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
      "Tick one acceptance criterion as met. Tick it only after you have actually verified it — attach the proof with tm_evidence. This is what unlocks tm_task_update done.",
    inputSchema: {
      type: "object",
      properties: { id: str("Task id."), index: { type: "integer", description: "1-based criterion number." } },
      required: ["id", "index"],
    },
    run: ({ id, index }, p) => {
      const t = read(id, p);
      if (!t) return fail(`not found: ${id}`);
      const acceptance = [...(t.acceptance || [])];
      const i = Number(index) - 1;
      if (!acceptance[i]) return fail(`${id} has no acceptance criterion ${index}`);
      acceptance[i] = { ...acceptance[i], done: true, at: now() };
      update(id, { acceptance }, p);
      return ok({ id, met: acceptance.filter((a) => a.done).length, total: acceptance.length });
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
      const t = read(id, p);
      if (!t) return fail(`not found: ${id}`);
      if (!text && !path) return fail("tm_evidence needs text or path");
      mkdirSync(p.evidence, { recursive: true });
      let dest;
      if (path) {
        dest = join(p.evidence, `${id}-${basename(path)}`);
        copyFileSync(resolve(path), dest);
      } else {
        dest = join(p.evidence, `${id}-${Date.now()}.log`);
        writeFileSync(dest, text);
      }
      const ref = dest.replace(`${p.root}/`, "");
      update(id, { evidence: [...(t.evidence || []), ref] }, p);
      return ok({ id, evidence: ref });
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
];

// ── protocol ─────────────────────────────────────────────────────────────────

export function callTool(name, args = {}, p = paths()) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`Unknown tool name: ${name}`);
  if (!p.root) return fail(p.unavailable);
  try {
    return tool.run(args, p);
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
    return reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
  }
  return error(id, -32601, `Method not found: ${method}`);
}

/** One line of stdin → one response object, or null when nothing should be written. */
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
