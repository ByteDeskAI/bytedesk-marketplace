/**
 * The dashboard's write surface: `POST /api/task/:id/:action`, `PATCH /api/task/:id`,
 * `POST /api/task`, `POST /api/epic` (`{ id }` activate or `{ title }` create),
 * `GET /api/epic/:id`, `GET /api/adr/:id`, `POST /api/adr`, `POST /api/adr/:id/{accept,supersede}`,
 * `POST /api/sprint` (`{ title, ends? }` create or `{ id }` activate), `GET /api/sprint/:id`,
 * `POST /api/sprint/:id/done`, `POST /api/task/:id/sprint`,
 * `POST /api/bulk`, `GET /api/backlog`, `GET /api/templates[/:name]`.
 *
 * Evidence: `GET /api/task/:id/evidence` (derived items), `GET /api/task/:id/file?ref=`
 * (allowlisted bytes metadata), `POST /api/task/:id/evidence` (attach text/path or detach).
 * Multipart uploads are parsed in bin/tm-dashboard — the JSON body cap is 256 KB.
 *
 * `handleWrite` is pure request-in / response-out so it unit-tests without a
 * server; bin/tm-dashboard is only plumbing. Every mutation delegates to the same
 * lib functions the CLI calls — never to the filesystem directly — so the gates,
 * the event log and the markdown store stay authoritative regardless of caller.
 *
 * Refusals carry the reason the CLI would have printed, so the UI can show *why*
 * rather than a dead 500: gate refusals are 409, bad input is 400, missing is 404.
 */
import { basename } from "node:path";
import { gateDone, gateTaskCreate } from "./enforce.mjs";
import { addComment, addLink, assign, backlog, dependencies, estimate, labels, prioritise, rank, setType, subtasks } from "./issue.mjs";
import { execFileSync } from "node:child_process";
import { currentCheckout, paths, projectName } from "./paths.mjs";
import { claimTask } from "./claims.mjs";
import { actor, actorLabel, sessionId } from "./actor.mjs";
import { attachEvidence, detachEvidence, listEvidence, servableEvidencePath } from "./evidence.mjs";
import {
  autoCloseEpic,
  config,
  create,
  writeConfig,
  editTask,
  kindOf,
  now,
  removeCriterion,
  setCriterion,
  moveTask,
  list,
  logEvent,
  read,
  release,
  reopenEpic,
  state,
  unblockDependents,
  update,
  writeState,
  storeBoard,
} from "./store.mjs";
import { applyTemplate, listTemplates, readTemplate } from "./templates.mjs";
import { sprintCounts } from "./render.mjs";

const STATUSES = ["backlog", "open", "in_progress", "blocked", "parked", "done"];
const ok = (body = {}) => ({ status: 200, body });
const fail = (status, error) => ({ status, body: { error } });

/**
 * Kind-checked read. Lifecycle routes stay on `requireTask` so `GET /api/task/EP-*`
 * (and every POST under `/api/task`) is still 400 — the epic body lives at
 * `/api/epic/:id`. Same helper later covers adr/capability without widening the
 * task surface.
 */
function requireKind(id, kind, p) {
  if (kindOf(id) !== kind) return { error: fail(400, `not a ${kind} id: ${id}`) };
  const doc = read(id, p);
  return doc ? { doc } : { error: fail(404, `not found: ${id}`) };
}

function requireTask(id, p) {
  const { doc, error } = requireKind(id, "task", p);
  return error ? { error } : { task: doc };
}

function requireEpic(id, p) {
  const { doc, error } = requireKind(id, "epic", p);
  return error ? { error } : { epic: doc };
}

function requireAdr(id, p) {
  const { doc, error } = requireKind(id, "adr", p);
  return error ? { error } : { adr: doc };
}

function requireSprint(id, p) {
  const { doc, error } = requireKind(id, "sprint", p);
  return error ? { error } : { sprint: doc };
}

function reportFor(id, p) {
  return sprintCounts(list("task", {}, p).filter((t) => t.sprint === id));
}

export function handleWrite(method, path, payload = {}, { p = paths() } = {}) {
  const raw = path || "";
  const url = raw.split("?")[0];
  const query = new URLSearchParams(raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "");
  if (method === "GET" && url === "/api/backlog") return ok(backlog(p));
  if (method === "GET" && url === "/api/templates") return ok(listTemplates(p));
  const tpl = /^\/api\/templates\/([^/]+)$/.exec(url);
  if (method === "GET" && tpl) {
    try {
      return getTemplate(decodeURIComponent(tpl[1]), p);
    } catch (err) {
      return fail(400, err.message);
    }
  }
  if (method === "POST" && url === "/api/task") return createTask(payload, p);
  if (method === "POST" && url === "/api/bulk") return bulk(payload, p);
  if (method === "POST" && url === "/api/epic") return postEpic(payload, p);
  if (method === "POST" && url === "/api/adr") return createAdr(payload, p);
  if (method === "POST" && url === "/api/sprint") return postSprint(payload, p);
  if (method === "POST" && url === "/api/settings") return saveSettings(payload, p);

  // The detail read. boardPayload strips `body` from the list on purpose — a 20-task board must
  // not ship 30 KB of markdown — so a full record needs its own route rather than a fatter list.
  const detail = /^\/api\/task\/([^/]+)$/.exec(url);
  if (method === "GET" && detail) {
    const { task, error } = requireTask(decodeURIComponent(detail[1]), p);
    return error || ok(task);
  }

  const epicGet = /^\/api\/epic\/([^/]+)$/.exec(url);
  if (method === "GET" && epicGet) {
    const { epic, error } = requireEpic(decodeURIComponent(epicGet[1]), p);
    return error || ok(epic);
  }

  const epicAct = /^\/api\/epic\/([^/]+)\/([a-z]+)$/.exec(url);
  if (epicAct) {
    const id = decodeURIComponent(epicAct[1]);
    const action = epicAct[2];
    const { epic, error } = requireEpic(id, p);
    if (error) return error;
    if (method === "POST" && action === "close") return closeEpic(epic, p);
    if (method === "POST" && action === "reopen") return reopenEpicDoc(epic, p);
    return fail(404, `unknown action "${action}"`);
  }

  // ADR detail and lifecycle sit beside the epic routes so `/api/task/ADR-*` stays
  // requireTask (400). Status is proposed/accepted/superseded — not a task Status.
  const adrGet = /^\/api\/adr\/([^/]+)$/.exec(url);
  if (method === "GET" && adrGet) {
    const { adr, error } = requireAdr(decodeURIComponent(adrGet[1]), p);
    return error || ok(adr);
  }

  const adrAct = /^\/api\/adr\/([^/]+)\/([a-z]+)$/.exec(url);
  if (adrAct) {
    const id = decodeURIComponent(adrAct[1]);
    const action = adrAct[2];
    const { adr, error } = requireAdr(id, p);
    if (error) return error;
    if (method === "POST" && action === "accept") return acceptAdr(adr, p);
    if (method === "POST" && action === "supersede") return supersedeAdr(adr, payload, p);
    return fail(404, `unknown action "${action}"`);
  }

  // Sprint detail and close sit beside adr so `/api/task/SP-*` stays requireTask (400).
  const sprintGet = /^\/api\/sprint\/([^/]+)$/.exec(url);
  if (method === "GET" && sprintGet) {
    const { sprint, error } = requireSprint(decodeURIComponent(sprintGet[1]), p);
    if (error) return error;
    const { file, ...doc } = sprint;
    return ok({ ...doc, report: reportFor(sprint.id, p) });
  }

  const sprintAct = /^\/api\/sprint\/([^/]+)\/([a-z]+)$/.exec(url);
  if (sprintAct) {
    const id = decodeURIComponent(sprintAct[1]);
    const action = sprintAct[2];
    const { sprint, error } = requireSprint(id, p);
    if (error) return error;
    if (method === "POST" && action === "done") return closeSprint(sprint, p);
    return fail(404, `unknown action "${action}"`);
  }

  const match = /^\/api\/task\/([^/]+)(?:\/([a-z]+))?$/.exec(url);
  if (!match) return fail(404, `no route for ${method} ${url}`);

  const id = decodeURIComponent(match[1]);
  const action = match[2];
  const { task, error } = requireTask(id, p);
  if (error) return error;
  if (method === "GET" && action === "evidence") return ok({ evidence: listEvidence(task, p) });
  if (method === "GET" && action === "file") {
    const ref = query.get("ref") ?? payload.ref ?? "";
    const dest = servableEvidencePath(task, ref, p);
    if (!dest) return fail(404, "not found");
    return ok({ ref, name: basename(dest) });
  }
  if (method === "PATCH" && !action) return edit(task, payload, p);
  if (method !== "POST") return fail(405, `${method} not allowed on ${url}`);

  try {
    switch (action) {
      case "transition":
        return transition(task, payload.status, p, payload.reason);
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
      case "evidence":
        return writeEvidence(task, payload, p);
      case "sprint":
        return setTaskSprint(task, payload, p);
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

/**
 * The same four fields `tm start` writes. The dashboard used to flip the status and take the
 * claim without naming who, which session, which branch or which checkout — so a card started
 * from the board looked unclaimed on the next `tm board`.
 */
function gitOut(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function stamp(p) {
  const checkout = currentCheckout(p.root) || p.root;
  // symbolic-ref works on an unborn HEAD (just `git init -b`); rev-parse needs a commit.
  const branch =
    gitOut(checkout, ["symbolic-ref", "--short", "HEAD"]) ||
    gitOut(checkout, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return {
    actor: actorLabel(actor()),
    session: sessionId() || undefined,
    branch: branch && branch !== "HEAD" ? branch : undefined,
    worktree: checkout || undefined,
  };
}

/** Status changes carry the same consequences the CLI applies — gate, claim, epic. */
function transition(task, status, p, reason) {
  if (!STATUSES.includes(status)) return fail(400, `unknown status "${status}" — use one of: ${STATUSES.join(", ")}`);

  if (status === "done") {
    const gate = gateDone(task.id, p);
    if (!gate.allow) return fail(409, gate.reason);
  }

  const why = typeof reason === "string" && reason.trim() ? reason.trim() : undefined;
  update(
    task.id,
    {
      status,
      ...(status === "done" ? { closed: new Date().toISOString() } : {}),
      blockedReason: status === "blocked" ? why : undefined,
      parkedReason: status === "parked" ? why : undefined,
      ...(status === "in_progress" ? stamp(p) : {}),
    },
    p,
  );

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
 * Attach or detach. Detach filters the array and leaves the file. Attach uses the
 * same dest naming as `tm evidence` and appends under `mutate`.
 */
function writeEvidence(task, payload, p) {
  try {
    if (payload.detach != null || payload.remove != null) {
      return ok({ evidence: detachEvidence(task.id, String(payload.detach ?? payload.remove), p) });
    }
    if (payload.path) {
      const { ref } = attachEvidence(task.id, { path: payload.path }, p);
      return ok({ attached: ref, evidence: read(task.id, p).evidence });
    }
    if (payload.filename && (payload.buffer != null || payload.content != null)) {
      const { ref } = attachEvidence(task.id, {
        filename: payload.filename,
        buffer: payload.buffer,
        content: payload.content,
      }, p);
      return ok({ attached: ref, evidence: read(task.id, p).evidence });
    }
    if (payload.text != null && String(payload.text).length) {
      const { ref } = attachEvidence(task.id, { text: String(payload.text) }, p);
      return ok({ attached: ref, evidence: read(task.id, p).evidence });
    }
    return fail(400, "evidence needs text, path, a file, or detach");
  } catch (e) {
    return fail(/not found/i.test(e.message) ? 404 : 400, e.message);
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

/**
 * `POST /api/epic` does two jobs: activate (`{ id }`) and create (`{ title, body? }`).
 *
 * They share a path because create always sets the new epic active — the same write
 * `tm epic new` does — and a second route would be a second thing to remember. `id`
 * wins when both are present, so the existing `{ id }` clients keep activating.
 */
function postEpic(payload, p) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, "id")) return setActiveEpic(payload, p);
  if (payload && typeof payload.title === "string") return createEpic(payload, p);
  return fail(400, "POST /api/epic needs { id } to activate or { title } to create");
}

function createEpic({ title, body }, p) {
  const name = String(title || "").trim();
  if (!name) return fail(400, "an epic needs a title");
  const epic = create("epic", { title: name }, body || "", p);
  writeState({ activeEpic: epic.id }, p);
  logEvent("epic_active", { id: epic.id, via: "dashboard" }, p);
  return { status: 201, body: { id: epic.id, title: epic.title, activeEpic: epic.id } };
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

function closeEpic(epic, p) {
  if (epic.status === "done") return fail(409, `${epic.id} is already done`);
  update(epic.id, { status: "done", closed: now() }, p);
  if (state(p).activeEpic === epic.id) writeState({ activeEpic: null }, p);
  return ok(read(epic.id, p));
}

/**
 * `POST /api/adr` matches `tm_adr_new`: proposed, deciders empty, date today,
 * epic inherited from the active pointer. The drawer Accepts; supersede writes
 * a *new* ADR rather than rewriting an accepted Decision in place.
 */
function createAdr({ title, body }, p) {
  const name = String(title || "").trim();
  if (!name) return fail(400, "an ADR needs a title");
  const a = create(
    "adr",
    {
      title: name,
      status: "proposed",
      epic: state(p).activeEpic || null,
      deciders: [],
      date: now().slice(0, 10),
    },
    body || "## Context\n\n## Decision\n\n## Consequences\n",
    p,
  );
  return { status: 201, body: { id: a.id, title: a.title, status: a.status, epic: a.epic ?? null } };
}

function acceptAdr(adr, p) {
  if (adr.status !== "proposed") {
    return fail(409, `${adr.id} is ${adr.status} — only a proposed ADR can be accepted`);
  }
  update(adr.id, { status: "accepted" }, p);
  return ok(read(adr.id, p));
}

function supersedeAdr(adr, { title, body }, p) {
  if (adr.status === "superseded") return fail(409, `${adr.id} is already superseded`);
  const name = String(title || "").trim();
  if (!name) return fail(400, "a superseding ADR needs a title");
  const next = create(
    "adr",
    {
      title: name,
      status: "proposed",
      epic: adr.epic || state(p).activeEpic || null,
      deciders: [],
      date: now().slice(0, 10),
      supersedes: adr.id,
    },
    body || "## Context\n\n## Decision\n\n## Consequences\n",
    p,
  );
  update(adr.id, { status: "superseded" }, p);
  return { status: 201, body: { id: next.id, title: next.title, status: next.status, supersedes: adr.id } };
}

/**
 * `POST /api/sprint` does two jobs: activate (`{ id }`) and create (`{ title, ends? }`).
 * Create sets the new sprint active — the same write `tm sprint new` does.
 * `id` wins when both are present, so `{ id }` clients keep activating.
 */
function postSprint(payload, p) {
  if (payload && Object.prototype.hasOwnProperty.call(payload, "id")) return setActiveSprint(payload, p);
  if (payload && typeof payload.title === "string") return createSprint(payload, p);
  return fail(400, "POST /api/sprint needs { id } to activate or { title } to create");
}

function createSprint({ title, ends }, p) {
  const name = String(title || "").trim();
  if (!name) return fail(400, "a sprint needs a title");
  const until = typeof ends === "string" && ends.trim() ? ends.trim() : undefined;
  const doc = create("sprint", { title: name, status: "open", ...(until ? { ends: until } : {}) }, "", p);
  writeState({ activeSprint: doc.id }, p);
  logEvent("sprint", { id: doc.id, action: "new", via: "dashboard" }, p);
  return { status: 201, body: { id: doc.id, title: doc.title, activeSprint: doc.id, ends: doc.ends } };
}

function setActiveSprint({ id }, p) {
  if (id === null || id === "") {
    writeState({ activeSprint: null }, p);
    return ok({ activeSprint: null });
  }
  if (kindOf(id) !== "sprint") return fail(400, `not a sprint id: ${id}`);
  const sprint = read(id, p);
  if (!sprint) return fail(404, `no such sprint: ${id}`);
  writeState({ activeSprint: id }, p);
  return ok({ activeSprint: id });
}

function closeSprint(sprint, p) {
  if (sprint.status === "done") return fail(409, `${sprint.id} is already done`);
  update(sprint.id, { status: "done", closed: now() }, p);
  if (state(p).activeSprint === sprint.id) writeState({ activeSprint: null }, p);
  logEvent("sprint", { id: sprint.id, action: "done", via: "dashboard" }, p);
  // Unfinished work stays on the board with sprint still set — closing does not evaporate it.
  const left = list("task", {}, p).filter((t) => t.sprint === sprint.id && t.status !== "done");
  return ok({ ...read(sprint.id, p), unfinished: left.length });
}

function setTaskSprint(task, payload, p) {
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, "sprint")) {
    return fail(400, "POST /api/task/:id/sprint needs { sprint }");
  }
  const next = payload.sprint === null || payload.sprint === "" ? null : payload.sprint;
  if (next) {
    if (kindOf(next) !== "sprint") return fail(400, `not a sprint id: ${next}`);
    if (!read(next, p)) return fail(404, `no such sprint: ${next}`);
  }
  update(task.id, { sprint: next || undefined }, p);
  logEvent("sprint", { id: next, action: next ? "add" : "rm", tasks: [task.id], via: "dashboard" }, p);
  return ok({ id: task.id, sprint: read(task.id, p).sprint ?? null });
}

function reopenEpicDoc(epic, p) {
  if (epic.status !== "done") return fail(409, `${epic.id} is not done`);
  // reopenEpic is the store's named path: it clears `closed` and logs epic_reopened.
  // It no-ops when autoCloseEpics is off; an explicit reopen still has to write the
  // same fields, or the drawer button would lie.
  if (!reopenEpic(epic.id, p)) update(epic.id, { status: "open", closed: undefined }, p);
  return ok(read(epic.id, p));
}

function getTemplate(name, p) {
  try {
    const tpl = readTemplate(name, p);
    return tpl ? ok(tpl) : fail(404, `no such template: ${name}`);
  } catch (err) {
    return fail(400, err.message);
  }
}

function createTask({ title, epic, body, assignee, priority, template, acceptance }, p) {
  const name = String(title || "").trim();
  if (!name) return fail(400, "a task needs a title");

  const gate = gateTaskCreate(p);
  if (!gate.allow) return fail(409, gate.reason);

  const base = {
    title: name,
    epic: epic || state(p).activeEpic || null,
    acceptance: template && Array.isArray(acceptance) ? acceptance : [],
    evidence: [],
    commits: [],
    blockedBy: [],
    blocks: [],
    ...(assignee ? { assignee } : {}),
    ...(priority ? { priority } : {}),
  };

  // Same merge as `tm task new --template`: applyTemplate then create. Empty
  // acceptance/body are create defaults and must not erase what the template supplied.
  let fields = base;
  let taskBody = body || "";
  if (template) {
    try {
      const applied = applyTemplate(template, base, p);
      fields = applied.fields;
      delete fields.description;
      if (typeof body !== "string" || !body.trim()) taskBody = applied.body;
    } catch (err) {
      return fail(400, err.message);
    }
  }

  const task = create("task", fields, taskBody, p);
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
  /**
   * A board shows its own work and nothing else.
   *
   * The store is per-repo, so this is normally true by construction — but "normally true by
   * construction" is what let a persona task collect marketplace pull requests. A stray filed here
   * by an older `tm` is not this board's, and rendering it makes one project's board quietly wrong
   * about another's. `tm doctor` reports it as `foreign-entity`; the board simply does not draw it.
   *
   * Entities written before boards existed carry none, and belong to whoever holds them.
   */
  const board = storeBoard(p);
  const mine = (e) => !board || !e.board || e.board === board;
  return {
    epics: list("epic", {}, p).filter(mine).map(({ body, file, ...e }) => e),
    tasks: list("task", {}, p).filter(mine).map(({ body, file, ...t }) => t),
    // Empty `adrs/` is first-class: the list is `[]`, not omitted. Body stays on GET /api/adr/:id.
    adrs: list("adr", {}, p).filter(mine).map(({ body, file, ...a }) => a),
    // Empty `sprints/` is first-class: `[]`, not omitted. Report numbers come from
    // sprintCounts — the same helper sprintReport prints — so the header cannot drift.
    sprints: list("sprint", {}, p).filter(mine).map(({ body, file, ...s }) => ({
      ...s,
      report: reportFor(s.id, p),
    })),
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
