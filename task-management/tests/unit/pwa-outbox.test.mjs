/**
 * The replay loop itself: queued writes go out oldest-first, a refusal from the
 * server sticks to the entry, and an unreachable server stops the drain without
 * losing anything.
 *
 * The outbox is a module singleton (api.ts hands writes to it from plain async
 * code), so each test works on the queue it leaves behind — hence the explicit
 * drain at the top of the ones that care.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as outbox from "../../dashboard/src/pwa/outbox.mjs";

const accept = async () => ({ ok: true, status: 200 });
const clear = async () => {
  for (const e of outbox.getQueue()) outbox.discardEntry(e.key);
};

test("queued writes replay in order, through the url they were queued against", async () => {
  await clear();
  outbox.queueWrite({ method: "POST", url: "/api/task/TM-001/comment", body: { text: "one" } });
  outbox.queueWrite({ method: "POST", url: "/api/task/TM-002/comment", body: { text: "two" } });

  const seen = [];
  await outbox.replay(async (entry) => {
    seen.push([entry.method, entry.url, entry.body.text]);
    return accept();
  });

  assert.deepEqual(seen, [
    ["POST", "/api/task/TM-001/comment", "one"],
    ["POST", "/api/task/TM-002/comment", "two"],
  ]);
  assert.equal(outbox.getQueue().length, 0, "accepted writes leave the queue");
});

test("a refused replay is surfaced, not dropped", async () => {
  await clear();
  outbox.queueWrite({ method: "POST", url: "/api/task/TM-001/transition", body: { status: "done" } });

  const refusals = [];
  await outbox.replay(
    async () => ({ ok: false, status: 409, error: "TM-001 has unmet acceptance criteria" }),
    (entry, result) => refusals.push([entry.taskId, result.error]),
  );

  assert.deepEqual(refusals, [["TM-001", "TM-001 has unmet acceptance criteria"]]);
  const [entry] = outbox.getQueue();
  assert.equal(entry.status, "failed");
  assert.equal(entry.code, 409);
  assert.equal(outbox.pendingByTask().get("TM-001").status, "failed");
});

test("a refused write is not retried until the user asks", async () => {
  let attempts = 0;
  await outbox.replay(async () => {
    attempts += 1;
    return accept();
  });
  assert.equal(attempts, 0, "the failed entry from the previous test stayed put");

  outbox.retryEntry(outbox.getQueue()[0].key);
  await outbox.replay(async () => {
    attempts += 1;
    return accept();
  });
  assert.equal(attempts, 1);
  assert.equal(outbox.getQueue().length, 0);
});

test("a server that is still down stops the drain with the queue intact", async () => {
  await clear();
  outbox.queueWrite({ method: "POST", url: "/api/task/TM-001/comment", body: { text: "one" } });
  outbox.queueWrite({ method: "POST", url: "/api/task/TM-002/comment", body: { text: "two" } });

  let attempts = 0;
  await outbox.replay(async () => {
    attempts += 1;
    return { offline: true };
  });

  assert.equal(attempts, 1, "one failed attempt is enough to know the server is gone");
  assert.equal(outbox.getQueue().length, 2);
  assert.deepEqual(
    outbox.getQueue().map((e) => e.status),
    ["queued", "queued"],
  );
});

test("subscribers see every change to the queue", async () => {
  await clear();
  const seen = [];
  const stop = outbox.subscribe((q) => seen.push(q.length));
  outbox.queueWrite({ method: "POST", url: "/api/task/TM-009/comment", body: { text: "x" } });
  await outbox.replay(accept);
  stop();
  assert.deepEqual(seen.slice(-2), [1, 0]);
});
