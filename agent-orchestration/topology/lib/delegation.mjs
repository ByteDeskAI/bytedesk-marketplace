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
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { withLock } from './lockfile.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { fail, invariant, nowIso, parseDuration, readJson, writeJson } from './util.mjs';

/** Never deploy, publish, push or spend: those keep their own separate authorization. */
export const DELEGATION_SCOPES = Object.freeze(['integrate', 'record-landing']);
export const GRANT_CHANNEL = 'interactive-same-user';
export const GRANT_NOTE = 'Not agent-proof: an agent running as the same OS user can unset the markers, leave the agent process tree and drive a TTY through tmux or `script`. Read this as "made through the interactive channel", not "proven operator".';
// A path segment or program name `claude`/`codex` (e.g. ~/.local/share/claude/versions/2.1.280, codex-acp, codex.js).
const AGENT_PROCESS = /(^|\/)(claude|codex)([-_./]|$)/i;

const AGENT_MARKERS = ['AO_AGENT_ID', 'TM_SESSION_ID', 'CLAUDECODE'];
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
async function ancestorProcesses(pid = process.pid) {
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

/** Refuse any caller that carries an agent marker or sits in a registered agent pane. */
async function requireNoAgentSession(env, home, verb, ancestors) {
  const agentAncestor = (await ancestors()).find(n => n.split(' ').some(w => AGENT_PROCESS.test(w)));
  invariant(!agentAncestor, 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', `Only the operator can ${verb} standing authority; refusing because an agent process is an ancestor: ${agentAncestor}.`);
  const markers = agentMarkers(env);
  invariant(!markers.length, 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', `Only the operator can ${verb} standing authority; refusing because agent-session markers are set: ${markers.join(', ')}.`);
  const pane = await registeredAgentPane(env, home);
  invariant(!pane, 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', `Only the operator can ${verb} standing authority; refusing because ${env.TMUX_PANE} is registered to agent ${pane}.`);
}

const defaultIo = {
  ancestors: () => ancestorProcesses(),
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

/** Run by the operator at an interactive terminal. Refuses a self-grant, any caller carrying an
 * agent marker or sitting in a registered agent pane, a non-TTY caller, and a confirmation that
 * does not retype the grantee and scopes exactly. See the ASSURANCE LIMIT at the top of the file. */
export async function grantDelegation({ consumer, to, scopes, expires, reason, env = process.env, home = homedir(), io = defaultIo }) {
  const grantee = typeof to === 'string' ? to.trim() : '';
  invariant(grantee, 'TOPOLOGY_DELEGATION_GRANTEE', 'grant requires --to <agent-id>.');
  invariant(env.AO_AGENT_ID !== grantee, 'TOPOLOGY_DELEGATION_SELF', 'A grantee cannot grant standing authority to itself.');
  const scopeList = cleanScopes(scopes);
  invariant(scopeList.length && scopeList.every(s => DELEGATION_SCOPES.includes(s)), 'TOPOLOGY_DELEGATION_SCOPE', `--scope must be one or more of: ${DELEGATION_SCOPES.join(', ')}.`);
  await requireNoAgentSession(env, home, 'grant', io.ancestors || defaultIo.ancestors);
  invariant(io.isTTY(), 'TOPOLOGY_DELEGATION_TTY', 'grant must be run at an interactive terminal (stdin and stdout both a TTY); it cannot be piped or scripted.');
  const expected = `${grantee} ${scopeList.join(',')}`;
  const typed = String(await io.ask(`Grant standing ${scopeList.join(', ')} authority to ${grantee}.\n${GRANT_NOTE}\nType "${expected}" to confirm: `) ?? '').trim();
  invariant(typed === expected, 'TOPOLOGY_DELEGATION_CONFIRM', `Confirmation did not match "${expected}"; nothing was granted.`);
  const expiresAt = expires ? new Date(Date.now() + parseDuration(expires)).toISOString() : null;
  const { identity, path } = await delegationsFile(consumer, env, home);
  return withLock(`${path}.lock`, async () => {
    const { events } = await verifiedEvents(consumer, env, home);
    const grant = { id: randomUUID(), type: 'grant', grantor: osUser(env), grantee, repo_id: identity.id, scopes: scopeList,
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

/** Read-only lookup `manage integrate` / `manage record-landing` use in place of an explicit
 * --authorized: a live grant covering this exact caller, repository and scope. A delegations file
 * holding any grant without channel evidence is refused outright, not skipped. */
export async function findActiveDelegation({ consumer, agentId, scope, env = process.env, home = homedir(), now = Date.now() }) {
  if (!agentId) return null;
  const live = (await listStandingDelegations({ consumer, env, home }))
    .filter(g => g.grantee === agentId && g.scopes.includes(scope) && !g.revoked_at && (!g.expires_at || Date.parse(g.expires_at) > now))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return live[0] || null;
}
