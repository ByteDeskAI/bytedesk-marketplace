// The run-check that fires whenever a supported coding-agent session starts (TM-127, AC4).
//
// Detection is AFTER startup, by design. A session the check has never seen is labelled
// `pending-enrollment` — nothing is killed, nothing is sent keys, and no label may claim that
// arbitrary CLI work was preemptively blocked. Three complementary paths feed the check:
//
//   1. Native hooks    — an adapter declares a hooks capability (`providers/*.json` → hooks), and
//                        installHooks merges a SessionStart entry into that CLI's own settings
//                        file. Only mechanisms we have observed are declared; every other adapter
//                        honestly reports no native coverage.
//   2. Managed launch  — afterSessionOpen() is called from the session-open / lead-ensure paths
//                        with source "managed-launch".
//   3. Watcher         — one supervised watcher per tmux server (watchServer) catches direct,
//                        hookless starts by observing provider processes and repository cwd on an interval.
//
// The hooks path reads and writes exactly ONE file — the CLI's declared settings JSON. No
// credential file is ever opened. Unrelated hook entries and unrelated top-level keys are
// preserved; a corrupt settings file is an error, never an overwrite.
import { appendFile, mkdir, readdir, readFile, rm, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { TopologyError, exists, fail, invariant, nowIso, sleep } from "./util.mjs";
import { canonicalRepoId, repoKey, stateRoot } from "./repoid.mjs";
import { withLock } from "./lockfile.mjs";
import * as tmuxApi from "./tmux.mjs";
import { createHash, randomUUID } from "node:crypto";

const PENDING_NOTE = "detected after startup; nothing was blocked or pre-empted";
const OUR_MARKER = "bytedesk-agent-orchestration-startup-v1";

/** The adapter's declared native-hook capability ({ kind, path, event }), or null for none. */
export function hookSupport(adapter) {
  return adapter?.hooks ?? null;
}

// ---------------------------------------------------------------------------------------------
// Native hooks (kind "claude-settings")

/** Expand the adapter's configured settings path, honouring the caller's home over the process's. */
function settingsPath(hooks, home) {
  const configured = hooks.path;
  if (configured === "~") return home ?? homedir();
  if (configured.startsWith("~/")) return join(home ?? homedir(), configured.slice(2));
  return configured;
}

function shellQuote(value) { return "'" + value.replaceAll("'", "'\"'\"'") + "'"; }
function ourHookEntry(cliBin) {
  return { matcher: "", hooks: [{ type: "command", command: `${shellQuote(cliBin)} startup-check --source hook # ${OUR_MARKER}` }] };
}
function isManaged(hook) {
  return hook?.type === "command" && typeof hook.command === "string"
    && /^'(?:[^']|'"'"')+' startup-check --source hook # bytedesk-agent-orchestration-startup-v1$/.test(hook.command);
}
function isOurs(entry) { return Array.isArray(entry?.hooks) && entry.hooks.some(isManaged); }
function removeManaged(entries) {
  let removed = 0;
  const kept = entries.flatMap(entry => {
    if (!Array.isArray(entry?.hooks)) return [entry];
    const hooks = entry.hooks.filter(hook => { if (!isManaged(hook)) return true; removed++; return false; });
    return hooks.length === entry.hooks.length ? [entry] : hooks.length ? [{ ...entry, hooks }] : [];
  });
  return { kept, removed };
}
async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}
// Locate a JSON value without reformatting unrelated settings or events.
function valueSpan(text, wanted) {
  let i = 0, found;
  const ws = () => { while (/\s/.test(text[i] ?? "") && i < text.length) i++; };
  const str = () => { const start = i++; while (i < text.length) { if (text[i++] === '"') break; if (text[i-1] === "\\") i++; } return JSON.parse(text.slice(start, i)); };
  function value(path) {
    ws(); const start = i;
    if (text[i] === "{") { i++; ws(); while (text[i] !== "}") { const key = str(); ws(); i++; value([...path, key]); ws(); if (text[i] !== ",") break; i++; ws(); } i++; }
    else if (text[i] === "[") { i++; ws(); let n=0; while(text[i] !== "]") { value([...path, n++]); ws(); if(text[i] !== ",") break; i++; } i++; }
    else if (text[i] === '"') str();
    else { while(i < text.length && !/[\s,}\]]/.test(text[i])) i++; }
    if (JSON.stringify(path) === JSON.stringify(wanted)) found = [start, i];
  }
  value([]); return found;
}
async function writeSettings(path, settings, original, event) {
  let rendered = `${JSON.stringify(settings, null, 2)}\n`;
  if (original) {
    const span = valueSpan(original, ["hooks", event]);
    if (span) rendered = original.slice(0, span[0]) + JSON.stringify(settings.hooks[event], null, 2) + original.slice(span[1]);
    else {
      const parent = valueSpan(original, ["hooks"]) ?? valueSpan(original, []);
      const hasHooks = Boolean(valueSpan(original, ["hooks"]));
      const obj = JSON.parse(original.slice(...parent));
      const addition = hasHooks ? `${JSON.stringify(event)}:${JSON.stringify(settings.hooks[event])}` : `"hooks":${JSON.stringify(settings.hooks)}`;
      rendered = original.slice(0, parent[1]-1) + (Object.keys(obj).length ? "," : "") + addition + original.slice(parent[1]-1);
    }
  }
  const current = await readFile(path, "utf8").catch(e => { if(e.code === "ENOENT") return null; throw e; });
  invariant(current === original, "TOPOLOGY_STARTUP_HOOKS", "Settings changed during hook installation; retry to preserve the editor's changes.");
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, rendered, { mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}

/**
 * Read the settings file as JSON. A missing file is an empty object (install creates the minimal
 * structure); a CORRUPT file is TOPOLOGY_STARTUP_HOOKS — we never overwrite a file we cannot read,
 * because the unreadable parts are someone else's configuration.
 */
async function readSettings(path) {
  if (!(await exists(path))) return { settings: {}, missing: true, original: null };
  const text = await readFile(path, "utf8");
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (error) {
    fail(
      "TOPOLOGY_STARTUP_HOOKS",
      `${path} is not valid JSON (${error.message}). Refusing to touch it — fix or remove the file by hand; we never overwrite settings we cannot read.`,
      { path },
    );
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    fail("TOPOLOGY_STARTUP_HOOKS", `${path} does not hold a JSON object. Refusing to touch it.`, { path });
  }
  return { settings, missing: false, original: text };
}

function requireHooks(adapter, verb) {
  const hooks = hookSupport(adapter);
  invariant(
    hooks,
    "TOPOLOGY_STARTUP_HOOKS",
    `Adapter ${adapter?.id ?? "?"} declares no native hook mechanism, so ${verb} is not possible for it. Coverage is pinned to what has been observed — use the watcher for this CLI.`,
  );
  invariant(
    hooks.kind === "claude-settings",
    "TOPOLOGY_STARTUP_HOOKS",
    `Adapter ${adapter.id}: hook kind ${JSON.stringify(hooks.kind)} is not supported (only "claude-settings" is).`,
  );
  return hooks;
}

/**
 * Merge our SessionStart entry into the adapter CLI's settings file. Every unrelated hook entry,
 * every other event, and every unrelated top-level key survives. Idempotent: our entry is matched
 * on our exact marked command and replaced, so installing twice yields exactly one.
 */
export async function installHooks({ adapter, cliBin, home, env } = {}) {
  const hooks = requireHooks(adapter, "hook install");
  invariant(typeof cliBin === "string" && cliBin, "TOPOLOGY_STARTUP_HOOKS", "installHooks needs cliBin — the command the hook will run.");
  const path = settingsPath(hooks, home);
  await mkdir(dirname(path), { recursive: true });
  return withLock(`${path}.ao-startup.lock`, async () => {
    const { settings, missing, original } = await readSettings(path);
    const event = hooks.event;
    const all = settings.hooks ?? {};
    invariant(typeof all === "object" && !Array.isArray(all) && (!all[event] || Array.isArray(all[event])), "TOPOLOGY_STARTUP_HOOKS", "Invalid hooks settings; refusing to overwrite.");
    const { kept } = removeManaged(all[event] ?? []);
    settings.hooks = { ...all, [event]: [...kept, ourHookEntry(cliBin)] };
    await writeSettings(path, settings, original, event);
    return { installed: true, path, created: missing, event };
  });
}

/** Remove ONLY our exact entry, leaving foreign entries, the event array, and the file itself. */
export async function uninstallHooks({ adapter, home, env } = {}) {
  const hooks = requireHooks(adapter, "hook uninstall");
  const path = settingsPath(hooks, home);
  if (!(await exists(path))) return { removed: 0, path };
  return withLock(`${path}.ao-startup.lock`, async () => {
    const { settings, original } = await readSettings(path);
    const event = hooks.event;
    const entries = settings.hooks?.[event];
    if (!Array.isArray(entries)) return { removed: 0, path };
    const { kept, removed } = removeManaged(entries);
    if (removed) { settings.hooks[event] = kept; await writeSettings(path, settings, original, event); }
    return { removed, path };
  });
}

/** Whether our entry is currently present. Never throws on a missing file; a corrupt one is reported, not read past. */
export async function hooksStatus({ adapter, home, env } = {}) {
  const hooks = hookSupport(adapter);
  if (!hooks) return { supported: false, installed: false, path: null, event: null, entries: 0 };
  const path = settingsPath(hooks, home);
  if (!(await exists(path))) return { supported: true, installed: false, path, event: hooks.event, entries: 0 };
  let settings;
  try {
    ({ settings } = await readSettings(path));
  } catch (error) {
    if (error instanceof TopologyError && error.code === "TOPOLOGY_STARTUP_HOOKS") {
      return { supported: true, installed: false, path, event: hooks.event, entries: 0, readable: false, error: error.message };
    }
    throw error;
  }
  const entries = settings.hooks && typeof settings.hooks === "object" && Array.isArray(settings.hooks[hooks.event]) ? settings.hooks[hooks.event] : [];
  const ours = entries.filter(isOurs).length;
  return { supported: true, installed: ours > 0, path, event: hooks.event, entries: ours };
}

// ---------------------------------------------------------------------------------------------
// The check itself

const SIX = ["serverKey", "serverPid", "sessionId", "sessionCreated", "paneId", "panePid"];
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function pendingKey(repoId, incarnation, session) { return digest([repoId, ...SIX.map(k => incarnation?.[k] ?? null), incarnation ? null : session]); }
async function registeredSessions(root, repoId) {
  const records = [];
  for (const kind of ["leads", "reviewers"]) {
    for (const entry of await readdir(join(root, kind)).catch(() => [])) {
      if (!entry.endsWith(".json")) continue;
      try { const record = JSON.parse(await readFile(join(root, kind, entry), "utf8")); if (record.repo_id === repoId) records.push(record); } catch {}
    }
  }
  return records;
}
function matches(record, session, incarnation) {
  if (!incarnation) return record.session === session;
  const observed = record.incarnation ?? record.pane_identity ?? record.binding;
  return observed && SIX.every(k => observed[k] === incarnation[k]);
}
async function defaultReadiness({consumer,env,home,repoId}) {
  if (env.AO_LEAD_ID && env.AO_AGENT_ID === env.AO_LEAD_ID) return {state:'self',message:'Lead startup does not recursively create another lead.'};
  const {readLeadRegistration,leadState}=await import('./lead.mjs');
  const registration=await readLeadRegistration({consumer,env,home});
  if(!registration) return {state:'offer',repo_id:repoId,command:'ao-topology lead ensure --consumer '+shellQuote(consumer),message:'Create a dedicated lead (recommended) or use lead assign with an existing session; no enrollment has been assumed.'};
  const {reviewerAvailability}=await import('./reviewer.mjs');
  // TM-161: 0 means "answer from proof already on disk". This runs on a SessionStart hook for every
  // Claude session on the machine, so it cannot wait for a model turn — and a 1000ms probe, which is
  // what it used to pass, is worse than none: nobody can answer inside it, and its expiry then makes
  // a busy lead's next-boundary ack read as STALE rather than LATE.
  const lead=await leadState({consumer,env,home,ackTimeoutMs:0});
  const reviewer=await reviewerAvailability({consumer,env,home});
  return {state:lead.status==='responsive' && reviewer.available?'ready':'blocked',lead:lead.status,reviewer:reviewer.available?'ready':'unavailable',message:'Governed work requires responsive lead and independent reviewer; existing work is preserved.'};
}
export async function startupCheck({ consumer, source, agentId, session, pane, incarnation, env = process.env, home, readinessFn } = {}) {
  invariant(consumer && typeof consumer === "string", "TOPOLOGY_STARTUP_CHECK", "startupCheck needs a consumer path to identify the repository.");
  invariant(source && typeof source === "string", "TOPOLOGY_STARTUP_CHECK", "startupCheck needs a source.");
  const identity = await canonicalRepoId(consumer);
  // TM-167: the caller's own server, named from $TMUX — never the implicit one.
  const callerSocket = tmuxApi.callerServer(env);
  if (!incarnation && callerSocket && (pane || env.TMUX_PANE)) {
    const observed = (await tmuxApi.listServerPanes({ tmuxServer: callerSocket, env })).find(p => p.paneId === (pane ?? env.TMUX_PANE));
    if (observed) { incarnation = Object.fromEntries(SIX.map(k => [k, observed[k]])); session = observed.sessionName; pane = observed.paneId; }
  }
  const root = stateRoot(env, home ?? homedir());
  const records = await registeredSessions(root, identity.id);
  const registered = records.some(record => matches(record, session, incarnation));
  const readiness = source === "watcher" ? { state: "eventual" } : readinessFn
    ? await readinessFn({ consumer, env, home })
    : await defaultReadiness({consumer,env,home,repoId:identity.id});
  const journalDir = join(root, "startup");
  await mkdir(journalDir, { recursive: true });
  await appendFile(join(journalDir, `${repoKey(identity.id)}.jsonl`), `${JSON.stringify({ at: nowIso(), source, agentId: agentId ?? null, session: session ?? null, consumer, readiness })}\n`, "utf8");
  let labelled = false;
  if (session && !registered) {
    const key = pendingKey(identity.id, incarnation, session);
    const dir = join(root, "enrollments", "pending");
    await mkdir(dir, { recursive: true });
    await withLock(join(dir, `${key}.lock`), async () => {
      const path = join(dir, `${key}.json`);
      if (!(await exists(path))) await atomicJson(path, { key, repo_id: identity.id, incarnation: incarnation ?? null, session, pane: pane ?? incarnation?.paneId ?? null, consumer, source, detected_at: nowIso(), label: "pending-enrollment", note: PENDING_NOTE, readiness });
    });
    labelled = true;
  }
  // TM-167: a session starting in an ENROLLED repository is a qualifying activation, so the hook and
  // the managed-launch paths start the canonical supervisor. activateRepository is a no-op for an
  // unenrolled one and never throws. The watcher does not activate: it runs inside a supervisor.
  if (source === "watcher") return { registered, labelled, readiness };
  const { activateRepository } = await import("./repo-enrollment.mjs");
  const activation = await activateRepository({ consumer, env, home: home ?? homedir(), reason: "session-start" });
  return { registered, labelled, readiness, activation };
}
export function afterSessionOpen(args = {}) { return startupCheck({ ...args, source: "managed-launch" }); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; } }
/** Eventual direct-start detection, based on provider process and cwd, never display names. */
export async function watchServer({ env = process.env, home, once = false, intervalMs = 5000, listPanesFn, listSessionsFn, tmuxServer = "default", ownerAliveFn = alive, repoId = null } = {}) {
  invariant(Number.isFinite(intervalMs) && intervalMs > 0, "TOPOLOGY_STARTUP_WATCH", "watchServer intervalMs must be positive.");
  // TM-167: a per-repository supervisor passes `repoId`, and then labels and journals ONLY panes whose
  // canonical repository is that one. The listing is still server-wide — that is how the panes are
  // found — but another repository's session is never written about. The lease is per (server, repo)
  // so each enrolled repository's supervisor watches its own panes instead of one repo winning the
  // server. `startup watch` passes no repoId and keeps the host-wide behaviour.
  // ponytail: cwd -> repository is cached for the watcher's lifetime; a directory that becomes a git
  // repository later is seen under its old identity until the supervisor restarts.
  const repoOf = new Map();
  const inRepo = async (cwd) => {
    if (!repoId) return true;
    if (!repoOf.has(cwd)) repoOf.set(cwd, (await canonicalRepoId(cwd).catch(() => null))?.id ?? null);
    return repoOf.get(cwd) === repoId;
  };
  const root = stateRoot(env, home ?? homedir());
  const list = listPanesFn ?? listSessionsFn ?? tmuxApi.listServerPanes;
  invariant(typeof list === "function", "TOPOLOGY_STARTUP_WATCH", "tmux pane enumeration is unavailable.");
  const initial = await list({ tmuxServer, env });
  const server = initial.find(p => p.serverKey && Number.isFinite(p.serverPid));
  if (!server) return { acquired: false, server: tmuxServer, labelled: [], reason: "no-observed-server" };
  const leasePath = join(root, "watchers", `${digest(repoId ? [server.serverKey, server.serverPid, repoId] : [server.serverKey, server.serverPid])}.json`);
  await mkdir(dirname(leasePath), { recursive: true });
  const readLease = () => readFile(leasePath, "utf8").then(JSON.parse).catch(e => { if(e.code === "ENOENT") return null; throw e; });
  const taken = await withLock(`${leasePath}.lock`, async () => {
    const old = await readLease();
    if (old && await ownerAliveFn(old.pid)) return null;
    const lease = { pid: process.pid, owner: randomUUID(), server: tmuxServer, serverKey: server.serverKey, serverPid: server.serverPid, started_at: nowIso(), heartbeat_at: nowIso() };
    await atomicJson(leasePath, lease); return lease;
  });
  if (!taken) return { acquired: false, server: tmuxServer, labelled: [] };
  const labelled = [];
  do {
    const panes = await list({ tmuxServer, env });
    const candidates = [];
    for (const observed of panes) {
      if (!observed) continue;
      if (observed.serverKey !== server.serverKey || observed.serverPid !== server.serverPid) return { acquired: true, fenced: true, server: tmuxServer, labelled };
      if (!observed || observed.alive === false || !["kimi", "codex", "claude", "grok"].includes(basename(observed.command ?? "")) || !observed.cwd) continue;
      if (!SIX.every(k => observed[k] !== undefined && observed[k] !== null)) continue;
      if (!(await inRepo(observed.cwd))) continue;
      candidates.push(observed);
    }
    const owned = await withLock(`${leasePath}.lock`, async () => {
      if ((await readLease())?.owner !== taken.owner) return false;
      for (const observed of candidates) {
        const result = await startupCheck({ consumer: observed.cwd, session: observed.sessionName ?? observed.session ?? observed.name, pane: observed.paneId, incarnation: Object.fromEntries(SIX.map(k => [k, observed[k]])), source: "watcher", env, home });
        if (result.labelled) labelled.push(observed.sessionName ?? observed.session ?? observed.name);
      }
      taken.heartbeat_at = nowIso(); await atomicJson(leasePath, taken); return true;
    });
    if (!owned) return { acquired: true, fenced: true, server: tmuxServer, labelled };
    if (!once) await sleep(intervalMs);
  } while (!once);
  return { acquired: true, server: tmuxServer, labelled };
}

/** Every pending-enrollment label, oldest detection first. */
export async function pendingEnrollments({ env = process.env, home } = {}) {
  const root = stateRoot(env, home ?? homedir());
  const dir = join(root, "enrollments", "pending");
  const entries = await readdir(dir).catch(() => []);
  const records = [];
  for (const entry of entries.filter((name) => name.endsWith(".json"))) {
    try {
      const record = JSON.parse(await readFile(join(dir, entry), "utf8"));
      if (record && typeof record === "object") records.push(record);
    } catch {
      /* an unreadable label is skipped, not fatal */
    }
  }
  records.sort((a, b) => String(a.detected_at ?? "").localeCompare(String(b.detected_at ?? "")));
  return records;
}

/** Remove one session's pending label. Returns true when a label was actually cleared. */
export async function clearPendingEnrollment({ env = process.env, home, session, key, consumer, incarnation } = {}) {
  invariant(key || session, "TOPOLOGY_STARTUP_CHECK", "clearPendingEnrollment needs an exact key or session.");
  const root = stateRoot(env, home ?? homedir());
  const repoId = consumer ? (await canonicalRepoId(consumer)).id : null;
  const records = (await pendingEnrollments({ env, home })).filter(r => key ? r.key === key : r.session === session && (!repoId || r.repo_id === repoId) && (!incarnation || SIX.every(k => r.incarnation?.[k] === incarnation[k])));
  invariant(records.length <= 1, "TOPOLOGY_STARTUP_CHECK", "Multiple pending incarnations match; supply the exact pending key.");
  if (!records.length) return false;
  await rm(join(root, "enrollments", "pending", `${records[0].key}.json`)); return true;
}
