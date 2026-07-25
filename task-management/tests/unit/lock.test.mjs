/**
 * TM-002 — with one store shared by every worktree, two sessions can now write
 * state.json at the same instant. Read-modify-write without a lock silently loses
 * one of the two claims, which is exactly the failure the shared store exists to prevent.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import { LOCK_STALE_MS, state, withLock, writeState } from "../../lib/store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

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
