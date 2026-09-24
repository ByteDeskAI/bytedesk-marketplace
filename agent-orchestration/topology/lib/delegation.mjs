// Standing delegation of integration authority (TM-234). An operator grants a lead agent the
// authority `manage integrate` / `manage record-landing` otherwise require via an explicit
// --authorized flag, so the lead does not have to attest to authority it grants itself. Records
// are append-only: grant and revoke are separate events, folded into current status on read.
import { randomUUID } from 'node:crypto';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { withLock } from './lockfile.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { invariant, nowIso, parseDuration, readJson, writeJson } from './util.mjs';

/** Never deploy, publish, push or spend: those keep their own separate authorization. */
export const DELEGATION_SCOPES = Object.freeze(['integrate', 'record-landing']);

const osUser = env => env.USER || env.LOGNAME || userInfo().username;
const cleanScopes = value => [...new Set((Array.isArray(value) ? value : String(value || '').split(',')).map(s => s.trim()).filter(Boolean))];

async function delegationsFile(consumer, env, home) {
  const identity = await canonicalRepoId(consumer);
  return { identity, path: join(stateRoot(env, home), 'delegations', `${repoKey(identity.id)}.json`) };
}
const loadEvents = path => readJson(path).catch(error => { if (error.code === 'ENOENT') return []; throw error; });

function foldDelegations(events) {
  const grants = new Map();
  for (const event of events) {
    if (event.type === 'grant') grants.set(event.id, { ...event, revoked_at: null, revoked_by: null });
    else if (event.type === 'revoke' && grants.has(event.grant_id)) Object.assign(grants.get(event.grant_id), { revoked_at: event.at, revoked_by: event.revoked_by });
  }
  return [...grants.values()];
}

/** Run by the operator only. Refuses a self-grant and refuses any managed agent session (one with
 * AO_AGENT_ID set) from granting at all — an agent attesting its own or a peer's standing authority
 * is exactly the self-approval this exists to remove. */
export async function grantDelegation({ consumer, to, scopes, expires, reason, env = process.env, home = homedir() }) {
  const grantee = typeof to === 'string' ? to.trim() : '';
  invariant(grantee, 'TOPOLOGY_DELEGATION_GRANTEE', 'grant requires --to <agent-id>.');
  invariant(!env.AO_AGENT_ID || env.AO_AGENT_ID !== grantee, 'TOPOLOGY_DELEGATION_SELF', 'A grantee cannot grant standing authority to itself.');
  invariant(!env.AO_AGENT_ID, 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', 'Only the operator can grant standing authority; refusing inside a managed agent session (AO_AGENT_ID is set).');
  const scopeList = cleanScopes(scopes);
  invariant(scopeList.length && scopeList.every(s => DELEGATION_SCOPES.includes(s)), 'TOPOLOGY_DELEGATION_SCOPE', `--scope must be one or more of: ${DELEGATION_SCOPES.join(', ')}.`);
  const expiresAt = expires ? new Date(Date.now() + parseDuration(expires)).toISOString() : null;
  const { identity, path } = await delegationsFile(consumer, env, home);
  const grant = { id: randomUUID(), type: 'grant', grantor: osUser(env), grantee, repo_id: identity.id, scopes: scopeList,
    reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null, created_at: nowIso(), expires_at: expiresAt };
  await withLock(`${path}.lock`, async () => writeJson(path, [...(await loadEvents(path)), grant]));
  return grant;
}

export async function listStandingDelegations({ consumer, env = process.env, home = homedir() }) {
  const { path } = await delegationsFile(consumer, env, home);
  return foldDelegations(await loadEvents(path));
}

/** Run by the operator only, same rule as grant. */
export async function revokeDelegation({ consumer, id, env = process.env, home = homedir() }) {
  invariant(typeof id === 'string' && id.trim(), 'TOPOLOGY_DELEGATION_ID', 'revoke requires the delegation --id.');
  invariant(!env.AO_AGENT_ID, 'TOPOLOGY_DELEGATION_OPERATOR_ONLY', 'Only the operator can revoke standing authority; refusing inside a managed agent session (AO_AGENT_ID is set).');
  const { path } = await delegationsFile(consumer, env, home);
  return withLock(`${path}.lock`, async () => {
    const events = await loadEvents(path);
    const grant = foldDelegations(events).find(g => g.id === id.trim());
    invariant(grant, 'TOPOLOGY_DELEGATION_UNKNOWN', `No delegation ${id} exists for this repository.`);
    invariant(!grant.revoked_at, 'TOPOLOGY_DELEGATION_REVOKED', `Delegation ${id} is already revoked.`);
    await writeJson(path, [...events, { id: randomUUID(), type: 'revoke', grant_id: grant.id, revoked_by: osUser(env), at: nowIso() }]);
    return { revoked: true, id: grant.id };
  });
}

/** Read-only lookup `manage integrate` / `manage record-landing` use in place of an explicit
 * --authorized: a live grant covering this exact caller, repository and scope. */
export async function findActiveDelegation({ consumer, agentId, scope, env = process.env, home = homedir(), now = Date.now() }) {
  if (!agentId) return null;
  const live = (await listStandingDelegations({ consumer, env, home }))
    .filter(g => g.grantee === agentId && g.scopes.includes(scope) && !g.revoked_at && (!g.expires_at || Date.parse(g.expires_at) > now))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return live[0] || null;
}
