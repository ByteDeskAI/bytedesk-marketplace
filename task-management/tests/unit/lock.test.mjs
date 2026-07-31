/**
 * TM-002 — with one store shared by every worktree, two sessions can now write
 * state.json at the same instant. Read-modify-write without a lock silently loses
 * one of the two claims, which is exactly the failure the shared store exists to prevent.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import { LOCK_STALE_MS, staleLock, state, withLock, writeState } from "../../lib/store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

/** Set env for one call, without leaking into the next test. */
function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe("withLock", () => {
  it("returns the callback's value and releases the lock", () => {
    const p = store();
    const got = withLock(p, () => "result");
    assert.equal(got, "result");
    assert.equal(existsSync(join(p.base, "state.lock")), false, "the lock must not outlive the critical section");
  });

  it("releases the lock when the callback throws", () => {
    const p = store();
    assert.throws(() => withLock(p, () => {
      throw new Error("boom");
    }), /boom/);
    assert.equal(existsSync(join(p.base, "state.lock")), false, "a thrown callback must not wedge the store");
  });

  it("breaks a stale lock rather than hanging forever", () => {
    const p = store();
    const lock = join(p.base, "state.lock");
    const ancient = new Date(Date.now() - LOCK_STALE_MS * 2).toISOString();
    writeFileSync(lock, JSON.stringify({ pid: 999999, ts: ancient }));
    assert.equal(withLock(p, () => "recovered"), "recovered");
  });

  it("will not break a stale lock while another process is breaking it", () => {
    const p = store();
    const lock = join(p.base, "state.lock");
    const ancient = new Date(Date.now() - LOCK_STALE_MS * 2).toISOString();
    writeFileSync(lock, JSON.stringify({ pid: 999999, ts: ancient }));
    // Someone else is mid-break. Breaking is exclusive precisely so that the loser cannot delete
    // the fresh lock the winner is about to create — four processes once got inside the critical
    // section that way, and eight concurrent creates minted one id three times.
    const breaker = `${lock}.break`;
    writeFileSync(breaker, "");
    try {
      assert.throws(
        () => withEnv({ TM_LOCK_TIMEOUT_MS: "300" }, () => withLock(p, () => "should not run")),
        /could not take the store lock/,
        "a breaker in flight means wait, not break",
      );
      assert.equal(existsSync(lock), true, "the stale lock is the other process's to remove");
    } finally {
      rmSync(breaker, { force: true });
    }
  });

  it("clears a breaker whose own process died, so a lock is never permanently unbreakable", () => {
    const p = store();
    const lock = join(p.base, "state.lock");
    const ancient = new Date(Date.now() - LOCK_STALE_MS * 2).toISOString();
    writeFileSync(lock, JSON.stringify({ pid: 999999, ts: ancient }));
    const breaker = `${lock}.break`;
    writeFileSync(breaker, "");
    const old = new Date(Date.now() - LOCK_STALE_MS * 2);
    utimesSync(breaker, old, old);

    assert.equal(withLock(p, () => "recovered"), "recovered", "an orphaned breaker must age out too");
  });

  it("is not blocked by a lock some older version committed to the repo", () => {
    const p = store();
    const lock = join(p.base, "state.lock");
    // A store committed before state.lock was ignored hands every clone a lock file. Its pid is a
    // number from somebody else's machine, so it belongs to no process here — which is precisely
    // the case staleLock exists for. The clone has to be able to write.
    writeFileSync(lock, JSON.stringify({ pid: 999999, ts: new Date().toISOString() }));

    assert.equal(staleLock(lock), true, "a pid that does not exist here is a dead holder, however fresh the file");
    assert.equal(withLock(p, () => "the clone can write"), "the clone can write");
  });

  it("does not treat a freshly created empty lock as dead", () => {
    const p = store();
    const lock = join(p.base, "state.lock");
    // `openSync(lock, "wx")` creates the file EMPTY; the pid lands a moment later. A
    // second process arriving inside that window read "", failed to parse it, concluded
    // the lock was dead, unlinked it and walked in — so two processes held the lock at
    // once. That is why concurrent creates still minted duplicate ids even after
    // create() was wrapped: the wrapping was fine, the lock was breakable.
    writeFileSync(lock, "");

    assert.equal(staleLock(lock), false, "an unparseable but young lock is held, not dead");
  });

  it("still breaks an empty lock once it has aged out", () => {
    const p = store();
    const lock = join(p.base, "state.lock");
    writeFileSync(lock, "");
    // Age the file itself, since there is no timestamp inside it to age.
    const old = (Date.now() - LOCK_STALE_MS * 2) / 1000;
    utimesSync(lock, old, old);

    assert.equal(staleLock(lock), true, "a corrupt lock must not wedge the store forever");
    assert.equal(withLock(p, () => "recovered"), "recovered");
  });

  it("treats a lock whose holder is gone as dead", () => {
    const p = store();
    const lock = join(p.base, "state.lock");
    writeFileSync(lock, JSON.stringify({ pid: 999999, ts: new Date().toISOString() }));

    assert.equal(staleLock(lock), true, "a live timestamp with a dead pid is still dead");
  });

  it("serializes concurrent claim writes from separate processes", () => {
    const p = store();
    writeState({ claims: {} }, p);

    // Two real processes, not two closures — the race we care about crosses process
    // boundaries (a session in main and a session in a worktree).
    const writer = join(HERE, "fixtures", "concurrent-claim.mjs");
    const procs = ["alpha", "beta", "gamma", "delta"].map((name) =>
      execFileSync(process.execPath, [writer, p.root, name], { encoding: "utf8", timeout: 15000 }),
    );

    assert.equal(procs.length, 4);
    const claims = state(p).claims;
    assert.deepEqual(
      Object.keys(claims).sort(),
      ["alpha", "beta", "delta", "gamma"],
      "every writer's claim must survive — a lost update here means a stolen task in real use",
    );
  });

  it("never leaves a half-written state.json behind", () => {
    const p = store();
    writeState({ claims: {} }, p);
    const writer = join(HERE, "fixtures", "concurrent-claim.mjs");
    for (const name of ["one", "two", "three"]) {
      execFileSync(process.execPath, [writer, p.root, name], { encoding: "utf8", timeout: 15000 });
    }
    assert.doesNotThrow(
      () => JSON.parse(readFileSync(p.state, "utf8")),
      "atomic writes plus the lock must make torn JSON impossible",
    );
  });
});

describe("a waiter that times out", () => {
  it("refuses rather than breaking a lock a live process is holding", () => {
    const p = store();
    const lock = join(p.base, "state.lock");
    // Alive (this pid) and young, so `staleLock` correctly says no. Before the fix, a waiter whose
    // own deadline had passed deleted it anyway and walked in — two holders, one lost write.
    writeFileSync(lock, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }));

    process.env.TM_LOCK_TIMEOUT_MS = "150";
    try {
      assert.throws(
        () => withLock(p, () => "must never run"),
        /could not take the store lock/,
        "timing out is a failure the caller can see and retry, not a licence to break the lock",
      );
      assert.equal(existsSync(lock), true, "and the live holder's lock survives the refusal");
    } finally {
      delete process.env.TM_LOCK_TIMEOUT_MS;
      rmSync(lock, { force: true });
    }
  });

  it("still clears a lock whose holder is gone", () => {
    const p = store();
    const lock = join(p.base, "state.lock");
    // pid 1 is alive but is not us and never took this lock; age it past the stale window instead,
    // which is the honest "the holder died mid-write" case.
    writeFileSync(lock, JSON.stringify({ pid: process.pid, ts: new Date(Date.now() - LOCK_STALE_MS * 2).toISOString() }));

    process.env.TM_LOCK_TIMEOUT_MS = "150";
    try {
      assert.equal(withLock(p, () => "ran"), "ran", "a dead lock must not block the store forever");
    } finally {
      delete process.env.TM_LOCK_TIMEOUT_MS;
      rmSync(lock, { force: true });
    }
  });
});
