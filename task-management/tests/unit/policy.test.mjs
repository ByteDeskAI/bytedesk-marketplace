/**
 * TM-072 — dispatch policy: poolWip is the pool's own cap (independent of the
 * interactive wipLimit), dispatch.backendCaps caps one backend, and the new
 * config keys are in the shared settings catalog.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempRepo, tempStore } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, read, seedGitContract, update, writeConfig } from "../../lib/store.mjs";
import { gateStart } from "../../lib/enforce.mjs";
import { poolTick } from "../../lib/dispatch/pool.mjs";
import { applySettings, settingsSnapshot } from "../../lib/settings.mjs";

delete process.env.TM_ENFORCE;

const trash = [];
after(() => cleanup(...trash));

function repoStore(cfg = {}) {
  const root = tempRepo();
  const p = paths(root);
  ensureDirs(p);
  seedGitContract(p);
  const { dispatch: dcfg, ...rest } = cfg;
  writeConfig({ ...rest, dispatch: { backends: ["fake"], ...(dcfg || {}) } }, p);
  trash.push(root);
  return p;
}

function fakeBackend() {
  return { name: "fake", available: () => true, spawn: (req) => ({ ok: true, run: `fake:${req.task.id}` }) };
}

function ready(p, title) {
  const t = create("task", { title, acceptance: [{ text: "done means", done: false }] }, "context\n", p);
  update(t.id, { labels: ["ready-for-agent"] }, p);
  return t.id;
}

describe("pool policy", () => {
  it("poolWip caps the pool without consulting the interactive wipLimit", async () => {
    // wipLimit 1 would refuse a second interactive `tm start`; the pool's own
    // cap is poolWip, so two workers still dispatch.
    const p = repoStore({ wipLimit: 1, dispatch: { poolWip: 2 } });
    const t1 = ready(p, "one");
    const t2 = ready(p, "two");

    const res = await poolTick({ p, registry: { fake: fakeBackend() }, caps: {} });

    assert.deepEqual(res.dispatched.map((d) => d.id), [t1, t2]);
    assert.equal(read(t1, p).status, "in_progress");
    assert.equal(read(t2, p).status, "in_progress");
  });

  it("the interactive gate still honours wipLimit, unchanged", async () => {
    const p = repoStore({ wipLimit: 1, dispatch: { poolWip: 5 } });
    const t1 = ready(p, "held interactively");
    const t2 = ready(p, "second start refused");

    const first = gateStart(t1, p);
    assert.equal(first.allow, true, first.reason);
    update(t1, { status: "in_progress" }, p);
    const second = gateStart(t2, p);
    assert.equal(second.allow, false, "wipLimit still binds interactive sessions");
  });

  it("dispatch.backendCaps caps one backend even when the pool has room", async () => {
    const p = repoStore({ dispatch: { poolWip: 5, backendCaps: { fake: 1 } } });
    const t1 = ready(p, "first");
    const t2 = ready(p, "second");

    const res = await poolTick({ p, registry: { fake: fakeBackend() }, caps: {} });

    assert.deepEqual(res.dispatched.map((d) => d.id), [t1]);
    assert.deepEqual(res.skipped, [{ id: t2, reason: "backend fake at cap (1)" }]);
    assert.equal(read(t2, p).status, "open");
  });
});

describe("settings catalog", () => {
  it("lists the dispatch and registry keys in the agents group", () => {
    const p = tempStore();
    trash.push(p.root);
    const snap = settingsSnapshot(p);
    const keys = snap.fields.map((f) => f.key);
    for (const key of ["dispatch.enabled", "dispatch.poolWip", "dispatch.pollSeconds", "dispatch.heartbeatSeconds", "agentTtlMinutes"]) {
      assert.ok(keys.includes(key), `${key} is in the catalog`);
    }
    const group = snap.fields.find((f) => f.key === "dispatch.poolWip").group;
    assert.equal(group, "agents");
  });

  it("applies an allowlisted dispatch key and ignores an invented one", () => {
    const p = tempStore();
    trash.push(p.root);
    const res = applySettings({ "dispatch.poolWip": 5, "dispatch.madeUp": true }, p);
    assert.deepEqual(Object.keys(res.values), ["dispatch.poolWip"]);
    assert.deepEqual(res.ignored, ["dispatch.madeUp"]);
  });
});
