/**
 * The dashboard's write surface: `POST /api/task/:id/:action`, `PATCH /api/task/:id`,
 * `POST /api/task`, `POST /api/bulk`, `GET /api/backlog`.
 *
 * `handleWrite` is pure request-in / response-out so it unit-tests without a
 * server; bin/tm-dashboard is only plumbing. Every mutation delegates to the same
 * lib functions the CLI calls — never to the filesystem directly — so the gates,
 * the event log and the markdown store stay authoritative regardless of caller.
 *
 * Refusals carry the reason the CLI would have printed, so the UI can show *why*
 * rather than a dead 500: gate refusals are 409, bad input is 400, missing is 404.
 */
import { gateDone, gateTaskCreate } from "./enforce.mjs";
import { addComment, addLink, assign, backlog, dependencies, estimate, labels, prioritise, rank, setType, subtasks } from "./issue.mjs";
import { paths, projectName } from "./paths.mjs";
import { claimTask } from "./claims.mjs";
import { actor, actorLabel, sessionId } from "./actor.mjs";
import {
  autoCloseEpic,
  config,
  create,
  writeConfig,
  editTask,
  kindOf,
  removeCriterion,
  setCriterion,
  moveTask,
  list,
  logEvent,
  read,
  release,
  state,
  unblockDependents,
  update,
  writeState,
} from "./store.mjs";

const STATUSES = ["open", "in_progress", "blocked", "parked", "done"];
const ok = (body = {}) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });

/** Anything that isn't one of our ids never reaches the store. */
function requireTask(id, p) {
  if (kindOf(id) !== "task") return { error: fail(400, `not a task id: ${id}`) };
  const task = read(id, p);
  return task ? { task } : { error: fail(404, `not found: ${id}`) };
}

export function handleWrite(method, path, payload = {}, { p = paths() } = {}) {
  const url = (path || "").split("?")[0];
  if (method === "GET" && url === "/api/backlog") return ok(backlog(p));
  if (method === "POST" && url === "/api/task") return createTask(payload, p);
  if (method === "POST" && url === "/api/bulk") return bulk(payload, p);
  if (method === "POST" && url === "/api/epic") return setActiveEpic(payload, p);
  if (method === "POST" && url === "/api/settings") return saveSettings(payload, p);

  // The detail read. boardPayload strips `body` from the list on purpose — a 20-task board must
  // not ship 30 KB of markdown — so a full record needs its own route rather than a fatter list.
  const detail = /^\/api\/task\/([^/]+)$/.exec(url);
  if (method === "GET" && detail) {
    const { task, error } = requireTask(decodeURIComponent(detail[1]), p);
    return error || ok(task);
  }

  const match = /^\/api\/task\/([^/]+)(?:\/([a-z]+))?$/.exec(url);
  if (!match) return fail(404, `no route for ${method} ${url}`);

  const id = decodeURIComponent(match[1]);
  const action = match[2];
  const { task, error } = requireTask(id, p);
  if (error) return error;
  if (method === "PATCH" && !action) return edit(task, payload, p);
  if (method !== "POST") return fail(405, `${method} not allowed on ${url}`);

  try {
    switch (action) {
      case "transition":
        return transition(task, payload.status, p);
      case "edit":
        return edit(task, payload, p);
      case "assign":
        return ok({ assignee: assign(id, payload.assignee ?? null, p) });
      case "labels":
        return ok({ labels: labels(id, { add: payload.add || [], remove: payload.remove || [] }, p) });
      case "type":
        return ok({ type: setType(id, payload.type ?? null, p) });
      case "priority":
        return ok({ priority: prioritise(id, payload.priority, p) });
      case "estimate":
        return ok({ estimate: estimate(id, payload.estimate, p) });
      case "comment":
        return ok({ comments: addComment(id, payload.text, { author: payload.author, p }) });
      case "link":
        return ok({ links: addLink(id, payload.type, payload.to, p) });
      case "subtask":
        subtasks(id, { parent: payload.parent || null }, p);
        return ok({ parent: read(id, p).parent ?? null });
      case "dep":
        // The board could render a blocked card and had no way to change what blocked it.
        return ok({ blockedBy: dependencies(id, { add: payload.add || [], remove: payload.remove || [] }, p) });
      case "rank":
        return ok({ rank: rank(id, { before: payload.before, after: payload.after, to: payload.to }, p) });
      case "ac":
        return addCriterion(task, payload.text, p);
      case "accept":
        return acceptCriterion(task, payload, p);
      default:
        return fail(404, `unknown action "${action}"`);
    }
  } catch (err) {
    // Validation from lib/issue.mjs is the caller's problem to fix, not a crash.
    // 409 matches the gate refusals: the request was well-formed but not allowed.
    // Bad input is 400; the gates above return 409 themselves.
    return fail(/not found/i.test(err.message) ? 404 : 400, err.message);
  }
}

/** Status changes carry the same consequences the CLI applies — gate, claim, epic. */
function transition(task, status, p) {
  if (!STATUSES.includes(status)) return fail(400, `unknown status "${status}" — use one of: ${STATUSES.join(", ")}`);

  if (status === "done") {
    const gate = gateDone(task.id, p);
    if (!gate.allow) return fail(409, gate.reason);
  }

  update(task.id, { status, ...(status === "done" ? { closed: new Date().toISOString() } : {}) }, p);

  // Same consequences the CLI applies, or the board and the terminal disagree.
  if (status === "in_progress") {
    claimTask(task.id, { session: sessionId(), actor: actorLabel(actor()), p });
  } else {
    release(task.id, p);
  }

  const result = { id: task.id, status };
  if (status === "done") {
    logEvent("done", { id: task.id, via: "dashboard" }, p);
    result.unblocked = unblockDependents(task.id, p);
    if (task.epic && autoCloseEpic(task.epic, p)) result.closedEpic = task.epic;
  }
  return ok(result);
}

/**
 * The one edit path that existed before `tm edit` / `tm_task_edit` — and it took title and body
 * only, so the board could create a task under the active epic and never move it out again.
 * `epic` goes through moveTask so the browser gets the same lifecycle the CLI does: a done
 * destination reopens, an emptied-of-live-work source closes.
 */
function edit(task, { title, body, epic }, p) {
  const changed = {};
  try {
    if (typeof title === "string" || typeof body === "string") {
      changed.edited = editTask(task.id, { title, body }, p).changed;
    }
    if (epic !== undefined) Object.assign(changed, moveTask(task.id, epic, p));
  } catch (e) {
    return fail(400, e.message);
  }
  if (!Object.keys(changed).length) return fail(400, "nothing to change");
  return ok({ ...read(task.id, p), ...changed });
}

function addCriterion(task, text, p) {
  const value = String(text || "").trim();
  if (!value) return fail(400, "an acceptance criterion needs text");
  const acceptance = [...(task.acceptance || []), { text: value, done: false }];
  update(task.id, { acceptance }, p);
  return ok({ acceptance });
}

/**
 * Tick, untick, or remove one criterion.
 *
 * All three live on the one `accept` action rather than a second route, because the action name is
 * matched by `[a-z]+` — no underscore — and because this is the shape `tm_ac_accept` already takes
 * over MCP. One verb, three intents, described identically on both surfaces.
 *
 * `done` defaults to true so the existing `{index}` payload keeps working.
 *
 * The board could tick and not untick, and its checkbox set `isDisabled` once checked — so a stray
 * click permanently changed what `tm done` would accept, with no way back short of editing the
 * markdown by hand. That is what this exists to undo.
 */
function acceptCriterion(task, { index, done = true, remove = false }, p) {
  try {
    if (remove) {
      const res = removeCriterion(task.id, index, p);
      return ok({ acceptance: res.acceptance, removed: res.removed });
    }
    const res = setCriterion(task.id, index, done !== false, p);
    return ok({ acceptance: res.acceptance });
  } catch (e) {
    return fail(400, e.message);
  }
}

/**
 * Switch the active epic, exactly as `tm epic use` does — same validation, same event.
 *
 * Task creation is gated on there being an active epic, and until now the only way to
 * change it was the CLI. A board that can create tasks but cannot say which epic they
 * land in is a board that has to hand you back to the terminal for the one decision
 * that governs everything it does next.
 */

/**
 * Which preferences a browser may write.
 *
 * The rest of the config holds the gates — `enforce`, `wipLimit`, `requireAcceptance` — and a
 * browser tab is not the place to switch off rules the CLI and the hooks are enforcing. `tm config`
 * still owns those, deliberately.
 */
const BOARD_SETTINGS = new Set(["categories", "me", "watching", "grouped", "views"]);

/**
 * Board preferences, written where the tasks are.
 *
 * These lived in `localStorage`, which is why notifications had to be re-enabled in every browser
 * and on every machine: the preference was never about the browser, it was about this project. The
 * store already had a per-repo config file with a reader and an atomic writer, so this is a route
 * onto something that existed rather than a new mechanism.
 *
 * Only keys under `board` are writable from here. The rest of the config holds the gates —
 * `enforce`, `wipLimit`, `requireAcceptance` — and a browser tab is not the place to switch off the
 * rules the CLI and the hooks are enforcing; `tm config` still owns those deliberately.
 */
function saveSettings(patch, p) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return fail(400, "settings must be an object");
  }
  // An allowlist, not just a namespace. Nesting under `board` already keeps the gates out of reach,
  // but without this any key a page invented would accumulate in the repo's config forever — and a
  // config file is read by people, so junk in it is a cost paid by whoever opens it next.
  const known = Object.fromEntries(Object.entries(patch).filter(([k]) => BOARD_SETTINGS.has(k)));
  const rejected = Object.keys(patch).filter((k) => !BOARD_SETTINGS.has(k));
  if (!Object.keys(known).length) {
    return fail(400, `no writable setting in: ${Object.keys(patch).join(", ") || "(empty)"}`);
  }
  const board = { ...(config(p).board || {}), ...known };
  writeConfig({ board }, p);
  logEvent("settings", { keys: Object.keys(known).join(",") }, p);
  return ok({ board, ...(rejected.length ? { ignored: rejected } : {}) });
}

function setActiveEpic({ id }, p) {
  if (id === null || id === "") {
    writeState({ activeEpic: null }, p);
    logEvent("epic_active", { id: null, via: "dashboard" }, p);
    return ok({ activeEpic: null });
  }
  if (kindOf(id) !== "epic") return fail(400, `not an epic id: ${id}`);
  const epic = read(id, p);
  if (!epic) return fail(404, `no such epic: ${id}`);
  // A closed epic would silently gate every subsequent create; refuse instead.
  if (epic.status === "done") return fail(409, `${id} is done — reopen it or pick another epic`);
  writeState({ activeEpic: id }, p);
  logEvent("epic_active", { id, via: "dashboard" }, p);
  return ok({ activeEpic: id });
}

function createTask({ title, epic, body, assignee, priority }, p) {
  const name = String(title || "").trim();
  if (!name) return fail(400, "a task needs a title");

  const gate = gateTaskCreate(p);
  if (!gate.allow) return fail(409, gate.reason);

  const task = create(
    "task",
    {
      title: name,
      epic: epic || state(p).activeEpic || null,
      acceptance: [],
      evidence: [],
      commits: [],
      blockedBy: [],
      blocks: [],
      ...(assignee ? { assignee } : {}),
      ...(priority ? { priority } : {}),
    },
    body || "",
    p,
  );
  return { status: 201, body: { id: task.id, title: task.title, epic: task.epic } };
}

/**
 * One operation across many cards. Partial success is the honest outcome: a bad id
 * in a selection of twenty must not roll back the nineteen that worked.
 */
function bulk({ ids = [], op, args = {} }, p) {
  if (!Array.isArray(ids) || !ids.length) return fail(400, "bulk needs a non-empty ids array");
  if (!op) return fail(400, "bulk needs an op");

  const done = [];
  const failed = [];
  for (const id of ids) {
    const res = handleWrite("POST", `/api/task/${encodeURIComponent(id)}/${op}`, args, { p });
    if (res.status < 300) done.push(id);
    else failed.push({ id, error: res.body.error });
  }
  return ok({ ok: done, failed });
}

/** Everything the board needs in one round trip, for the initial render. */
export function boardPayload(p = paths()) {
  return {
    epics: list("epic", {}, p).map(({ body, file, ...e }) => e),
    tasks: list("task", {}, p).map(({ body, file, ...t }) => t),
    backlog: backlog(p).map((t) => t.id),
    state: state(p),
    // Board preferences ride along with the board rather than needing a second round trip: the
    // page cannot render its own header correctly without them, so a separate fetch would mean a
    // visible flash of the wrong settings on every load.
    settings: config(p).board || {},
    // Who the store thinks is looking. The board had no way to show this at all.
    actor: actorLabel(actor()),
    // Which project this board is for. Every board called itself "task-management" — the plugin's
    // name, identical on all of them — so two open boards were indistinguishable.
    project: projectName(p),
  };
}

export { backlog };
