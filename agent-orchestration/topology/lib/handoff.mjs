// Idempotent closure-contract handoff (CONTRACT sections 1 and 6).
// Order: claim the id in ORCH_HANDOFFS (KV create, permanent) -> create the successor message ->
// close the source. Nats-Msg-Id only dedupes inside the stream window; the KV key is what makes a
// retry after the window (or after a crash between the two steps) safe.
import { encode, decode } from './envelope.mjs';
import { fail } from './util.mjs';

export const CLOSURE_REASONS = Object.freeze(['handed_off_to', 'blocked_on', 'denied', 'canceled', 'no-follow-on', 'escalation']);
const NEEDS_TARGET = new Set(['handed_off_to', 'blocked_on', 'denied']);


/**
 * @param send   async ({ body, to }) => { id, holds? }   creates the successor through sendMessage, so the
 *               delegation, hop-limit and route checks are the ones every other send uses.
 * @param probe  async ({ plannedId, to }) => boolean       true if a successor with that planned id is already in the stream.
 *               Used when a retry finds intent recorded but no successor id: the earlier attempt may have
 *               crashed between sending and recording, and the stream's Nats-Msg-Id window may be over.
 * @param close  async ({ body }) => void                 closes the source (records the reply that satisfies its waiter).
 * @returns { ok, duplicate, held, state, successorId, record }
 */
export async function handoff({ transport, repo, messageId, from, reason, to, note = null, extra = {}, send, close, probe = null }) {
  if (!CLOSURE_REASONS.includes(reason)) fail('TOPOLOGY_HANDOFF_REASON', `Closure reason must be one of ${CLOSURE_REASONS.join(', ')} (got ${JSON.stringify(reason)}).`);
  const target = NEEDS_TARGET.has(reason);
  if (target && !to) fail('TOPOLOGY_HANDOFF_TARGET', `Closure reason ${reason} needs a target (--to <agent>).`);
  const meta = { actor: from, agent: from };
  // Unknown fields in `extra` ride along verbatim; the known ones are written last so they cannot be overridden.
  // The planned successor id is fixed by the handoff id, so it is recorded as intent BEFORE any send and a
  // retry (even after the dedupe window) names the same message.
  const plannedId = `handoff-${messageId}`;
  const data = (state, successor_id = null) => ({ ...extra, message_id: messageId, reason, to: to ?? null, from, note, state, successor_id, planned_successor: target ? plannedId : null });
  const opening = encode('ao/handoff', messageId, data('opening'), meta);
  const created = await transport.createHandoff({ repo, messageId, body: JSON.stringify(opening) });
  let revision = created.revision;
  let current = created.created ? opening : JSON.parse(created.body);
  const decoded = decode(current);
  if (decoded.readOnly) fail('TOPOLOGY_HANDOFF_SCHEMA', `Handoff ${messageId} was written by a newer schema (${current.schema}); this build will not rewrite it.`);
  if (decoded.data.state === 'closed') {
    return { ok: true, duplicate: true, held: false, state: 'closed', successorId: decoded.data.successor_id, record: current };
  }
  // An interrupted earlier attempt (state "opening") resumes from what it recorded.
  const base = { ...decoded.data };
  let successorId = base.successor_id ?? null;
  if (target && !successorId) {
    // Intent exists but no successor id: an earlier attempt may have sent and died before recording it.
    const already = !created.created && probe ? await probe({ plannedId, to: base.to ?? to }) : false;
    const sent = already ? { id: plannedId, recovered: true } : await send({ body: JSON.stringify(current), to: base.to ?? to, plannedId });
    if (sent.holds?.length) {
      return { ok: false, duplicate: !created.created, held: true, state: 'opening', reason: sent.holds[0].reason, holds: sent.holds, record: current };
    }
    successorId = sent.id;
    const recorded = encode('ao/handoff', messageId, { ...base, successor_id: successorId }, meta);
    revision = (await transport.updateHandoff({ repo, messageId, body: JSON.stringify(recorded), expectedRevision: revision })).revision;
    current = recorded;
  }
  const closed = encode('ao/handoff', messageId, { ...base, state: 'closed', successor_id: successorId, closed_at: new Date().toISOString() }, meta);
  await close({ body: JSON.stringify(closed) });
  await transport.updateHandoff({ repo, messageId, body: JSON.stringify(closed), expectedRevision: revision });
  return { ok: true, duplicate: !created.created, held: false, state: 'closed', successorId, record: closed };
}
