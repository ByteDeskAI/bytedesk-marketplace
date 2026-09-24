/** TM-224 — a bare `tm override` arms nothing, and `tm override --clear` disarms. */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import { state } from "../../lib/store.mjs";

const TM = fileURLToPath(new URL("../../bin/tm", import.meta.url));
const roots = [];
after(() => cleanup(...roots));
const store = () => { const p = tempStore(); roots.push(p.root); return p; };
const tm = (p, ...args) => spawnSync(process.execPath, [TM, "override", ...args], { env: { ...process.env, TM_ROOT: p.root }, encoding: "utf8" });
const events = (p) => readFileSync(p.events, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((e) => e.type || e.event);

describe("tm override", () => {
  it("bare prints usage, exits non-zero, and arms nothing", () => {
    const p = store();
    const r = tm(p);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /usage: tm override/);
    assert.equal(state(p).override ?? null, null);
  });

  it("with a reason arms one token; --clear disarms it and logs the event", () => {
    const p = store();
    assert.equal(tm(p, "gate is wrong here").status, 0);
    assert.equal(state(p).override.reason, "gate is wrong here");
    const r = tm(p, "--clear");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /override cleared \(was: gate is wrong here\)/);
    assert.equal(state(p).override ?? null, null);
    assert.ok(events(p).includes("override_cleared"));
  });

  it("--clear with nothing armed is a no-op", () => {
    const p = store();
    const r = tm(p, "--clear");
    assert.equal(r.status, 0);
    assert.match(r.stdout, /no override armed/);
    assert.equal(state(p).override ?? null, null);
  });
});
