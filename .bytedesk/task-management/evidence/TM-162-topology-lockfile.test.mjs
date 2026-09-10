import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { lockHeld, lockOwner, processIdentity, withLock } from "../../topology/lib/lockfile.mjs";
import { TopologyError } from "../../topology/lib/util.mjs";

const scratch = () => mkdtemp(join(tmpdir(), "ao-lock-"));

test("the admitted holder receives the exact durable owner identity", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "identity.lock");
  await withLock(lock, async (ownership) => {
    assert.deepEqual(ownership, await lockOwner(lock));
    assert.equal(ownership.pid, process.pid);
    assert.equal(ownership.process_identity, await processIdentity(process.pid));
    assert.ok(ownership.token);
  });
});

test("concurrent holders serialize: exactly one critical section runs at a time", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "creation.lock");
  let inside = 0;
  let maxInside = 0;
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      withLock(lock, async () => {
        inside += 1;
        maxInside = Math.max(maxInside, inside);
        await new Promise((resolve) => setTimeout(resolve, 20));
        inside -= 1;
        return i;
      }, { timeoutMs: 10_000, pollMs: 5 })),
  );
  assert.equal(results.length, 8);
  assert.equal(maxInside, 1, "two creations must never overlap — this is the one-lead race");
  assert.equal(await lockHeld(lock), false, "the lock is released afterwards");
});

test("a live holder outlasting the timeout is an error, never a broken lock", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "held.lock");
  const release = await withLock(lock, async () => {
    await assert.rejects(
      withLock(lock, async () => "should never run", { timeoutMs: 150, staleMs: 60_000, pollMs: 10 }),
      (error) => error instanceof TopologyError && error.code === "TOPOLOGY_LOCK_TIMEOUT",
    );
    return "done";
  });
  assert.equal(release, "done");
});

test("a stale lock from a dead holder is broken and retaken", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "stale.lock");
  // Simulate the crash: directory exists, owner record old (or missing, as a crash between mkdir
  // and the owner write leaves it).
  await mkdir(lock);
  await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: 2147483647, token: "dead-owner", created_at: new Date(Date.now() - 600_000).toISOString() }), "utf8");
  const value = await withLock(lock, async () => "retaken", { timeoutMs: 1000, staleMs: 1000, pollMs: 10 });
  assert.equal(value, "retaken");

  // Unknown ownership is never proof of death, regardless of age.
  await mkdir(join(root, "ownerless.lock"));
  await assert.rejects(withLock(join(root, "ownerless.lock"), async () => "wrong", { timeoutMs: 50, staleMs: 1, pollMs: 5 }), { code: "TOPOLOGY_LOCK_TIMEOUT" });
});

test("a failing body still releases the lock", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "failing.lock");
  await assert.rejects(withLock(lock, async () => { throw new Error("boom"); }));
  assert.equal(await lockHeld(lock), false);
  assert.equal(await withLock(lock, async () => "fine"), "fine");
});

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test("creator paused before owner write cannot be evicted", async t => {
  const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "nested", "lock");
  const entered = deferred(), proceed = deferred();
  const holder = withLock(lock, async () => "creator", { hooks: { afterMkdir: async () => { entered.resolve(); await proceed.promise; } } });
  await entered.promise;
  await assert.rejects(withLock(lock, () => assert.fail("overlap"), { timeoutMs: 60, staleMs: 1, pollMs: 5 }), { code: "TOPOLOGY_LOCK_TIMEOUT" });
  assert.equal(await lockHeld(lock), true); proceed.resolve(); assert.equal(await holder, "creator");
});

test("live holder survives stale age and malformed record respects deadline", async t => {
  const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true })); const lock = join(root, "lock");
  await withLock(lock, async () => {
    await assert.rejects(withLock(lock, () => assert.fail("overlap"), { timeoutMs: 70, staleMs: 1, pollMs: 5 }), { code: "TOPOLOGY_LOCK_TIMEOUT" });
  });
  await mkdir(lock); await writeFile(join(lock, "owner.json"), "{broken");
  const start = Date.now();
  await assert.rejects(withLock(lock, () => assert.fail("corrupt owner evicted"), { timeoutMs: 60, staleMs: 1, pollMs: 5 }), { code: "TOPOLOGY_LOCK_TIMEOUT" });
  assert.ok(Date.now() - start < 1000);
});

test("old holder release preserves externally replaced successor", async t => {
  const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true })); const lock = join(root, "lock");
  const successorEntered = deferred(), successorRelease = deferred(); let successor;
  await withLock(lock, async () => {
    await rm(lock, { recursive: true });
    successor = withLock(lock, async () => { successorEntered.resolve(); await successorRelease.promise; });
    await successorEntered.promise;
  });
  assert.equal(await lockHeld(lock), true); successorRelease.resolve(); await successor;
});

test("delayed dead-owner reclaimer cannot delete a successor", async t => {
  const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true })); const lock = join(root, "lock");
  await mkdir(lock); await writeFile(join(lock, "owner.json"), JSON.stringify({ token: "dead", pid: 2147483647 }));
  const observed = deferred(), resume = deferred(), acquired = deferred(), release = deferred();
  const late = withLock(lock, () => "late", { timeoutMs: 2000, pollMs: 5, hooks: { beforeReclaim: async () => { observed.resolve(); await resume.promise; } } });
  await observed.promise;
  const winner = withLock(lock, async () => { acquired.resolve(); await release.promise; }, { pollMs: 5 });
  await acquired.promise; resume.resolve();
  await assert.rejects(withLock(lock, () => assert.fail("successor lost"), { timeoutMs: 60, pollMs: 5 }), { code: "TOPOLOGY_LOCK_TIMEOUT" });
  release.resolve(); await winner; assert.equal(await late, "late");
});
