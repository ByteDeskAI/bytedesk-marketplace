/**
 * TM-357 (EP-028): `tm ticket` from another repo drops `pool.wake` in this store, and the pool's
 * sleep ends within about a second instead of waiting out `pollSeconds`.
 */
import { after, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { writeConfig } from "../../lib/store.mjs";
import { runPool } from "../../lib/dispatch/pool.mjs";
import { POOL_WAKE } from "../../lib/ticket.mjs";

delete process.env.TM_ENFORCE;
const trash = [];
after(() => cleanup(...trash));

it("a wake file ends the pool's 30s sleep within seconds, and is consumed", async () => {
  const p = tempStore();
  trash.push(p.root);
  writeConfig({ dispatch: { backends: ["fake"], pollSeconds: 30, idleExitMinutes: 0 } }, p);
  const wakeFile = join(p.base, POOL_WAKE);
  const ticks = [];
  const run = runPool({
    p,
    registry: { fake: { name: "fake", available: () => true, spawn: () => ({ ok: true, run: "x" }) } },
    caps: {},
    onTick: () => {
      ticks.push(Date.now());
      if (ticks.length === 1) writeFileSync(wakeFile, "{}\n");
      if (ticks.length === 2) process.emit("SIGTERM");
    },
  });
  const res = await Promise.race([run, new Promise((r) => setTimeout(() => r("still asleep"), 5000))]);
  if (res === "still asleep") process.emit("SIGTERM");
  assert.equal(ticks.length, 2, "the wake produced a second tick inside 5s of a 30s poll");
  assert.ok(ticks[1] - ticks[0] < 2500, `woke in ${ticks[1] - ticks[0]} ms`);
  assert.equal(existsSync(wakeFile), false, "the wake was consumed");
  await run;
});
