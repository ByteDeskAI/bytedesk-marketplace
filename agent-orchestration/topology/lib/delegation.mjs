// Standing delegation of integration authority (TM-234). An operator grants a lead agent the
// authority `manage integrate` / `manage record-landing` otherwise require via an explicit
// --authorized flag, so the lead does not have to attest to authority it grants itself. Records
// are append-only: grant and revoke are separate events, folded into current status on read.
//
// ASSURANCE LIMIT, stated plainly: grants must come through an interactive terminal with a typed
// confirmation, from a shell carrying no agent marker and not sitting in a registered agent pane,
// and every event is HMAC-signed with a mode-600 key. That stops an agent that runs the command
// the ordinary way, and a hand-appended or edited record. It does NOT stop a deliberate agent
// running as the same OS user: it can unset the markers, drive a pseudo-terminal, and read the
// key. Every grant records this as `assurance`. Excluding a same-user agent needs a channel it
// cannot reach (a different uid, or the session host's capability channel), which is not built here.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { withLock } from './lockfile.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { fail, invariant, nowIso, parseDuration, readJson, writeJson } from './util.mjs';

/** Never deploy, publish, push or spend: those keep their own separate authorization. */
export const DELEGATION_SCOPES = Object.freeze(['integrate', 'record-landing']);
export const GRANT_CHANNEL = 'interactive-tty';
export const GRANT_ASSURANCE = 'interactive-tty-confirmed; same-OS-user agent NOT excluded (it can unset markers, drive a pty and read the signing key)';

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

/** Refuse any caller that carries an agent marker or sits in a registered agent pane. */
async function requireNoAgentSession(env, home, verb) {
  const markers = agentMarkers(env);
  invariant(!markers.length, 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', `Only the operator can ${verb} standing authority; refusing because agent-session markers are set: ${markers.join(', ')}.`);
  const pane = await registeredAgentPane(env, home);
  invariant(!pane, 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', `Only the operator can ${verb} standing authority; refusing because ${env.TMUX_PANE} is registered to agent ${pane}.`);
}

const defaultIo = {
  isTTY: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  async ask(question) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try { return await rl.question(question); } finally { rl.close(); }
  },
};

async function delegationsFile(consumer, env, home) {
  const identity = await canonicalRepoId(consumer);
  const dir = join(stateRoot(env, home), 'delegations');
  return { identity, path: join(dir, `${repoKey(identity.id)}.json`), keyPath: join(dir, '.grant-key') };
}
const loadEvents = path => readJson(path).catch(error => { if (error.code === 'ENOENT') return []; throw error; });

/** The HMAC key: created mode 600 on first grant; refused when missing or readable by group/others. */
async function signingKey(keyPath, { create }) {
  const text = await readFile(keyPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (text === null) {
    invariant(create, 'TOPOLOGY_DELEGATION_INTEGRITY', `Delegation records exist but the signing key ${keyPath} is missing; refusing them.`);
    await mkdir(dirname(keyPath), { recursive: true });
    const key = randomBytes(32).toString('hex');
    await writeFile(keyPath, key, { mode: 0o600, flag: 'wx' });
    return key;
  }
  if (process.platform !== 'win32') {
    const mode = (await stat(keyPath)).mode & 0o777;
    invariant(!(mode & 0o077), 'TOPOLOGY_DELEGATION_INTEGRITY', `Signing key ${keyPath} is readable by group or others (mode ${mode.toString(8)}); chmod 600 it.`);
  }
  return text.trim();
}

const macOf = (key, event) => { const { mac, ...body } = event; return createHmac('sha256', key).update(JSON.stringify(body)).digest('hex'); };
const sign = (key, event) => ({ ...event, mac: macOf(key, event) });

/** Why an event cannot be trusted, or null. Grants also need the interactive-channel evidence. */
function eventProblem(key, event) {
  const mac = typeof event?.mac === 'string' ? Buffer.from(event.mac, 'hex') : Buffer.alloc(0);
  const want = Buffer.from(macOf(key, event), 'hex');
  if (mac.length !== want.length || !timingSafeEqual(mac, want)) return 'a missing or invalid signature';
  const c = event.channel;
  if (event.type === 'grant' && (c?.kind !== GRANT_CHANNEL || c.stdin_tty !== true || c.stdout_tty !== true || !c.confirmation)) return 'no interactive-channel evidence';
  return null;
}

/** Events plus the key, refused outright if ANY event is unsigned, tampered or lacks evidence. */
async function verifiedEvents(consumer, env, home) {
  const { path, keyPath } = await delegationsFile(consumer, env, home);
  const events = await loadEvents(path);
  if (!events.length) return { events, path, keyPath, key: null };
  const key = await signingKey(keyPath, { create: false });
  for (const event of events) {
    const problem = eventProblem(key, event);
    if (problem) fail('TOPOLOGY_DELEGATION_INTEGRITY', `Refusing delegations file ${path}: event ${event?.id} has ${problem}.`);
  }
  return { events, path, keyPath, key };
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
  await requireNoAgentSession(env, home, 'grant');
  invariant(io.isTTY(), 'TOPOLOGY_DELEGATION_TTY', 'grant must be run at an interactive terminal (stdin and stdout both a TTY); it cannot be piped or scripted.');
  const expected = `${grantee} ${scopeList.join(',')}`;
  const typed = String(await io.ask(`Grant standing ${scopeList.join(', ')} authority to ${grantee}.\nThis cannot stop an agent running as your OS user from forging a grant.\nType "${expected}" to confirm: `) ?? '').trim();
  invariant(typed === expected, 'TOPOLOGY_DELEGATION_CONFIRM', `Confirmation did not match "${expected}"; nothing was granted.`);
  const expiresAt = expires ? new Date(Date.now() + parseDuration(expires)).toISOString() : null;
  const { identity, path, keyPath } = await delegationsFile(consumer, env, home);
  return withLock(`${path}.lock`, async () => {
    const { events } = await verifiedEvents(consumer, env, home);
    const key = await signingKey(keyPath, { create: true });
    const grant = sign(key, { id: randomUUID(), type: 'grant', grantor: osUser(env), grantee, repo_id: identity.id, scopes: scopeList,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null, created_at: nowIso(), expires_at: expiresAt,
      channel: { kind: GRANT_CHANNEL, stdin_tty: true, stdout_tty: true, agent_markers_checked: [...AGENT_MARKERS, ...AGENT_MARKER_PREFIXES.map(p => `${p}*`)],
        tmux_pane: env.TMUX_PANE || null, registered_agent_pane: false, confirmation: typed },
      assurance: GRANT_ASSURANCE });
    await writeJson(path, [...events, grant]);
    return grant;
  });
}

export async function listStandingDelegations({ consumer, env = process.env, home = homedir() }) {
  return foldDelegations((await verifiedEvents(consumer, env, home)).events);
}

/** Run by the operator. Same marker and pane refusal as grant; no confirmation, since revoking only removes authority. */
export async function revokeDelegation({ consumer, id, env = process.env, home = homedir() }) {
  invariant(typeof id === 'string' && id.trim(), 'TOPOLOGY_DELEGATION_ID', 'revoke requires the delegation --id.');
  await requireNoAgentSession(env, home, 'revoke');
  const { path } = await delegationsFile(consumer, env, home);
  return withLock(`${path}.lock`, async () => {
    const { events, key } = await verifiedEvents(consumer, env, home);
    const grant = foldDelegations(events).find(g => g.id === id.trim());
    invariant(grant, 'TOPOLOGY_DELEGATION_UNKNOWN', `No delegation ${id} exists for this repository.`);
    invariant(!grant.revoked_at, 'TOPOLOGY_DELEGATION_REVOKED', `Delegation ${id} is already revoked.`);
    await writeJson(path, [...events, sign(key, { id: randomUUID(), type: 'revoke', grant_id: grant.id, revoked_by: osUser(env), at: nowIso() })]);
    return { revoked: true, id: grant.id };
  });
}

/** Read-only lookup `manage integrate` / `manage record-landing` use in place of an explicit
 * --authorized: a live grant covering this exact caller, repository and scope. A delegations file
 * holding any unsigned, tampered or evidence-less event is refused outright, not skipped. */
export async function findActiveDelegation({ consumer, agentId, scope, env = process.env, home = homedir(), now = Date.now() }) {
  if (!agentId) return null;
  const live = (await listStandingDelegations({ consumer, env, home }))
    .filter(g => g.grantee === agentId && g.scopes.includes(scope) && !g.revoked_at && (!g.expires_at || Date.parse(g.expires_at) > now))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return live[0] || null;
}
