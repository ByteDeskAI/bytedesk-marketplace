/** NATS backend against a real throwaway nats-server -js (ambient NATS_* cleared by the helper). */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./nats-helpers.mjs";
import { NatsBackend } from "../../lib/storage/nats-backend.mjs";
import { ConflictError } from "../../lib/storage/backend.mjs";
import { assertWritable, decode, encode, ReadOnlySchemaError } from "../../lib/storage/registry.mjs";
import "../../lib/storage/types.mjs";

let srv, cache, n = 0;
const make = (o = {}) => new NatsBackend({ repo: "repo1", url: srv.url, cacheDir: cache, actor: { actor: "ryan", agent: "ag-1" }, ...o });
const uid = () => `TM-${++n}-${process.pid}`;
const task = (id, extra = {}) => encode("tm/task", { id, title: `t ${id}`, status: "open", ...extra });

before(async () => {
  srv = await startServer();
  cache = mkdtempSync(join(tmpdir(), "tm-cache-"));
});
after(async () => {
  await srv.cleanup();
  rmSync(cache, { recursive: true, force: true });
});

describe("nats backend", () => {
  it("rewrites a stored legacy doc at the current schema, keeping the unknown field (print before/after)", async () => {
    const b = make();
    const id = uid();
    const legacy = { type: "tm/task", schema: 0, id, data: { id, title: "legacy", futureField: [1, 2] }, meta: {} };
    await b.put("tm/task", id, legacy);
    const stored = await b.get("tm/task", id);
    console.log("stored before:", JSON.stringify({ schema: stored.envelope.schema, data: stored.envelope.data }));
    const up = decode(stored.envelope);
    await b.put("tm/task", id, encode("tm/task", up.data), { ifRev: stored.rev });
    const after_ = await b.get("tm/task", id);
    console.log("stored after: ", JSON.stringify({ schema: after_.envelope.schema, data: after_.envelope.data }));
    assert.equal(after_.envelope.schema, 1);
    assert.equal(after_.envelope.data.kind, "task");
    assert.deepEqual(after_.envelope.data.futureField, [1, 2]);
    await b.close();
  });

  it("refuses to overwrite a schema-99 value and leaves it intact (print refusal)", async () => {
    const b = make();
    const id = uid();
    await b.put("tm/task", id, { type: "tm/task", schema: 99, id, data: { id, shiny: "v99" }, meta: {} });
    await assert.rejects(b.put("tm/task", id, task(id)), (e) => {
      console.log("refusal:", e.message);
      return e instanceof ReadOnlySchemaError;
    });
    const still = await b.get("tm/task", id);
    assert.equal(still.envelope.schema, 99);
    assert.equal(still.envelope.data.shiny, "v99");
    assert.equal(decode(still.envelope).readOnly, true);
    await assert.rejects(b.delete("tm/task", id), ReadOnlySchemaError);
    await b.close();
  });

  it("CAS: a stale ifRev conflicts and names the current rev", async () => {
    const b = make();
    const id = uid();
    const r1 = (await b.create("tm/task", id, task(id))).rev;
    const r2 = (await b.put("tm/task", id, task(id, { title: "second" }), { ifRev: r1 })).rev;
    await assert.rejects(b.put("tm/task", id, task(id, { title: "stale" }), { ifRev: r1 }), (e) => {
      console.log("conflict:", e.message, "| currentRev =", e.currentRev, "| r1 =", r1, "r2 =", r2);
      return e instanceof ConflictError && e.currentRev === r2 && r2 > r1;
    });
    await assert.rejects(b.create("tm/task", id, task(id)), ConflictError);
    assert.equal((await b.get("tm/task", id)).envelope.data.title, "second");
    await b.close();
  });

  it("two racing claim writers: exactly one wins (print winner)", async () => {
    const [a, c] = [make(), make()];
    const key = `claims.${uid()}`;
    const results = await Promise.allSettled([a.stateCreate(key, { session: "A" }), c.stateCreate(key, { session: "B" })]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    const cur = await a.stateGet(key);
    console.log("winner:", JSON.stringify(cur), "| loser error:", lost[0]?.reason?.message);
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    assert.ok(lost[0].reason instanceof ConflictError);
    assert.equal(cur.rev, won[0].value);
    await a.close();
    await c.close();
  });

  it("watch delivers a change", async () => {
    const b = make();
    const id = uid();
    const it_ = b.watch("tm/task");
    const first = (async () => {
      for await (const ev of it_) if (ev.id === id) return ev;
    })();
    await new Promise((r) => setTimeout(r, 200));
    await b.create("tm/task", id, task(id, { title: "watched" }));
    const ev = await Promise.race([first, new Promise((_, rej) => setTimeout(() => rej(new Error("no watch event in 5s")), 5000))]);
    console.log("watch event:", JSON.stringify({ id: ev.id, op: ev.op, rev: ev.rev, title: ev.envelope.data.title }));
    assert.equal(ev.op, "PUT");
    assert.equal(ev.envelope.data.title, "watched");
    await it_.return();
    await b.close();
  });

  it("history keeps each revision; meta carries actor/agent/reason/git", async () => {
    const b = make({ root: process.cwd() });
    const id = uid();
    await b.create("tm/task", id, task(id));
    await b.put("tm/task", id, task(id, { title: "two" }), { reason: "retitle" });
    await b.put("tm/task", id, task(id, { title: "three" }), { reason: "retitle again" });
    const h = await b.history("tm/task", id);
    console.log("history:", JSON.stringify(h.map((r) => [r.rev, r.envelope.data.title, r.envelope.meta.reason, r.envelope.meta.actor, r.envelope.meta.agent])));
    assert.deepEqual(h.map((r) => r.envelope.data.title), [`t ${id}`, "two", "three"]);
    assert.equal(h[2].envelope.meta.reason, "retitle again");
    assert.equal(h[2].envelope.meta.actor, "ryan");
    assert.equal(h[2].envelope.meta.agent, "ag-1");
    assert.match(h[2].envelope.meta.git.commit, /^[0-9a-f]{40}$/);
    await b.close();
  });

  it("the write lease excludes a second holder until released", async () => {
    const [a, c] = [make(), make()];
    const release = await a.acquireLease("A", { ttlMs: 60_000 });
    await assert.rejects(c.acquireLease("B", { waitMs: 150 }), /could not take the store lease/);
    await release();
    const rel2 = await c.acquireLease("B", { waitMs: 1000 });
    await rel2();
    await a.close();
    await c.close();
  });

  it("an expired lease is taken over by CAS", async () => {
    const [a, c] = [make(), make()];
    await a.acquireLease("dead", { ttlMs: 30 });
    await new Promise((r) => setTimeout(r, 80));
    const rel = await c.acquireLease("live", { waitMs: 1000 });
    assert.equal((await c.stateGet("lock")).value.owner, "live");
    await rel();
    await a.close();
    await c.close();
  });

  it("blobs are content addressed; events append and read back", async () => {
    const b = make();
    const d = await b.blobPut(Buffer.from("evidence bytes"));
    assert.equal(d, createHash("sha256").update("evidence bytes").digest("hex"));
    assert.equal((await b.blobGet(d)).toString(), "evidence bytes");
    assert.ok((await b.blobList()).includes(d));
    const tag = `e${Date.now()}`;
    await b.appendEvent({ event: tag, id: "TM-1" });
    const rows = await b.events({ filter: tag });
    console.log("events:", JSON.stringify(rows));
    assert.equal(rows.length, 1);
    await b.close();
  });

  it("events are scoped to their own board and kind, even when other boards' events were published first", async () => {
    const [x, y] = [make({ repo: "boardX" }), make({ repo: "boardY" })];
    await x.appendEvent({ event: "x_only", n: 1 });
    await y.appendEvent({ event: "y_first", n: 2 });
    await y.appendEvent({ event: "y_second", n: 3 });
    const ys = await y.events();
    const xs = await x.events();
    console.log("boardY events:", JSON.stringify(ys.map((e) => e.event)), "| boardX events:", JSON.stringify(xs.map((e) => e.event)), "| boardY kind filter:", JSON.stringify((await y.events({ filter: "y_second" })).map((e) => e.event)));
    assert.deepEqual(ys.map((e) => e.event), ["y_first", "y_second"]);
    assert.deepEqual(xs.map((e) => e.event), ["x_only"]);
    assert.deepEqual((await y.events({ filter: "y_second" })).map((e) => e.event), ["y_second"]);
    await x.close();
    await y.close();
  });

  it("ignores the ambient NATS_URL: with no TM_NATS_URL it is offline, not connected to a stray server", async () => {
    process.env.NATS_URL = srv.url; // a real, reachable server — must still not be used
    delete process.env.TM_NATS_URL;
    const b = new NatsBackend({ repo: "repo1" });
    const info = await b.info();
    delete process.env.NATS_URL;
    console.log("info:", JSON.stringify(info));
    assert.equal(info.offline, true);
    assert.match(info.why, /TM_NATS_URL is not set/);
  });
});
