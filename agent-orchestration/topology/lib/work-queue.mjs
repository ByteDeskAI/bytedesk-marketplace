// ORCH_TASKS work queue: an idle agent pulls a ready item and takes it with a fenced claim.
// Winning acks the item. Losing naks it with a delay so it comes back after the owner's claim could
// have expired (the owner may have died) instead of spinning against a live owner.
import { claimFenced } from './claims-fenced.mjs';

/** Item body is JSON with a `task` id: { task: "TM-1", ...anything }. */
export async function publishWork({ transport, repo, task, messageId, extra = {} }) {
  return transport.publishReady({ repo, messageId: messageId ?? `${task}`, body: JSON.stringify({ ...extra, task }) });
}

/**
 * @returns { took:true, task, token, item } | { took:false, lost?:{task,owner}, empty?:true }
 * Tries up to `attempts` items before giving up, so one contested item does not hide the next.
 */
export async function takeWork({ transport, repo, worker, ttlMs, nakDelayMs = 5000, attempts = 5, timeoutMs = 200, now = Date.now }) {
  let lost = null;
  for (let i = 0; i < attempts; i += 1) {
    const message = await transport.pullReady({ repo, timeoutMs });
    if (!message) return lost ? { took: false, lost } : { took: false, empty: true };
    let item;
    try { item = JSON.parse(message.body); } catch { item = null; }
    if (!item?.task) { await message.ack(); continue; } // not a work item; drop it rather than redeliver forever
    const claim = await claimFenced({ transport, repo, task: item.task, owner: worker, ttlMs, now: now() });
    if (claim.won) { await message.ack(); return { took: true, task: item.task, token: claim.token, item }; }
    await message.nak(nakDelayMs);
    lost = { task: item.task, owner: claim.owner, naked: true };
  }
  return { took: false, lost };
}
