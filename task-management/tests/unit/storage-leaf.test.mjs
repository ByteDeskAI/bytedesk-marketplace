/**
 * Hub + leaf: two real nats-servers, JetStream on both, domains "hub" and "leaf". The backend
 * connects to the LEAF and addresses the hub by domain. The leaf holds its own JetStream copy:
 * KV buckets and the event stream are mirrors of the hub's, evidence is cached on demand.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHubLeaf } from "./nats-helpers.mjs";
import { NatsBackend } from "../../lib/storage/nats-backend.mjs";
import { decode, encode } from "../../lib/storage/registry.mjs";
import "../../lib/storage/types.mjs";

let net, cache, notices = [];
const task = (id, title) => encode("tm/task", { id, title });
const leafBackend = (o = {}) => new NatsBackend({ repo: "lf1", url: net.leaf.url, domain: "hub", cacheDir: cache, retryMs: 0, probeMs: 0, onOffline: (m) => notices.push(m), ...o });
const hubBackend = () => new NatsBackend({ repo: "lf1", url: net.hub.url, retryMs: 0 });
const until = async (fn, ms = 15_000) => {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* keep trying */ }
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 200));
  }
};

before(async () => {
  net = await startHubLeaf();
  cache = mkdtempSync(join(tmpdir(), "tm-leafcache-"));
});
after(async () => {
  await net.cleanup();
  rmSync(cache, { recursive: true, force: true });
});

describe("leaf node with a real leaf-side JetStream copy", () => {
  let leaf, rev1, blobDigest, savedQueue;
  it("(a) a write on the leaf appears on the hub; online reads are served by the hub tier", async () => {
    leaf = leafBackend();
    await until(async () => !(await leaf.info()).offline);
    rev1 = (await leaf.create("tm/task", "TM-1", task("TM-1", "written on the leaf"))).rev;
    const hub = hubBackend();
    const onHub = await hub.get("tm/task", "TM-1");
    const info = await leaf.info();
    await leaf.get("tm/task", "TM-1");
    console.log("(a) leaf wrote rev", rev1, "| hub reads:", JSON.stringify({ rev: onHub.rev, title: onHub.envelope.data.title }), "| tier:", (await leaf.info()).tier, "lastReadTier:", (await leaf.info()).lastReadTier);
    assert.equal(onHub.rev, rev1);
    assert.equal(info.tier, "hub");
    await hub.close();
  });

  it("(a2) a write on the HUB reaches the leaf's own JetStream (read through a plain connection to the leaf)", async () => {
    const hub = hubBackend();
    const r = (await hub.create("tm/task", "TM-2", task("TM-2", "written on the hub"))).rev;
    await hub.appendEvent({ event: "hub_event", n: 1 });
    blobDigest = await hub.blobPut(Buffer.from("evidence bytes from the hub"));
    await hub.close();
    // fetched on demand while the hub is up; cached in the leaf's object store
    assert.equal((await leaf.blobGet(blobDigest)).toString(), "evidence bytes from the hub");
    // an independent connection to the leaf, no domain: whatever it sees is in the LEAF's JetStream
    const own = new NatsBackend({ repo: "lf1", url: net.leaf.url, retryMs: 0 });
    const seen = await until(async () => own.get("tm/task", "TM-2"));
    const evs = await until(async () => { const e = await own.events({ filter: "hub_event" }); return e.length ? e : null; });
    console.log("(a2) hub wrote rev", r, "| leaf's own JetStream has:", JSON.stringify({ rev: seen.rev, title: seen.envelope.data.title }), "| event:", JSON.stringify(evs.map((e) => e.event)));
    assert.equal(seen.rev, r, "same revision: it is a mirror, not a copy with its own numbering");
    await own.close();
    await leaf.get("tm/task", "TM-2"); // also lands in the file cache, the last-resort tier
  });

  it("(b) hub killed: a fresh process with an EMPTY file cache still reads the board from the leaf JetStream; writes queue", async () => {
    await net.hub.stop();
    const emptyCache = mkdtempSync(join(tmpdir(), "tm-emptycache-"));
    assert.deepEqual(readdirSync(emptyCache), [], "the file cache starts empty");
    const fresh = leafBackend({ cacheDir: emptyCache });
    const got = await fresh.get("tm/task", "TM-2");
    const list = await fresh.list("tm/task");
    const evs = await fresh.events({ filter: "hub_event" });
    const info = await fresh.info();
    console.log("(b) hub down, empty file cache:", JSON.stringify({ rev: got.rev, title: got.envelope.data.title }), "| list:", JSON.stringify(list.map((e) => e.envelope.id)), "| events:", evs.length, "| info:", JSON.stringify({ tier: info.tier, lastReadTier: info.lastReadTier, offline: info.offline }));
    assert.equal(got.envelope.data.title, "written on the hub");
    assert.deepEqual(list.map((e) => e.envelope.id), ["TM-1", "TM-2"]);
    assert.equal(evs.length, 1);
    assert.equal(info.tier, "leaf");
    assert.equal(info.lastReadTier, "leaf");
    assert.equal(info.offline, true);
    assert.equal((await fresh.blobGet(blobDigest)).toString(), "evidence bytes from the hub", "evidence served from the leaf's cache");
    await fresh.close();

    // the long-lived instance queues a write
    const cur = await leaf.get("tm/task", "TM-1");
    const q = await leaf.put("tm/task", "TM-1", encode("tm/task", { ...decode(cur.envelope).data, title: "edited while hub was down" }));
    console.log("(b) queued write:", JSON.stringify(q), "| queue length", leaf.queue().length, "| notices", JSON.stringify(notices));
    assert.equal(q.queued, true);
    assert.equal(leaf.queue().length, 1);
    savedQueue = readFileSync(leaf.queueFile, "utf8");
    rmSync(emptyCache, { recursive: true, force: true });
  });

  it("(b2) file cache is the last tier: with even the leaf unreachable, reads come from it", async () => {
    const dead = new NatsBackend({ repo: "lf1", url: "nats://127.0.0.1:1", domain: "hub", cacheDir: cache, retryMs: 0 });
    const got = await dead.get("tm/task", "TM-2");
    const info = await dead.info();
    console.log("(b2) leaf unreachable:", JSON.stringify({ title: got?.envelope.data.title, tier: info.tier, lastReadTier: info.lastReadTier }));
    assert.equal(got.envelope.data.title, "written on the hub");
    assert.equal(info.tier, "cache");
    assert.equal(info.lastReadTier, "cache");
  });

  it("(c) hub back: the queued write reaches the hub exactly once, and replaying it again adds nothing", async () => {
    net.hub = await net.hub.restart();
    await until(async () => !(await leaf.info()).offline, 30_000);
    const hub = hubBackend();
    const hist = await hub.history("tm/task", "TM-1");
    console.log("(c) hub history:", JSON.stringify(hist.map((h) => [h.rev, h.envelope.data.title])));
    assert.deepEqual(hist.map((h) => h.envelope.data.title), ["written on the leaf", "edited while hub was down"]);
    assert.equal(leaf.queue().length, 0, "queue drained");
    writeFileSync(join(cache, "queue.jsonl"), savedQueue);
    const again = leafBackend();
    await until(async () => !(await again.info()).offline, 30_000);
    const hist2 = await hub.history("tm/task", "TM-1");
    console.log("(c) after replaying the same queue again:", JSON.stringify(hist2.map((h) => [h.rev, h.envelope.data.title])), "| queue now", again.queue().length);
    assert.equal(hist2.length, 2);
    await again.close();
    await leaf.close();
    await hub.close();
  });
});
