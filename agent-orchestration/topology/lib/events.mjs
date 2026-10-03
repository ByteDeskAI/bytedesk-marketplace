// ORCH_EVENTS mirror of the run journal (the journal file stays the local truth), and the two read-side
// diagnoses computed from it. Diagnoses are never stored: they are a function of the events plus a census.
import { canonicalRepoId, repoKey } from './repoid.mjs';
import { encode, decode } from './envelope.mjs';
import { orchName } from './orch-transport.mjs';

const repoByConsumer = new Map();
export async function repoKeyFor(consumer) {
  if (!repoByConsumer.has(consumer)) repoByConsumer.set(consumer, repoKey((await canonicalRepoId(consumer)).id));
  return repoByConsumer.get(consumer);
}

const MIRROR_TIMEOUT_MS = 1500;

/** Best effort: a NATS outage must never block or fail a journal write. Returns whether it published. */
export async function mirrorJournalEvent(transport, consumer, record) {
  if (!transport?.publishEvent || !consumer) return false;
  const kind = String(record.type ?? 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_');
  let timer;
  try {
    const repo = await repoKeyFor(consumer);
    const body = JSON.stringify(encode('ao/event', `${kind}.${record.ts}`, record, { actor: record.from ?? record.agent ?? null, agent: record.from ?? record.agent ?? null, ts: record.ts }));
    await Promise.race([transport.publishEvent({ repo, kind, body }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('event mirror timeout')), MIRROR_TIMEOUT_MS); })]);
    return true;
  } catch { return false; } finally { clearTimeout(timer); }
}

export async function readRepoEvents(transport, repo, { limit = 1000 } = {}) {
  const raw = await transport.readEvents({ repo: orchName(repo), limit });
  return raw.map((item) => ({ ...decode(JSON.parse(item.body)).data, seq: item.seq })).filter(Boolean);
}

/**
 * PARKED: an idle agent that still has mail it was sent and never answered or acknowledged.
 * DONE-UNSEEN: a reply that was recorded and that no waiter ever consumed (no later wait.satisfied
 * covering that message, and no message.acked for it).
 * `idleAgents` comes from the census; events alone cannot say an agent is idle.
 */
export function diagnose(events, { idleAgents = [] } = {}) {
  const idle = new Set(idleAgents);
  const owed = new Map(); // `${agent}|${id}` -> sent event
  const replied = new Map();
  const seen = new Set();
  for (const event of events) {
    if (event.type === 'message.sent') for (const to of event.to ?? []) owed.set(`${to}|${event.id}`, event);
    if (event.type === 'message.replied') { owed.delete(`${event.from}|${event.id}`); replied.set(event.id, event); }
    if (event.type === 'message.acked') { owed.delete(`${event.agent}|${event.id}`); seen.add(event.id); }
    if (event.type === 'wait.satisfied') {
      for (const id of replied.keys()) if (!event.message || event.message === id) seen.add(id);
    }
  }
  const parked = [...owed.entries()].filter(([key]) => idle.has(key.split('|')[0]))
    .map(([key, sent]) => ({ diagnosis: 'PARKED', agent: key.split('|')[0], id: sent.id, since: sent.ts }));
  const unseen = [...replied.values()].filter((reply) => !seen.has(reply.id))
    .map((reply) => ({ diagnosis: 'DONE-UNSEEN', agent: reply.from, id: reply.id, since: reply.ts }));
  return [...parked, ...unseen];
}
