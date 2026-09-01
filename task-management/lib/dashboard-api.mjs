/**
 * The dashboard's write surface: `POST /api/task/:id/:action`, `PATCH /api/task/:id`,
 * `POST /api/task`, `POST /api/epic` (`{ id }` activate or `{ title }` create),
 * `GET /api/epic/:id`, `GET /api/adr/:id`, `POST /api/adr`, `POST /api/adr/:id/{accept,supersede}`,
 * `POST /api/sprint` (`{ title, ends? }` create or `{ id }` activate), `GET /api/sprint/:id`,
 * `POST /api/sprint/:id/done`, `POST /api/task/:id/sprint`,
 * `GET /api/capability/:id`, `POST /api/capability`, `POST /api/capability/:id/{accept,ship,drop}`,
 * `GET /api/worktrees`, `POST /api/task/:id/worktree`, `POST /api/task/:id/unlink`,
 * `GET /api/entity/:id`, `POST /api/bulk`, `GET /api/backlog`, `GET /api/templates[/:name]`.
 *
 * Evidence: `GET /api/task/:id/evidence` (derived items), `GET /api/task/:id/file?ref=`
 * (allowlisted bytes metadata), `POST /api/task/:id/evidence` (attach text/path or detach).
 * Multipart uploads are parsed in bin/tm-dashboard — the JSON body cap is 256 KB.
 *
 * Plans are not a KIND: `GET /api/plans` is a derived readdir, `GET /api/plans/file?ref=`
 * is confined like evidence, `POST /api/epic/:id/plan` sets or clears `epic.plan`.
 *
 * `handleWrite` is pure request-in / response-out so it unit-tests without a
 * server; bin/tm-dashboard is only plumbing. Every mutation delegates to the same
 * lib functions the CLI calls — never to the filesystem directly — so the gates,
 * the event log and the markdown store stay authoritative regardless of caller.
 *
 * Refusals carry the reason the CLI would have printed, so the UI can show *why*
 * rather than a dead 500: gate refusals are 409, bad input is 400, missing is 404.
 *
 * Insight reads — `GET /api/meta`, `/api/task/:id/{why,handoff,time,history}`, `/api/graph`,
 * `/api/standup`, `/api/time`, `/api/stale`, `/api/entity/:id/history`, `/api/find`,
 * `/api/claims`, `/api/parallel`, `/api/ntfy`, `/api/override`, `/api/doctor`, `/api/sessions`,
 * `/api/skills` — are the CLI's read verbs over HTTP, each a call into the same lib function.
 * Writes that existed only on the CLI: `POST /api/doctor/fix`, `/api/claims/sweep`,
 * `/api/task/:id/{claim,release,delete,restore}`, `/api/override`, `/api/goal/import`,
 * `/api/reindex`, `/api/templates` (+PATCH), and `PATCH /api/{epic,adr,sprint,capability}/:id`.
 * `POST /api/ntfy/test` is the one async route; it lives on `handleAsync`, which otherwise
 * delegates here, so `handleWrite` stays synchronous for its 100-odd unit tests.
 */
import { basename } from "node:path";
import { enforcementOff, gateDone, gateStart, gateTaskCreate, setOverride } from "./enforce.mjs";
import { graphData, mermaid, renderWhy, why } from "./graph.mjs";
import { COLUMNS, LABEL, collapseLog, handoff, renderHistory, standup } from "./render.mjs";
import { cycleTime, summary as timeSummary, taskTimeline, throughput, timeInStatus } from "./time.mjs";
import { FIELD_NAMES, describeQuery, matchesQuery, parseQuery } from "./query.mjs";
import { claimant, expired, releaseClaim, staleClaims, sweepClaims } from "./claims.mjs";
import { batches } from "./parallel.mjs";
import { CATALOG, messageFor, ntfyConfig, send, shouldPublish } from "./ntfy.mjs";
import { diagnose, render as renderDoctor, repairAll } from "./doctor.mjs";
import { currentHarness } from "./harness/sessions.mjs";
import { listSkills } from "./skills.mjs";
import { FORMATS } from "./export.mjs";
import { serverVersion } from "./mcp.mjs";
import { LINK_TYPES, TYPES } from "./issue.mjs";
import { EFFORTS, LEVELS, assertLevel } from "./capability.mjs";
import { importGoalDoc, importManifest } from "./goal-import.mjs";
import { addComment, addLink, assign, backlog, dependencies, estimate, labelCatalog, labels, prioritise, rank, removeLink, setType, subtasks } from "./issue.mjs";
import { isAbsolute, resolve, sep } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { hasAnswer } from "./decision.mjs";
import { applySettings, settingsSnapshot } from "./settings.mjs";
import { listWorktrees, provision, unprovision } from "./worktree.mjs";
import { currentCheckout, paths, projectName } from "./paths.mjs";
import { claimTask } from "./claims.mjs";
import { actor, actorLabel, sessionId, stamp as stampAt } from "./actor.mjs";
import { attachEvidence, detachEvidence, listEvidence, servableEvidencePath } from "./evidence.mjs";
import { listPlans, readPlanFile } from "./plans.mjs";
import {
  autoCloseEpic,
  config,
  create,
  editTask,
  kindOf,
  now,
  removeCriterion,
  setCriterion,
  moveTask,
  list,
  logEvent,
  read,
  readEvents,
  reindex,
  release,
  reopenEpic,
  staleTasks,
  state,
  unblockDependents,
  update,
  writeState,
  storeBoard,
  boardOwner,
  PRIORITIES,
} from "./store.mjs";
import { applyTemplate, listTemplates, readTemplate, writeTemplate } from "./templates.mjs";
import { sprintCounts } from "./render.mjs";
import { accept as acceptCap, drop as dropCap, propose, ranked, score as capScore, ship as shipCap } from "./capability.mjs";

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

function requireCapability(id, p) {
  const { doc, error } = requireKind(id, "capability", p);
  return error ? { error } : { cap: doc };
}

export function handleWrite(method, path, payload = {}, { p = paths() } = {}) {
  const raw = path || "";
  const url = raw.split("?")[0];
  const query = new URLSearchParams(raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : "");
  const insight = readRoute(method, url, query, p);
  if (insight) return insight;
  const written = writeRoute(method, url, payload, p);
  if (written) return written;
  if (method === "GET" && url === "/api/backlog") return ok(backlog(p));
  if (method === "GET" && url === "/api/templates") return ok(listTemplates(p));
  // Derived inbox, not a KIND. Empty plans/ is [] — add these before the /api/task/ catch-all.
  if (method === "GET" && url === "/api/plans") return ok(listPlans(p));
  if (method === "GET" && url === "/api/worktrees") return ok(listWorktrees(p));
  const entityGet = /^\/api\/entity\/([^/]+)$/.exec(url);
  if (method === "GET" && entityGet) return getEntity(decodeURIComponent(entityGet[1]), p);
  if (method === "GET" && url === "/api/plans/file") {
    const ref = query.get("ref") ?? payload.ref ?? "";
    const file = readPlanFile(ref, p);
    return file ? ok(file) : fail(404, "not found");
  }
  const tpl = /^\/api\/templates\/([^/]+)$/.exec(url);
  if (method === "GET" && tpl) {
    try {
      return getTemplate(decodeURIComponent(tpl[1]), p);
    } catch (err) {
      return fail(400, err.message);
    }
  }
  if (method === "PATCH" && tpl) return putTemplate(decodeURIComponent(tpl[1]), payload, true, p);
  if (method === "POST" && url === "/api/templates") return putTemplate(payload?.name, payload, Boolean(payload?.overwrite), p);
  if (method === "POST" && url === "/api/task") return createTask(payload, p);
  if (method === "POST" && url === "/api/bulk") return bulk(payload, p);
  if (method === "POST" && url === "/api/epic") return postEpic(payload, p);
  if (method === "POST" && url === "/api/adr") return createAdr(payload, p);
  if (method === "POST" && url === "/api/sprint") return postSprint(payload, p);
  if (method === "POST" && url === "/api/capability") return createCapability(payload, p);
  if (method === "GET" && url === "/api/settings") return ok(settingsSnapshot(p));
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
  if (method === "PATCH" && epicGet) {
    const { epic, error } = requireEpic(decodeURIComponent(epicGet[1]), p);
    return error || editEntity(epic, payload, {}, p);
  }

  const epicAct = /^\/api\/epic\/([^/]+)\/([a-z]+)$/.exec(url);
  if (epicAct) {
    const id = decodeURIComponent(epicAct[1]);
    const action = epicAct[2];
    const { epic, error } = requireEpic(id, p);
    if (error) return error;
    if (method === "POST" && action === "close") return closeEpic(epic, p);
    if (method === "POST" && action === "reopen") return reopenEpicDoc(epic, p);
    if (method === "POST" && action === "plan") return setEpicPlan(epic, payload, p);
    return fail(404, `unknown action "${action}"`);
  }

  // ADR detail and lifecycle sit beside the epic routes so `/api/task/ADR-*` stays
  // requireTask (400). Status is proposed/accepted/superseded — not a task Status.
  const adrGet = /^\/api\/adr\/([^/]+)$/.exec(url);
  if (method === "GET" && adrGet) {
    const { adr, error } = requireAdr(decodeURIComponent(adrGet[1]), p);
    return error || ok(adr);
  }
  if (method === "PATCH" && adrGet) {
    const { adr, error } = requireAdr(decodeURIComponent(adrGet[1]), p);
    if (error) return error;
    // ponytail: body edits on an accepted ADR are allowed — deciders and typos are not decisions.
    // Add a status gate here if someone rewrites an accepted Decision in place; supersede exists.
    return editEntity(adr, payload, { deciders: (v) => (Array.isArray(v) && v.every((d) => typeof d === "string") ? v : null) }, p);
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
  if (method === "PATCH" && sprintGet) {
    const { sprint, error } = requireSprint(decodeURIComponent(sprintGet[1]), p);
    if (error) return error;
    const res = editEntity(sprint, payload, { ends: (v) => (v === null || /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? v : null) }, p);
    return res.status === 200 ? ok({ ...res.body, report: reportFor(sprint.id, p) }) : res;
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

  // Capability detail and lifecycle sit beside adr/epic so `/api/task/CAP-*`
  // stays requireTask (400). Caps are never a sixth kanban column.
  const capGet = /^\/api\/capability\/([^/]+)$/.exec(url);
  if (method === "GET" && capGet) {
    const { cap, error } = requireCapability(decodeURIComponent(capGet[1]), p);
    return error || ok({ ...cap, score: capScore(cap) });
  }
  if (method === "PATCH" && capGet) {
    const { cap, error } = requireCapability(decodeURIComponent(capGet[1]), p);
    if (error) return error;
    const level = (field, allowed) => (v) => {
      assertLevel(field, v, allowed); // throws the lib's own wording; caught by editEntity as 400
      return v;
    };
    const res = editEntity(cap, payload, {
      area: (v) => (typeof v === "string" ? v.trim() || null : null),
      source: (v) => (typeof v === "string" ? v.trim() || null : null),
      impact: level("impact", LEVELS),
      effort: level("effort", EFFORTS),
      confidence: level("confidence", LEVELS),
    }, p);
    return res.status === 200 ? ok({ ...res.body, score: capScore(res.body) }) : res;
  }

  const capAct = /^\/api\/capability\/([^/]+)\/([a-z]+)$/.exec(url);
  if (capAct) {
    const id = decodeURIComponent(capAct[1]);
    const action = capAct[2];
    const { cap, error } = requireCapability(id, p);
    if (error) return error;
    if (method === "POST" && action === "accept") return acceptCapability(cap, p);
    if (method === "POST" && action === "ship") return shipCapability(cap, payload, p);
    if (method === "POST" && action === "drop") return dropCapability(cap, payload, p);
    return fail(404, `unknown action "${action}"`);
  }

  const match = /^\/api\/task\/([^/]+)(?:\/([a-z]+))?$/.exec(url);
  if (!match) return fail(404, `no route for ${method} ${url}`);

  const id = decodeURIComponent(match[1]);
  const action = match[2];
  const { task, error } = requireTask(id, p);
  if (error) return error;
  if (method === "GET" && action === "evidence") return ok({ evidence: listEvidence(task, p) });
  if (method === "GET" && action === "why") {
    const w = why(task.id, p);
    return w ? ok({ ...w, text: renderWhy(w) }) : fail(404, `not found: ${task.id}`);
  }
  if (method === "GET" && action === "handoff") return ok({ id: task.id, text: handoff(task.id, p) });
  if (method === "GET" && action === "time") {
    return ok({ id: task.id, cycle: cycleTime(task.id, p), inStatus: timeInStatus(task.id, p), timeline: taskTimeline(task.id, p) });
  }
  if (method === "GET" && action === "history") return ok(history(task.id, p));
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
        if (payload.remove) return ok({ links: removeLink(id, payload.type, payload.to, p) });
        return ok({ links: addLink(id, payload.type, payload.to, p) });
      case "unlink":
        return ok({ links: removeLink(id, payload.type, payload.to, p) });
      case "worktree":
        return taskWorktree(task, payload, p);
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
      case "claim":
        return claimOnly(task, payload, p);
      case "release":
        return ok({ id: task.id, released: releaseClaim(task.id, p) });
      case "delete":
        return deleteTask(task, payload, p);
      case "restore":
        return restoreTask(task, p);
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

/** The same four fields `tm start` writes — see lib/actor.mjs. */
function stamp(p) {
  return stampAt(currentCheckout(p.root) || p.root);
}

/** Status changes carry the same consequences the CLI applies — gate, claim, epic. */
function transition(task, status, p, reason) {
  if (!STATUSES.includes(status)) return fail(400, `unknown status "${status}" — use one of: ${STATUSES.join(", ")}`);

  if (status === "done") {
    const gate = gateDone(task.id, p);
    if (!gate.allow) return fail(409, gate.reason);
  }
  // The WIP limit the terminal and MCP enforce. The board had none, so it was the one surface that
  // could quietly exceed the policy every other surface refused.
  if (status === "in_progress") {
    const gate = gateStart(task.id, p);
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
 * Project settings. The catalog in settings.mjs is the allowlist — identity and
 * unknown keys are refused, policy keys are writable because they already are via
 * `tm config` and they are project-scoped.
 */
function saveSettings(patch, p) {
  try {
    const res = applySettings(patch, p);
    return ok({ board: config(p).board, ...res });
  } catch (err) {
    return fail(err.status || 400, err.message);
  }
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

function getEntity(id, p) {
  const kind = kindOf(id);
  if (!kind) return fail(400, `unknown prefix: ${id}`);
  const doc = read(id, p);
  return doc ? ok(doc) : fail(404, `not found: ${id}`);
}

function taskWorktree(task, payload, p) {
  const action = payload?.action;
  if (action === "create") {
    // provision claims first, so a task another live session holds is refused with nothing on disk.
    const res = provision(task, {
      steal: Boolean(payload.steal),
      session: sessionId(),
      actor: actorLabel(actor()),
      p,
    });
    if (!res.ok) return fail(409, res.reason);
    return ok({ id: task.id, worktree: res.path, branch: res.branch, shared: res.shared, stolenFrom: res.stolenFrom ?? null });
  }
  if (action === "remove") {
    const res = unprovision(task, { force: Boolean(payload.force), p });
    if (!res.ok) return fail(409, res.reason);
    return ok({ id: task.id, worktree: null, removed: true, unlinked: res.unlinked });
  }
  return fail(400, 'POST /api/task/:id/worktree needs { action: "create"|"remove" }');
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

function setEpicPlan(epic, payload, p) {
  if (!payload || !Object.prototype.hasOwnProperty.call(payload, "plan")) {
    return fail(400, "POST /api/epic/:id/plan needs { plan }");
  }
  const raw = payload.plan;
  if (raw != null && typeof raw !== "string") return fail(400, "plan must be a path string or null");
  const next = raw == null || !String(raw).trim() ? undefined : String(raw).trim();
  update(epic.id, { plan: next }, p);
  return ok(read(epic.id, p));
}

/**
 * `POST /api/capability` is `tm cap new`: propose, do not commit. Accept mints
 * the task. No epic is written on the card — join is `cap.task` → `task.epic`.
 */
function createCapability(payload, p) {
  try {
    const cap = propose(payload || {}, p);
    return {
      status: 201,
      body: {
        id: cap.id,
        title: cap.title,
        status: cap.status,
        area: cap.area,
        impact: cap.impact,
        effort: cap.effort,
        confidence: cap.confidence,
        score: capScore(cap),
      },
    };
  } catch (e) {
    return fail(400, e.message);
  }
}

function acceptCapability(cap, p) {
  try {
    const res = acceptCap(cap.id, p);
    return ok({
      id: res.cap.id,
      task: res.task?.id ?? null,
      existing: Boolean(res.existing),
      status: res.cap.status,
    });
  } catch (e) {
    return fail(/not found/i.test(e.message) ? 404 : 400, e.message);
  }
}

function shipCapability(cap, payload, p) {
  try {
    const doc = shipCap(cap.id, { evidence: payload?.evidence, task: payload?.task }, p);
    return ok({ id: doc.id, status: doc.status, shipped: doc.shipped });
  } catch (e) {
    if (/no evidence/.test(e.message)) return fail(409, e.message);
    return fail(/not found/i.test(e.message) ? 404 : 400, e.message);
  }
}

function dropCapability(cap, payload, p) {
  try {
    const doc = dropCap(cap.id, payload?.why, p);
    return ok({ id: doc.id, status: doc.status, droppedReason: doc.droppedReason || "" });
  } catch (e) {
    return fail(/not found/i.test(e.message) ? 404 : 400, e.message);
  }
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

// ── insight reads ─────────────────────────────────────────────────────────────

/** Findings without their `fix` closures — a function does not survive JSON, and the UI fixes via POST. */
const plainFindings = (findings) => findings.map(({ fix, ...f }) => f);

/** One entity's events, collapsed and labelled the way `/api/events` and `tm log <id>` are. */
function history(id, p) {
  const rows = readEvents(p).filter((e) => e && e.id === id);
  const events = collapseLog(rows, { keep: true }).map((e) => ({ ...e, label: CATALOG.events[e.event]?.label || e.event }));
  return { id, events, text: renderHistory(id, rows, p) };
}

/**
 * What the SPA needs to hardcode nothing: every vocabulary the store owns, the identity of the
 * board, and the plugin's version — so a UI built against one plugin can tell when it is talking
 * to another.
 */
function meta(p) {
  const s = state(p);
  return {
    plugin: { version: serverVersion(), root: resolve(new URL("..", import.meta.url).pathname) },
    store: { root: p.root, base: p.base, boardId: storeBoard(p) || null, owner: boardOwner(p) || null, project: projectName(p) },
    harness: currentHarness()?.id ?? null,
    actor: actorLabel(actor()),
    session: sessionId(),
    vocab: {
      columns: COLUMNS,
      labels: LABEL,
      priorities: PRIORITIES,
      types: TYPES,
      linkTypes: LINK_TYPES,
      adrStatuses: ["proposed", "accepted", "superseded"],
      capLevels: LEVELS,
      capEfforts: EFFORTS,
      findFields: FIELD_NAMES,
      eventCatalog: CATALOG.events,
      eventGroups: { recommended: CATALOG.recommended, writes: CATALOG.writes, noise: CATALOG.noise },
      exportFormats: FORMATS,
      labelCatalog: labelCatalog(p),
    },
    settings: settingsSnapshot(p),
    config: config(p),
    gates: { enforce: !enforcementOff(p), override: s.override ?? null },
  };
}

function findRoute(query, p) {
  let parsed;
  try {
    parsed = parseQuery(String(query.get("q") || "").split(/\s+/).filter(Boolean));
  } catch (e) {
    return fail(400, e.message); // names the fields that exist, so `assigne:` is a refusal not an empty page
  }
  const hits = [];
  for (const kind of ["epic", "task", "adr", "capability", "sprint"]) {
    for (const d of list(kind, {}, p)) {
      if (!matchesQuery({ ...d, kind }, parsed)) continue;
      const { body, file, ...row } = d;
      hits.push({ ...row, kind });
    }
  }
  return ok({ query: describeQuery(parsed), hits });
}

function sessionsRoute(p) {
  const bySession = new Map();
  for (const [id, claim] of Object.entries(state(p).claims || {})) {
    const key = claim.session || "(no session)";
    const row = bySession.get(key) || {
      session: claim.session ?? null,
      actor: claim.actor ?? null,
      worktree: claim.worktree ?? null,
      branch: claim.branch ?? null,
      pid: claim.pid ?? null,
      ts: claim.ts ?? null,
      live: false,
      tasks: [],
    };
    row.tasks.push(id);
    if (!expired(claim, p)) row.live = true;
    if (claim.ts && (!row.ts || claim.ts > row.ts)) row.ts = claim.ts;
    bySession.set(key, row);
  }
  // ponytail: claims are the only session registry the store has. The per-task /stream already
  // reads transcripts; a live-session scan across harness session dirs can join it here later.
  return ok({ harness: currentHarness()?.id ?? null, mine: sessionId(), sessions: [...bySession.values()] });
}

function readRoute(method, url, query, p) {
  if (method !== "GET") return null;
  switch (url) {
    case "/api/meta":
      return ok(meta(p));
    case "/api/graph": {
      const opts = { epic: query.get("epic") || null, includeDone: query.get("all") === "1" || query.get("all") === "true" };
      const drawn = mermaid({ ...opts, subtasks: query.get("subtasks") !== "0" }, p);
      // mermaid() reports counts under `tasks`/`edges`; the data shape owns those names.
      return ok({ ...graphData(opts, p), mermaid: drawn.mermaid, counts: { tasks: drawn.tasks, edges: drawn.edges } });
    }
    case "/api/standup": {
      const since = query.get("since") || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      if (!Number.isFinite(Date.parse(since))) return fail(400, `since must be an ISO timestamp, not "${since}"`);
      return ok({ since, text: standup(since, p) });
    }
    case "/api/time":
      return ok({ ...timeSummary(p), throughput: throughput(p) });
    case "/api/stale":
      return ok({ minutes: config(p).staleMinutes, tasks: staleTasks(p).map((t) => t.id) });
    case "/api/find":
      return findRoute(query, p);
    case "/api/claims": {
      const claims = state(p).claims || {};
      return ok({
        claims,
        stale: staleClaims(p),
        wipLimit: config(p).wipLimit ?? null,
        inProgress: list("task", { status: "in_progress" }, p).length,
      });
    }
    case "/api/parallel":
      return ok({ batches: batches({ epic: query.get("epic") || null }, p) });
    case "/api/ntfy": {
      const { token, ...cfg } = ntfyConfig(p);
      return ok({ config: cfg, hasToken: Boolean(token), catalog: CATALOG.events, groups: { recommended: CATALOG.recommended, writes: CATALOG.writes, noise: CATALOG.noise } });
    }
    case "/api/override":
      return ok({ override: state(p).override ?? null, enforce: !enforcementOff(p) });
    case "/api/doctor": {
      const findings = diagnose(p);
      return ok({
        findings: plainFindings(findings),
        errors: findings.filter((f) => f.level === "error").length,
        warnings: findings.filter((f) => f.level === "warning").length,
        fixable: findings.filter((f) => f.fixable).length,
        text: renderDoctor(findings),
      });
    }
    case "/api/sessions":
      return sessionsRoute(p);
    case "/api/skills":
      return ok(listSkills());
    default: {
      const hist = /^\/api\/entity\/([^/]+)\/history$/.exec(url);
      if (hist) {
        const id = decodeURIComponent(hist[1]);
        if (!kindOf(id)) return fail(400, `unknown prefix: ${id}`);
        if (!read(id, p)) return fail(404, `not found: ${id}`);
        return ok(history(id, p));
      }
      return null;
    }
  }
}

// ── writes that lived only on the CLI ─────────────────────────────────────────

/** A stray click must not rewrite files: the destructive fixes need `{ confirm: true }`. */
const confirmed = (payload) => payload && payload.confirm === true;

function writeRoute(method, url, payload, p) {
  if (method !== "POST") return null;
  switch (url) {
    case "/api/doctor/fix": {
      if (!confirmed(payload)) return fail(400, "doctor --fix rewrites files: send { confirm: true }");
      const applied = repairAll(p);
      const after = diagnose(p);
      return ok({ applied, findings: plainFindings(after), text: renderDoctor(after, { fixed: applied }) });
    }
    case "/api/claims/sweep": {
      if (!confirmed(payload)) return fail(400, "sweep releases other sessions' claims: send { confirm: true }");
      return ok({ released: sweepClaims(p) });
    }
    case "/api/override": {
      const reason = typeof payload?.reason === "string" ? payload.reason.trim() : "";
      if (!reason) return fail(400, "an override needs a reason — it is recorded");
      setOverride(reason, p);
      return ok({ override: state(p).override });
    }
    case "/api/reindex":
      return ok(counts(reindex(p)));
    case "/api/goal/import":
      return goalImport(payload, p);
    default:
      return null;
  }
}

const counts = (index) => Object.fromEntries(["epics", "tasks", "adrs", "sprints", "capabilities"].map((k) => [k, (index?.[k] || []).length]));

/**
 * `{ path }` reads a doc or manifest inside the repo — confined to p.root, because a route that
 * reads any file on disk is a route that reads ~/.ssh. `{ content, name }` takes the doc itself,
 * so a pasted goal never touches the filesystem at all. A manifest has to be a path: its docs are
 * resolved relative to where it lives.
 */
function goalImport(payload, p) {
  const epic = typeof payload?.epic === "string" && payload.epic ? payload.epic : null;
  try {
    if (typeof payload?.content === "string") {
      const source = String(payload.name || "pasted goal").trim() || "pasted goal";
      const { task, parsed, doc } = importGoalDoc(payload.content, { source, epic, stamp: stamp(p) }, p);
      return { status: 201, body: { id: task.id, title: task.title, epic: task.epic ?? null, criteria: parsed.criteria.length, doc } };
    }
    if (typeof payload?.path !== "string" || !payload.path.trim()) return fail(400, "goal import needs { path } or { content, name }");
    const full = isAbsolute(payload.path) ? resolve(payload.path) : resolve(p.root, payload.path);
    if (full !== p.root && !full.startsWith(p.root + sep)) return fail(400, `path must be inside ${p.root}`);
    if (!existsSync(full)) return fail(404, `no such file: ${payload.path}`);
    if (/\.json$/i.test(full)) {
      const res = importManifest(full, { stamp: stamp(p) }, p);
      return {
        status: 201,
        body: {
          epic: res.epic.id,
          title: res.epic.title,
          tasks: res.tasks,
          skipped: res.skipped,
          edges: res.edges,
          danglingDeps: res.danglingDeps,
          touched: res.touched,
        },
      };
    }
    const { task, parsed, doc } = importGoalDoc(readFileSync(full, "utf8"), { source: full, epic, stamp: stamp(p) }, p);
    return { status: 201, body: { id: task.id, title: task.title, epic: task.epic ?? null, criteria: parsed.criteria.length, doc } };
  } catch (e) {
    return fail(e.status || 400, e.message);
  }
}

/** Claim without starting — `tm claim`. Start remains `transition { status: "in_progress" }`. */
function claimOnly(task, payload, p) {
  const checkout = currentCheckout(p.root) || p.root;
  const { branch } = stamp(p);
  const res = claimTask(task.id, {
    session: sessionId(),
    actor: actorLabel(actor()),
    worktree: checkout,
    branch,
    steal: Boolean(payload?.steal),
    p,
  });
  if (!res.ok) return fail(409, res.reason);
  return ok({ id: task.id, claim: state(p).claims?.[task.id] ?? null, stolenFrom: res.stolenFrom ?? null });
}

/**
 * Soft delete: the file stays, `list()` hides it, and `restore` brings it back. A task another live
 * session is working on is refused — deleting someone's in-flight work from a browser tab is the
 * kind of thing the claim interlock exists to stop.
 */
function deleteTask(task, payload, p) {
  if (task.status === "deleted") return fail(409, `${task.id} is already deleted`);
  const held = claimant(task.id, p);
  if (held && held.session && held.session !== sessionId()) {
    return fail(409, `${task.id} is claimed by ${held.actor || `session ${held.session}`} — release it first`);
  }
  const why = typeof payload?.why === "string" && payload.why.trim() ? payload.why.trim() : undefined;
  update(task.id, { status: "deleted", deletedReason: why, deletedFrom: task.status }, p);
  release(task.id, p);
  logEvent("deleted", { id: task.id, from: task.status, ...(why ? { why } : {}) }, p);
  return ok({ id: task.id, status: "deleted" });
}

function restoreTask(task, p) {
  if (task.status !== "deleted") return fail(409, `${task.id} is not deleted`);
  const back = task.deletedFrom && STATUSES.includes(task.deletedFrom) && task.deletedFrom !== "done" ? task.deletedFrom : "open";
  update(task.id, { status: back, deletedReason: undefined, deletedFrom: undefined }, p);
  logEvent("reopened", { id: task.id, from: "deleted" }, p);
  return ok({ id: task.id, status: back });
}

/**
 * Title/body through `editTask` (kind-agnostic in practice — read, update, log `edit`), plus a
 * per-kind allowlist of extra fields with a validator each. A validator returns the value to
 * store, `null` to refuse, or throws the lib's own message; either refusal is 400.
 */
function editEntity(doc, payload, extra, p) {
  const patch = {};
  const changed = [];
  try {
    if (typeof payload?.title === "string" || typeof payload?.body === "string") {
      changed.push(...editTask(doc.id, { title: payload.title, body: payload.body }, p).changed);
    }
    for (const [field, check] of Object.entries(extra)) {
      if (!(payload && Object.prototype.hasOwnProperty.call(payload, field))) continue;
      const value = check(payload[field]);
      if (value === null && payload[field] !== null) return fail(400, `${field} is not valid: ${JSON.stringify(payload[field])}`);
      patch[field] = value === null ? undefined : value;
      changed.push(field);
    }
  } catch (e) {
    return fail(400, e.message);
  }
  if (!changed.length) return fail(400, "nothing to change");
  if (Object.keys(patch).length) update(doc.id, patch, p);
  return ok({ ...read(doc.id, p), changed });
}

function putTemplate(name, payload, overwrite, p) {
  if (!name || typeof name !== "string") return fail(400, "a template needs a name");
  try {
    const tpl = writeTemplate(name, {
      description: payload?.description,
      fields: payload?.fields,
      body: payload?.body,
      overwrite,
    }, p);
    return { status: overwrite ? 200 : 201, body: tpl };
  } catch (err) {
    return fail(err.status || 400, err.message);
  }
}

// ── the one async route ──────────────────────────────────────────────────────

/**
 * `POST /api/ntfy/test` — the same push `tm ntfy test` sends, with the same explanation when it
 * declines. Async because `send` is; everything else stays on the synchronous `handleWrite`.
 */
export async function handleAsync(method, path, payload = {}, { p = paths(), fetchImpl } = {}) {
  const url = (path || "").split("?")[0];
  if (method === "POST" && url === "/api/ntfy/test") {
    const cfg = ntfyConfig(p);
    if (!cfg.token) return ok({ sent: false, reason: "TM_NTFY_TOKEN is not set in this environment" });
    if (!cfg.topic) return ok({ sent: false, reason: "no topic configured — `.bytedesk/task-management/bin/tm ntfy topic <name>`" });
    const msg = messageFor({ event: "notification", id: payload?.id || null, actor: actorLabel(actor()) }, null, cfg);
    msg.title = "task-management test";
    msg.body = `test push from ${p.root}`;
    const res = await send(msg, cfg, fetchImpl ? { fetchImpl } : {});
    return ok({ sent: res.ok, status: res.status, error: res.error, topic: `${cfg.server}/${cfg.topic}` });
  }
  return handleWrite(method, path, payload, { p });
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
    tasks: list("task", {}, p).filter(mine).map(({ body, file, ...t }) => ({
      ...t,
      hasAnswer: hasAnswer(body),
    })),
    // Empty `adrs/` is first-class: the list is `[]`, not omitted. Body stays on GET /api/adr/:id.
    adrs: list("adr", {}, p).filter(mine).map(({ body, file, ...a }) => a),
    // Empty `sprints/` is first-class: `[]`, not omitted. Report numbers come from
    // sprintCounts — the same helper sprintReport prints — so the header cannot drift.
    sprints: list("sprint", {}, p).filter(mine).map(({ body, file, ...s }) => ({
      ...s,
      report: reportFor(s.id, p),
    })),

// Ranked enhancement backlog. Empty `capabilities/` is `[]`, not omitted. Body on GET.
    // Score is derived (impact × ease × confidence); epic is never stored on the card.
    // Every card, not just the open backlog: the board's capabilities screen shows shipped and
    // dropped work too, ranked within each status.
    capabilities: ["open", "in_progress", "done"].flatMap((status) => ranked(p, { status }))
      .concat(list("capability", { status: "deleted", includeDeleted: true }, p))
      .filter(mine)
      .map(({ body, file, ...c }) => ({ ...c, score: capScore(c) })),

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
    // Canonical + configured label vocabulary, so the picker can offer roles that no card wears yet.
    labelCatalog: labelCatalog(p),
  };
}

export { backlog };
