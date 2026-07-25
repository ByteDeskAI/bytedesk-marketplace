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
import { addComment, addLink, assign, backlog, estimate, labels, prioritise, rank, subtasks } from "./issue.mjs";
import { paths } from "./paths.mjs";
import { claimTask } from "./claims.mjs";
import { actor, actorLabel } from "./actor.mjs";
import {
  autoCloseEpic,
  config,
  create,
  kindOf,
  list,
  logEvent,
  read,
  release,
  state,
  unblockDependents,
  update,
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
      case "rank":
        return ok({ rank: rank(id, { before: payload.before, after: payload.after, to: payload.to }, p) });
      case "ac":
        return addCriterion(task, payload.text, p);
      case "accept":
        return acceptCriterion(task, payload.index, p);
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
    claimTask(task.id, { session: process.env.CLAUDE_SESSION_ID || null, actor: actorLabel(actor()), p });
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

function edit(task, { title, body }, p) {
  const patch = {};
  if (typeof title === "string") {
    if (!title.trim()) return fail(400, "a task needs a title");
    patch.title = title.trim();
  }
  if (typeof body === "string") patch.body = body;
  if (!Object.keys(patch).length) return fail(400, "nothing to change");
  update(task.id, patch, p);
  return ok(read(task.id, p));
}

function addCriterion(task, text, p) {
  const value = String(text || "").trim();
  if (!value) return fail(400, "an acceptance criterion needs text");
  const acceptance = [...(task.acceptance || []), { text: value, done: false }];
  update(task.id, { acceptance }, p);
  return ok({ acceptance });
}

function acceptCriterion(task, index, p) {
  const acceptance = [...(task.acceptance || [])];
  const i = Number(index) - 1;
  if (!acceptance[i]) return fail(400, `${task.id} has no acceptance criterion ${index}`);
  acceptance[i] = { ...acceptance[i], done: true, at: new Date().toISOString() };
  update(task.id, { acceptance }, p);
  return ok({ acceptance });
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
  };
}

export { backlog };
