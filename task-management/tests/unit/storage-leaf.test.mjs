/**
 * Hub + leaf (two real nats-server, JetStream on both, domains "hub" and "leaf"). The backend
 * connects to the LEAF and addresses the hub's JetStream by domain (TM_NATS_DOMAIN).
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("leaf node", () => {
  let leaf, rev1, savedQueue;
  it("(a) a write on the leaf appears on the hub", async () => {
    leaf = leafBackend();
    await until(async () => !(await leaf.info()).offline);
    rev1 = (await leaf.create("tm/task", "TM-1", task("TM-1", "written on the leaf"))).rev;
    const hub = hubBackend();
    const onHub = await hub.get("tm/task", "TM-1");
    console.log("(a) leaf wrote rev", rev1, "| hub reads:", JSON.stringify({ rev: onHub.rev, title: onHub.envelope.data.title }));
    assert.equal(onHub.envelope.data.title, "written on the leaf");
    assert.equal(onHub.rev, rev1);
    await hub.close();
  });

  it("(b) hub killed: the leaf serves reads from cache and queues writes", async () => {
    await net.hub.stop();
    const t0 = Date.now();
    const got = await leaf.get("tm/task", "TM-1");
    const info = await leaf.info();
    console.log(`(b) hub down: get=${JSON.stringify({ title: got.envelope.data.title, rev: got.rev })} in ${Date.now() - t0}ms | info=${JSON.stringify(info)} | notices=${JSON.stringify(notices)}`);
    assert.equal(got.envelope.data.title, "written on the leaf");
    assert.equal(info.offline, true);
    assert.deepEqual(notices, ["offline: read-only, writes queued"]);
    const cur = decode(got.envelope).data;
    const q = await leaf.put("tm/task", "TM-1", encode("tm/task", { ...cur, title: "edited while hub was down" }));
    console.log("(b) queued write:", JSON.stringify(q), "| queue length", leaf.queue().length);
    assert.equal(q.queued, true);
    assert.equal(leaf.queue().length, 1);
    savedQueue = readFileSync(leaf.queueFile, "utf8");
  });

  it("(c) hub back: the queued write reaches the hub exactly once, and a second replay adds nothing", async () => {
    net.hub = await net.hub.restart();
    await until(async () => !(await leaf.info()).offline, 30_000);
    const hub = hubBackend();
    const hist = await hub.history("tm/task", "TM-1");
    console.log("(c) hub history:", JSON.stringify(hist.map((h) => [h.rev, h.envelope.data.title])));
    assert.deepEqual(hist.map((h) => h.envelope.data.title), ["written on the leaf", "edited while hub was down"]);
    assert.equal(leaf.queue().length, 0, "queue drained");
    // Crash between apply and truncate: the same proposal is replayed by a fresh process. Still one revision.
    writeFileSync(join(cache, "queue.jsonl"), savedQueue);
    const again = leafBackend();
    await until(async () => !(await again.info()).offline, 30_000);
    const hist2 = await hub.history("tm/task", "TM-1");
    console.log("(c) after replaying the same queue again:", JSON.stringify(hist2.map((h) => [h.rev, h.envelope.data.title])), "| queue now", again.queue().length);
    assert.equal(hist2.length, 2);
    await again.close();
    await leaf.close();    // The same queue line is replayed again (a crash between apply and truncate): still one revision.
    await hub.close();
  });
});
