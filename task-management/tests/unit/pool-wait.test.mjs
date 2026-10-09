/**
 * TM-450 (4): `tm pool wait` must end for every outcome it can reach. `--until done` waited forever
 * for a worker that failed or blocked (the task parks), and `--until idle` never held while the pool
 * was paused with ready work — the loop's own idle exit counted that as idle, the wait did not.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, update, writeConfig } from "../../lib/store.mjs";
import { poolCondition, poolWait } from "../../lib/dispatch/pool.mjs";

const trash = [];
after(() => cleanup(...trash));

function store() {
  const p = tempStore();
  trash.push(p.root);
  writeConfig({ enforce: false, requireEpic: false, dispatch: { enabled: false } }, p);
  return p;
}

describe("TM-450 pool wait ends", () => {
  for (const status of ["parked", "blocked"]) {
    it(`--until done returns at once, not ok, when the task is ${status}`, async () => {
      const p = store();
      const t = create("task", { title: "x", status: "in_progress" }, "b", p);
      update(t.id, { status, ...(status === "parked" ? { parkedReason: "worker failed" } : { blockedReason: "needs a person" }) }, p);
      const res = await poolWait({ until: "done", id: t.id, timeoutSeconds: 5, intervalMs: 100, p });
      assert.equal(res.ok, false);
      assert.equal(res.ended, status);
      assert.ok(!res.timedOut && res.waitedSeconds < 1, JSON.stringify(res));
    });
  }

  it("--until idle holds while the pool is paused with ready work, and not before", () => {
    const p = store();
    create("task", { title: "ready", status: "open", labels: ["ready-for-agent"] }, "b", p);
    const before = poolCondition("idle", undefined, p);
    assert.equal(before.detail.poolable, 1, "the control: there is ready work");
    assert.equal(before.met, false, "unpaused with ready work is not idle");
    writeFileSync(join(p.base, "pool.state.json"), JSON.stringify({ pausedReason: "3 failures in a row", pausedAt: new Date().toISOString(), failures: 3 }));
    const paused = poolCondition("idle", undefined, p);
    assert.equal(paused.detail.paused, true);
    assert.equal(paused.met, true);
  });
});
