// Standing delegation of integration authority (TM-234). An operator grants a lead agent the
// authority `manage integrate` / `manage record-landing` otherwise require via an explicit
// --authorized flag, so the lead does not have to attest to authority it grants itself. Records
// are append-only: grant and revoke are separate events, folded into current status on read.
//
// ASSURANCE LIMIT, stated plainly: a grant must come through an interactive terminal with a typed
// confirmation, from a shell carrying no agent marker, not sitting in a registered agent pane, and
// with no Claude Code or Codex process among its ancestors. That stops an agent running the command
// the ordinary way. It is NOT agent-proof against an agent running as the same OS user: it can unset
// the markers, start a detached shell, and drive a TTY through tmux or `script`. Every grant says so
// (channel.kind "interactive-same-user"). Stronger channels, a grant store owned by a different uid
// or the session host's capability channel, are future work and an operator decision.
import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { agentDirs, findLead, listAgents } from './agents.mjs';
import { readCensus } from './census.mjs';
import { withLock } from './lockfile.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { callerRunsInPane, resolveBinding, sameBinding } from './slots.mjs';
import { listServerPanes } from './tmux.mjs';
import { fail, invariant, nowIso, parseDuration, readJson, writeJson } from './util.mjs';

/** Never deploy, publish, push or spend: those keep their own separate authorization. */
export const DELEGATION_SCOPES = Object.freeze(['integrate', 'record-landing']);
export const GRANT_CHANNEL = 'interactive-same-user';
export const GRANT_NOTE = 'Not agent-proof: an agent running as the same OS user can unset the markers, leave the agent process tree and drive a TTY through tmux or `script`. Read this as "made through the interactive channel", not "proven operator".';
// A path segment or program name `claude`/`codex` (e.g. ~/.local/share/claude/versions/2.1.280, codex-acp, codex.js).
const AGENT_PROCESS = /(^|\/)(claude|codex)([-_./]|$)/i;

const AGENT_MARKERS = ['AO_AGENT_ID', 'TM_SESSION_ID', 'TM_DISPATCH_WORKER', 'CLAUDECODE'];
/** TM-248: every current scope is plan-scoped, so a grant names a plan and expires within this. */
export const PLAN_MAX_MS = 14 * 86_400_000;
const AGENT_MARKER_PREFIXES = ['CLAUDE_CODE_', 'CODEX_'];

const osUser = env => env.USER || env.LOGNAME || userInfo().username;
const cleanScopes = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(s => s.trim()).filter(Boolean))];

/** Names of agent-session environment markers present in env. */
export function agentMarkers(env) {
  return Object.keys(env).filter(k => env[k] != null && env[k] !== '' && (AGENT_MARKERS.includes(k) || AGENT_MARKER_PREFIXES.some(p => k.startsWith(p)))).sort();
}

/** The agent id a census (any repository) binds to the caller's tmux pane, or null. */
async function registeredAgentPane(env, home) {
  if (!env.TMUX_PANE) return null;
  const serverKey = String(env.TMUX || '').split(',')[0] || null;
  const dir = join(stateRoot(env, home), 'census');
  for (const file of (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.json'))) {
    const doc = await readJson(join(dir, file)).catch(() => null);
    const hit = (doc?.agents || []).find(a => a.binding?.paneId === env.TMUX_PANE && (!serverKey || !a.binding.serverKey || a.binding.serverKey === serverKey));
    if (hit) return hit.agentId || 'unknown';
  }
  return null;
}

/** Names of the caller's ancestor processes (nearest first). Linux reads /proc; elsewhere `ps`. */
export async function ancestorProcesses(pid = process.pid) {
  const names = [];
  for (let i = 0; i < 64 && pid > 1; i++) {
    let ppid, name;
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      name = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
      ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      const argv0 = (await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '')).split('\0').filter(Boolean);
      name = [name, ...argv0.slice(0, 2)].join(' ');
    } catch {
      try { [ppid, name] = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+(.*)/); ppid = Number(ppid); }
      catch { break; }
    }
    if (i > 0) names.push(name);
    pid = ppid;
  }
  return names;
}

/** TM-248 + TM-243: the ONE managed-session test. Why the caller is a managed agent session, or []
 * for an operator shell: a Claude Code or Codex ancestor, an agent marker in env (AGENT_MARKERS and
 * AGENT_MARKER_PREFIXES), or, when `home` is given, a tmux pane a census binds to an agent. Grant,
 * revoke, `permissions install|uninstall` (via requireNoAgentSession) and the lead verbs share it. */
export async function managedSessionEvidence({ env = process.env, ancestors = ancestorProcesses, home = null } = {}) {
  const agentAncestor = (await ancestors()).find(n => n.split(' ').some(w => AGENT_PROCESS.test(w)));
  const markers = agentMarkers(env);
  const pane = home ? await registeredAgentPane(env, home) : null;
  return [...(agentAncestor ? [`an agent process is an ancestor: ${agentAncestor}`] : []),
    ...(markers.length ? [`agent-session markers are set: ${markers.join(', ')}`] : []),
    ...(pane ? [`${env.TMUX_PANE} is registered to agent ${pane}`] : [])];
}

/** Refuse any managed agent session (managedSessionEvidence, pane check included). Also the
 * operator gate for `permissions install|uninstall` (TM-243), which passes its own `what` and code. */
export async function requireNoAgentSession(env, home, verb, ancestors = defaultIo.ancestors, what = 'standing authority', code = 'TOPOLOGY_DELEGATION_OPERATOR_ONLY') {
  const evidence = await managedSessionEvidence({ env, ancestors, home });
  invariant(!evidence.length, code, `Only the operator can ${verb} ${what}; refusing because ${evidence[0]}.`);
}

const defaultIo = {
  ancestors: () => ancestorProcesses(),
  // The epic's task ids as the task store records them NOW; the grant freezes this list.
  async epicTasks(epic, consumer) { return (await (await import('./management.mjs')).taskStore({ consumer })).epicTasks(epic); },
  isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  async ask(question) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try { return await rl.question(question); } finally { rl.close(); }
  },
};

async function delegationsFile(consumer, env, home) {
  const identity = await canonicalRepoId(consumer);
  const dir = join(stateRoot(env, home), 'delegations');
  return { identity, path: join(dir, `${repoKey(identity.id)}.json`) };
}
const loadEvents = path => readJson(path).catch(error => { if (error.code === 'ENOENT') return []; throw error; });

/** Events, refused outright if any grant lacks the channel evidence (e.g. hand-written, or made by
 * round-1 code). This catches casual edits only; a same-user writer can copy the fields. */
async function verifiedEvents(consumer, env, home) {
  const { path } = await delegationsFile(consumer, env, home);
  const events = await loadEvents(path);
  for (const event of events) {
    const c = event?.channel;
    const ok = event?.type !== 'grant' || (c?.kind === GRANT_CHANNEL && c.stdin_tty === true && c.stdout_tty === true && c.no_agent_ancestor === true && c.confirmation);
    if (!ok) fail('TOPOLOGY_DELEGATION_INTEGRITY', `Refusing delegations file ${path}: grant ${event?.id} has no interactive-channel evidence.`);
    // TM-248: a frozen plan's digest must still match its task list.
    const plan = event?.type === 'grant' ? event.plan : null;
    if (plan?.sha256 != null && (!Array.isArray(plan.tasks) || planDigest(plan.tasks) !== plan.sha256)) fail('TOPOLOGY_DELEGATION_INTEGRITY', `Refusing delegations file ${path}: grant ${event.id} has a plan.sha256 that does not match its plan.tasks.`);
  }
  return { events, path };
}

function foldDelegations(events) {
  const grants = new Map();
  for (const event of events) {
    if (event.type === 'grant') grants.set(event.id, { ...event, revoked_at: null, revoked_by: null });
    else if (event.type === 'revoke' && grants.has(event.grant_id)) Object.assign(grants.get(event.grant_id), { revoked_at: event.at, revoked_by: event.revoked_by });
  }
  return [...grants.values()];
}

/** TM-248: sha256 over the sorted task ids, newline-joined. */
export const planDigest = tasks => createHash('sha256').update([...tasks].sort().join('\n')).digest('hex');
/** The approved plan, frozen: `--epic` resolves to the epic's task ids in the store at grant time,
 * joined with `--tasks`, sorted and digested. Coverage is membership in that list only, so a task
 * moved into or created under the epic later is not covered; it needs a new grant. */
async function frozenPlan(plan, consumer, epicTasks) {
  const epic = typeof plan?.epic === 'string' && plan.epic.trim() ? plan.epic.trim() : null;
  const listed = cleanScopes(plan?.tasks || []);
  invariant(epic || listed.length, 'TOPOLOGY_DELEGATION_PLAN', 'A grant is scoped to an approved plan: pass --epic <EP-nnn> and/or --tasks <TM-nnn,...>.');
  invariant(!epic || /^EP-[0-9]+$/.test(epic), 'TOPOLOGY_DELEGATION_PLAN', `--epic must be an epic id like EP-19, not ${epic}.`);
  invariant(listed.every(t => /^TM-[0-9]+$/.test(t)), 'TOPOLOGY_DELEGATION_PLAN', `--tasks must be task ids like TM-248, not ${listed.join(',')}.`);
  const members = epic ? cleanScopes(await epicTasks(epic, consumer)) : [];
  invariant(!epic || (members.length && members.every(t => /^TM-[0-9]+$/.test(t))), 'TOPOLOGY_DELEGATION_PLAN', `The task store lists no tasks under ${epic}; there is nothing to approve. Use the epic id exactly as the store writes it (e.g. EP-019).`);
  const tasks = [...new Set([...members, ...listed])].sort();
  // label: what the operator asked for, retyped in the confirmation.
  return { plan: { epic, tasks, sha256: planDigest(tasks) }, label: [epic, ...listed].filter(Boolean).join(',') };
}
const planLabel = plan => plan.epic ? `${plan.epic}${plan.sha256 ? ` (${plan.tasks.join(',')})` : ' (no frozen list)'}` : (plan.tasks || []).join(',');
/** An epic grant from before the list was frozen (e357d4d): it covers nothing. */
const unfrozenEpic = plan => Boolean(plan?.epic) && !plan.sha256;
/** True only when the grant's recorded task list names the task. The task's current epic is never read. */
export const planCovers = (plan, task) => Boolean(plan && task?.id && !unfrozenEpic(plan) && plan.tasks?.includes(task.id));

/** Run by the operator at an interactive terminal. Refuses a self-grant, any caller carrying an
 * agent marker or sitting in a registered agent pane, a non-TTY caller, and a confirmation that
 * does not retype the grantee, scopes and plan exactly. See the ASSURANCE LIMIT at the top of the file. */
export async function grantDelegation({ consumer, to, scopes, plan, expires, reason, env = process.env, home = homedir(), io = defaultIo }) {
  const grantee = typeof to === 'string' ? to.trim() : '';
  invariant(grantee, 'TOPOLOGY_DELEGATION_GRANTEE', 'grant requires --to <agent-id>.');
  invariant((await listAgents(agentDirs({ consumer }))).some(a => a.id === grantee), 'TOPOLOGY_DELEGATION_GRANTEE', `--to ${grantee} names no agent registered in this repository (.bytedesk/agent-orchestration/agents/*/agent.json).`);
  invariant(env.AO_AGENT_ID !== grantee, 'TOPOLOGY_DELEGATION_SELF', 'A grantee cannot grant standing authority to itself.');
  const scopeList = cleanScopes(scopes);
  invariant(scopeList.length && scopeList.every(s => DELEGATION_SCOPES.includes(s)), 'TOPOLOGY_DELEGATION_SCOPE', `--scope must be one or more of: ${DELEGATION_SCOPES.join(', ')}.`);
  const { plan: scoped, label } = await frozenPlan(plan, consumer, io.epicTasks || defaultIo.epicTasks);
  // Days are the natural unit for a plan; everything else is the shared duration form (90s, 20m, 72h).
  const expiresMs = !expires || expires === true ? 0 : /^\d+(\.\d+)?d$/.test(String(expires).trim()) ? Math.round(parseFloat(expires) * 86_400_000) : parseDuration(expires);
  invariant(expiresMs > 0 && expiresMs <= PLAN_MAX_MS, 'TOPOLOGY_DELEGATION_EXPIRY', 'A plan grant needs --expires, at most 14d (e.g. 7d, 72h).');
  await requireNoAgentSession(env, home, 'grant', io.ancestors || defaultIo.ancestors);
  invariant(io.isTTY(), 'TOPOLOGY_DELEGATION_TTY', 'grant must be run at an interactive terminal (stdin and stdout both a TTY); it cannot be piped or scripted.');
  const expected = `${grantee} ${scopeList.join(',')} ${label}`;
  const listing = `The plan covers exactly these ${scoped.tasks.length} task(s), frozen now: ${scoped.tasks.join(', ')}.${scoped.epic ? ` A task added to ${scoped.epic} later is not covered; it needs a new grant.` : ''}`;
  const typed = String(await io.ask(`Grant standing ${scopeList.join(', ')} authority to ${grantee} for plan ${label}, expiring in ${expires}.\n${listing}\n${GRANT_NOTE}\nType "${expected}" to confirm: `) ?? '').trim();
  invariant(typed === expected, 'TOPOLOGY_DELEGATION_CONFIRM', `Confirmation did not match "${expected}"; nothing was granted.`);
  const expiresAt = new Date(Date.now() + expiresMs).toISOString();
  const { identity, path } = await delegationsFile(consumer, env, home);
  return withLock(`${path}.lock`, async () => {
    const { events } = await verifiedEvents(consumer, env, home);
    const grant = { id: randomUUID(), type: 'grant', grantor: osUser(env), grantee, repo_id: identity.id, scopes: scopeList, plan: scoped,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null, created_at: nowIso(), expires_at: expiresAt,
      channel: { kind: GRANT_CHANNEL, stdin_tty: true, stdout_tty: true, agent_markers_checked: [...AGENT_MARKERS, ...AGENT_MARKER_PREFIXES.map(p => `${p}*`)],
        no_agent_ancestor: true, tmux_pane: env.TMUX_PANE || null, registered_agent_pane: false, confirmation: typed,
        agent_proof: false, note: GRANT_NOTE } };
    await writeJson(path, [...events, grant]);
    return grant;
  });
}

export async function listStandingDelegations({ consumer, env = process.env, home = homedir() }) {
  return foldDelegations((await verifiedEvents(consumer, env, home)).events);
}

/** Run by the operator. Same marker and pane refusal as grant; no confirmation, since revoking only removes authority. */
export async function revokeDelegation({ consumer, id, env = process.env, home = homedir(), io = defaultIo }) {
  invariant(typeof id === 'string' && id.trim(), 'TOPOLOGY_DELEGATION_ID', 'revoke requires the delegation --id.');
  await requireNoAgentSession(env, home, 'revoke', io.ancestors || defaultIo.ancestors);
  const { path } = await delegationsFile(consumer, env, home);
  return withLock(`${path}.lock`, async () => {
    const { events } = await verifiedEvents(consumer, env, home);
    const grant = foldDelegations(events).find(g => g.id === id.trim());
    invariant(grant, 'TOPOLOGY_DELEGATION_UNKNOWN', `No delegation ${id} exists for this repository.`);
    invariant(!grant.revoked_at, 'TOPOLOGY_DELEGATION_REVOKED', `Delegation ${id} is already revoked.`);
    await writeJson(path, [...events, { id: randomUUID(), type: 'revoke', grant_id: grant.id, revoked_by: osUser(env), at: nowIso() }]);
    return { revoked: true, id: grant.id };
  });
}

/** Proof the caller IS the grantee, not merely claims to be. AO_AGENT_ID, TMUX and TMUX_PANE are all
 * set by the caller, so any same-user process could name the lead and the lead's pane. Three checks:
 * the caller's TMUX/TMUX_PANE resolve to a LIVE pane incarnation (the tmux six-tuple, as slot release
 * and enrollment check it); this repository's census binds that exact incarnation, including its
 * pane_pid, to the grantee; and the lead's pane process is an ancestor of the calling process
 * (callerRunsInPane), so setting env vars is not enough. Where /proc cannot be read it fails closed.
 * REMAINING LIMIT, same uid: ptrace or code injection into the lead's process tree, or a process
 * started by typing into the lead's own pane, is the lead as far as anything here can tell. */
export async function requireGranteeCaller({ consumer, grantee, env = process.env, home = homedir(), listPanesFn = listServerPanes, readCensusFn = readCensus, callerProc = {} }) {
  const here = await resolveBinding({ env, listPanesFn }).catch(() => null);
  invariant(here, 'TOPOLOGY_DELEGATION_ACTOR', `A standing delegation is exercised only from the grantee's own live tmux pane; ${env.TMUX_PANE || 'no pane'} is not a live pane incarnation, so the caller cannot be proven to be ${grantee}.`);
  const census = await readCensusFn({ consumer, env, home }).catch(() => null);
  const agents = census?.agents || [];
  const recorded = agents.find(a => a.agentId === grantee && a.binding?.paneId === here.paneId && a.binding?.serverKey === here.serverKey);
  invariant(!recorded || recorded.binding.panePid === here.panePid, 'TOPOLOGY_DELEGATION_ACTOR', `Pane ${here.paneId} now runs pane_pid ${here.panePid}, not the ${recorded?.binding?.panePid} the census recorded for ${grantee}; a different incarnation holds that pane.`);
  const bound = agents.find(a => sameBinding(here, a.binding));
  invariant(bound?.agentId === grantee, 'TOPOLOGY_DELEGATION_ACTOR', `Pane ${here.paneId} is bound to ${bound ? `agent ${bound.agentId}` : 'no agent in this repository\'s census'}, not to the grantee ${grantee}; AO_AGENT_ID alone does not prove identity.`);
  let inPane;
  try { inPane = await callerRunsInPane(here, callerProc); }
  catch (error) { fail('TOPOLOGY_DELEGATION_ACTOR', `Cannot prove the caller runs in the grantee's pane: process ancestry is unreadable (${error.code || error.message}); refusing rather than trusting TMUX_PANE.`); }
  invariant(inPane, 'TOPOLOGY_DELEGATION_ACTOR', `Cannot prove the caller runs in the grantee's pane: pane ${here.paneId}'s process ${here.panePid} is not an ancestor of this process; TMUX_PANE alone does not prove identity.`);
  return here;
}

/** TM-263 (ADR-0027): the caller proven to BE this repository's own lead (findLead over the
 * repository's agent directories), or null when the caller does not name that lead (no AO_AGENT_ID,
 * another agent, or no lead). A caller naming the lead must pass requireGranteeCaller's proof,
 * unchanged: its live pane is census-bound to the lead and the lead's pane process is its ancestor;
 * otherwise TOPOLOGY_DELEGATION_ACTOR. A dispatched worker is refused by name even in the lead's pane. */
export async function requireLeadCaller({ consumer, env = process.env, home = homedir(), listPanesFn = listServerPanes, readCensusFn = readCensus, callerProc = {} }) {
  const lead = await findLead(agentDirs({ consumer })).catch(() => null);
  if (!lead?.id || env.AO_AGENT_ID !== lead.id) return null;
  invariant(!env.TM_DISPATCH_WORKER, 'TOPOLOGY_DELEGATION_ACTOR', `A dispatched worker session (TM_DISPATCH_WORKER) is never the repository lead ${lead.id}.`);
  await requireGranteeCaller({ consumer, grantee: lead.id, env, home, listPanesFn, readCensusFn, callerProc });
  return lead.id;
}

/** TM-243: the agent this repository's census binds to the caller's live pane, or null. Lets a
 * governed verb run as a bare command (no `AO_AGENT_ID=` prefix, which defeats permission-rule
 * matching). It only NAMES the caller: a delegation is still proven by requireGranteeCaller. */
export async function bindingAgentId({ consumer, env = process.env, home = homedir(), listPanesFn = listServerPanes, readCensusFn = readCensus }) {
  if (!env.TMUX_PANE) return null;
  const here = await resolveBinding({ env, listPanesFn }).catch(() => null);
  if (!here) return null;
  const census = await readCensusFn({ consumer, env, home }).catch(() => null);
  return (census?.agents || []).find(a => sameBinding(here, a.binding))?.agentId || null;
}

/** Read-only lookup `manage integrate` / `manage record-landing` use in place of an explicit
 * --authorized: a live grant covering this exact caller, repository, scope and task (TM-248: the
 * task must be in the grant's frozen plan.tasks, else TOPOLOGY_DELEGATION_PLAN; a grant without a
 * plan, or an epic grant without a frozen list, covers nothing). A delegations file
 * holding any grant without channel evidence is refused outright, not skipped. A matching grant
 * counts only once requireGranteeCaller proves the caller is the grantee; otherwise it throws
 * TOPOLOGY_DELEGATION_ACTOR rather than silently falling back. */
export async function findActiveDelegation({ consumer, agentId, scope, task = null, env = process.env, home = homedir(), now = Date.now(), listPanesFn, readCensusFn, callerProc }) {
  if (!agentId) return null;
  const live = (await listStandingDelegations({ consumer, env, home }))
    .filter(g => g.grantee === agentId && g.scopes.includes(scope) && !g.revoked_at && (!g.expires_at || Date.parse(g.expires_at) > now))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (!live[0]) return null;
  await requireGranteeCaller({ consumer, grantee: live[0].grantee, env, home, listPanesFn, readCensusFn, callerProc });
  const covering = live.find(g => planCovers(g.plan, task));
  const stale = live.filter(g => unfrozenEpic(g.plan)).map(g => g.id);
  invariant(covering, 'TOPOLOGY_DELEGATION_PLAN', `No live ${scope} grant for ${agentId} covers ${task?.id || 'this task'}; its approved plan is ${live.map(g => g.plan ? planLabel(g.plan) : 'none').join(' / ')}.${stale.length ? ` Grant ${stale.join(', ')} names an epic without a frozen task list, so it covers nothing; ask the operator to re-grant it.` : ''}`);
  return covering;
}
