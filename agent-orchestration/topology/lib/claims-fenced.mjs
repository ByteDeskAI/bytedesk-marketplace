// Fenced claims over ORCH_CLAIMS. The token is the KV revision; every later write presents it and a
// stale one is refused, so a worker that stalled past its expiry cannot overwrite the worker that
// took over. `now` is injectable so expiry is testable without sleeping.
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

const DEFAULT_TTL_MS = 5 * 60_000;

/** Take a free or expired claim. Returns { won, token, owner, expiresAt } — a loss names the live owner. */
export async function claimFenced({ transport, repo, task, owner, ttlMs = DEFAULT_TTL_MS, now = Date.now(), extra = {} }) {
  const body = { ...extra, owner, claimed_at: new Date(now).toISOString(), expires_at: new Date(now + ttlMs).toISOString() };
  const entry = await transport.getClaimEntry({ repo, task });
  if (entry && Date.parse(entry.body.expires_at) > now && entry.body.owner !== owner) {
    return { won: false, owner: entry.body.owner, expiresAt: entry.body.expires_at, token: null };
  }
  try {
    const result = await transport.compareAndSetClaim({ repo, task, body, expectedRevision: entry?.revision ?? 0 });
    return { won: true, owner, expiresAt: body.expires_at, token: { revision: result.revision } };
  } catch (error) {
    if (error.code !== 'TOPOLOGY_CLAIM_CONFLICT') throw error;
    const now2 = await transport.getClaimEntry({ repo, task });
    return { won: false, owner: now2?.body?.owner ?? null, expiresAt: now2?.body?.expires_at ?? null, token: null };
  }
}

/** A write by the claim holder. Stale token -> TOPOLOGY_CLAIM_FENCED naming the current owner. Returns the new token. */
export async function writeFenced({ transport, repo, task, token, owner, patch = {}, ttlMs = DEFAULT_TTL_MS, now = Date.now() }) {
  if (!token || !Number.isInteger(token.revision)) fail('TOPOLOGY_CLAIM_FENCED', `A write to claim ${task} must present the claim revision it was granted.`);
  const entry = await transport.getClaimEntry({ repo, task });
  const body = { ...(entry?.body ?? {}), ...patch, owner, expires_at: new Date(now + ttlMs).toISOString() };
  try {
    const result = await transport.compareAndSetClaim({ repo, task, body, expectedRevision: token.revision });
    return { revision: result.revision };
  } catch (error) {
    if (error.code !== 'TOPOLOGY_CLAIM_CONFLICT') throw error;
    const current = await transport.getClaimEntry({ repo, task });
    fail('TOPOLOGY_CLAIM_FENCED', `Write to claim ${task} refused: revision ${token.revision} is stale; ${current?.body?.owner ?? 'another worker'} holds revision ${current?.revision}.`);
  }
}
