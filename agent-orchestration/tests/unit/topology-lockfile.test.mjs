import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

  // TM-307: an EMPTY lock directory can only be a legacy orphan (pre-atomic admission) or an
  // old-version writer mid-acquire; the next acquirer takes it over without any age heuristic.
  await mkdir(join(root, "ownerless.lock"));
  assert.equal(await withLock(join(root, "ownerless.lock"), async () => "taken over", { timeoutMs: 500, pollMs: 5 }), "taken over");
  assert.equal(await lockHeld(join(root, "ownerless.lock")), false);
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

// TM-307: an acquirer stalled before its rename holds nothing, so it blocks nobody; one stalled
// after its rename is the genuine holder and is never evicted.
for (const step of ["pending", "owner"]) {
  test(`an acquirer stalled at "${step}" holds nothing and blocks nobody`, async t => {
    const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true }));
    const lock = join(root, "nested", "lock");
    const entered = deferred(), proceed = deferred();
    const stalled = withLock(lock, async () => "stalled", { pollMs: 5, hooks: { step: async (name) => { if (name === step && !entered.done) { entered.done = true; entered.resolve(); await proceed.promise; } } } });
    await entered.promise;
    assert.equal(await lockHeld(lock), false, "nothing is visible at lockPath before the rename");
    assert.equal(await withLock(lock, async () => "second", { timeoutMs: 500, pollMs: 5 }), "second");
    proceed.resolve(); assert.equal(await stalled, "stalled");
    assert.deepEqual((await readdir(join(root, "nested"))), [], "no lock, pending or retired sibling remains");
  });
}

test("an acquirer stalled after its rename is the holder and is never evicted", async t => {
  const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "lock");
  const entered = deferred(), proceed = deferred();
  const holder = withLock(lock, async () => "creator", { hooks: { step: async (name) => { if (name === "renamed") { entered.resolve(); await proceed.promise; } } } });
  await entered.promise;
  assert.equal((await lockOwner(lock))?.pid, process.pid, "lockPath appears already populated");
  await assert.rejects(withLock(lock, () => assert.fail("overlap"), { timeoutMs: 60, staleMs: 1, pollMs: 5 }), { code: "TOPOLOGY_LOCK_TIMEOUT" });
  proceed.resolve(); assert.equal(await holder, "creator");
});

test("a pending sibling left by a dead acquirer is swept; a live one is left alone", async t => {
  const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "lock");
  const dead = join(root, "lock.pending-dead00"), live = join(root, "lock.pending-live00");
  await mkdir(dead); await writeFile(join(dead, "owner.json"), JSON.stringify({ token: "d", pid: 2147483647 }));
  await mkdir(live); await writeFile(join(live, "owner.json"), JSON.stringify({ token: "l", pid: process.pid, process_identity: await processIdentity(process.pid) }));
  // The sweep runs on contention, so hold the lock while a second acquirer polls.
  await withLock(lock, async () => {
    await assert.rejects(withLock(lock, () => assert.fail("overlap"), { timeoutMs: 60, pollMs: 5 }), { code: "TOPOLOGY_LOCK_TIMEOUT" });
  });
  assert.deepEqual((await readdir(root)).sort(), ["lock.pending-live00"]);
});

// --- Real processes. Only PIDs this test spawned are ever signalled. ---
const LOCKFILE = new URL("../../topology/lib/lockfile.mjs", import.meta.url).href;
const child = (code, ...args) => spawn(process.execPath, ["--input-type=module", "-e", `import { withLock } from ${JSON.stringify(LOCKFILE)};\n${code}`, ...args], { stdio: ["ignore", "pipe", "inherit"] });
const exited = proc => new Promise(resolve => proc.once("exit", (code, signal) => resolve({ code, signal })));
const lineFrom = proc => new Promise((resolve, reject) => {
  let buffer = ""; proc.stdout.on("data", chunk => { buffer += chunk; if (buffer.includes("\n")) resolve(buffer.trim()); });
  proc.once("exit", () => reject(new Error(`child exited before signalling: ${buffer}`)));
});
async function assertNoOwnerless(lock) {
  if (await lockHeld(lock)) assert.ok(await lockOwner(lock), `ownerless lock directory left at ${lock}`);
}

for (const step of ["pending", "owner", "renamed"]) {
  test(`a child SIGKILLed at "${step}" never wedges the next acquirer`, async t => {
    const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true }));
    const lock = join(root, "lock");
    const proc = child(`await withLock(process.argv[1], async () => {}, { hooks: { step: async (name) => {
      if (name === process.argv[2]) { process.stdout.write("at " + name + "\\n"); await new Promise(() => {}); } } } });`, lock, step);
    assert.equal(await lineFrom(proc), `at ${step}`);
    const done = exited(proc); proc.kill("SIGKILL"); assert.equal((await done).signal, "SIGKILL");
    await assertNoOwnerless(lock);
    assert.equal(await withLock(lock, async () => "next", { timeoutMs: 2000, pollMs: 5 }), "next");
    assert.equal(await lockHeld(lock), false);
  });
}

test("SIGKILL at a random point of a tight acquire loop never leaves an ownerless lock", async t => {
  const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "lock");
  const iterations = Number(process.env.AO_LOCK_KILL_ITERATIONS || 150);
  let leftHeld = 0;
  for (let i = 0; i < iterations; i += 1) {
    const proc = child(`process.stdout.write("go\\n"); for (;;) await withLock(process.argv[1], async () => {});`, lock);
    await lineFrom(proc);
    await new Promise(resolve => setTimeout(resolve, Math.random() * 15));
    const done = exited(proc); proc.kill("SIGKILL"); await done;
    if (await lockHeld(lock)) leftHeld += 1;
    await assertNoOwnerless(lock);
    await withLock(lock, async () => {}, { timeoutMs: 2000, pollMs: 2 });
  }
  // Coverage, not correctness: if no kill ever landed while lockPath existed, this loop tested nothing.
  assert.ok(leftHeld > 0, `no kill of ${iterations} landed inside an acquisition`);
});

test("a remove gate left by a SIGKILLed remover never blocks reclaim; a live one is respected", async t => {
  const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true }));
  const deadOwner = JSON.stringify({ token: "dead-owner", pid: 2147483647 });
  // dead gate, and a dead gate whose chained successor is also dead
  for (const gates of [[".remove"], [".remove", ".remove-g0"]]) {
    const lock = join(root, `chain-${gates.length}.lock`);
    await mkdir(lock); await writeFile(join(lock, "owner.json"), deadOwner);
    for (const [i, gate] of gates.entries()) { await mkdir(join(lock, gate)); await writeFile(join(lock, gate, "owner.json"), JSON.stringify({ token: `g${i}`, pid: 2147483647 })); }
    assert.equal(await withLock(lock, async () => "reclaimed", { timeoutMs: 1000, pollMs: 5 }), "reclaimed");
  }
  // a legacy (pre-TM-307) empty gate is replaced like a legacy empty lock
  const legacy = join(root, "legacy-gate.lock");
  await mkdir(join(legacy, ".remove"), { recursive: true }); await writeFile(join(legacy, "owner.json"), deadOwner);
  assert.equal(await withLock(legacy, async () => "reclaimed", { timeoutMs: 1000, pollMs: 5 }), "reclaimed");
  // a gate held by a LIVE remover is never bypassed
  const live = join(root, "live-gate.lock");
  await mkdir(join(live, ".remove"), { recursive: true }); await writeFile(join(live, "owner.json"), deadOwner);
  await writeFile(join(live, ".remove", "owner.json"), JSON.stringify({ token: "live", pid: process.pid, process_identity: await processIdentity(process.pid) }));
  await assert.rejects(withLock(live, () => assert.fail("bypassed a live remover"), { timeoutMs: 80, pollMs: 5 }), { code: "TOPOLOGY_LOCK_TIMEOUT" });
});

test("N processes contending for one lock: exactly one holder at a time", async t => {
  const root = await scratch(); t.after(() => rm(root, { recursive: true, force: true }));
  const lock = join(root, "lock"), inside = join(root, "inside"), tally = join(root, "tally");
  const workers = 4, rounds = 75;
  const procs = Array.from({ length: workers }, () => child(`
    import { open, unlink, appendFile } from "node:fs/promises";
    const [lock, inside, tally, rounds] = process.argv.slice(1);
    for (let i = 0; i < Number(rounds); i += 1) await withLock(lock, async () => {
      const marker = await open(inside, "wx").catch(() => null);   // exists => someone else is inside
      await appendFile(tally, marker ? "ok\\n" : "OVERLAP\\n");
      await new Promise(resolve => setImmediate(resolve));
      if (marker) { await marker.close(); await unlink(inside); }
    }, { timeoutMs: 60_000, pollMs: 2 });`, lock, inside, tally, String(rounds)));
  const results = await Promise.all(procs.map(exited));
  assert.deepEqual(results.map(r => r.code), Array(workers).fill(0));
  const lines = (await readFile(tally, "utf8")).trim().split("\n");
  assert.equal(lines.length, workers * rounds, "every critical section ran");
  assert.equal(lines.filter(l => l !== "ok").length, 0, "no two holders overlapped");
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
