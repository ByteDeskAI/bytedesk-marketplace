/**
 * Webhook fan-out: the machine-consumable half of the event bus.
 *
 * The rules that matter: fanoutWebhook never throws and never blocks past
 * dispatch; delivery happens in the detached child (bin/tm-webhook) that
 * notify-hook spawns, so these tests go through the real logEvent and poll a
 * stub server rather than mocking fetch; and the stream is loopback-only unless
 * the project says otherwise, because the rows carry task contents.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cleanup, tempStore } from "./helpers.mjs";
import { config, logEvent, readEvents, writeConfig } from "../../lib/store.mjs";
import { fanoutWebhook, isAllowedUrl, webhookTargets } from "../../lib/webhooks.mjs";

const stores = [];
const servers = [];
after(() => {
  cleanup(...stores);
  for (const s of servers) s.close();
});

function store(cfg = {}) {
  const p = tempStore();
  stores.push(p.root);
  if (Object.keys(cfg).length) writeConfig(cfg, p);
  return p;
}

/** A stub endpoint on 127.0.0.1 with an ephemeral port; records every POST body. */
function stub() {
  const hits = [];
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      hits.push(JSON.parse(raw));
      res.writeHead(204);
      res.end();
    });
  });
  servers.push(srv);
  return new Promise((resolve) =>
    srv.listen(0, "127.0.0.1", () => resolve({ hits, url: `http://127.0.0.1:${srv.address().port}` })),
  );
}

/** Delivery happens in a detached child, so it is async by design — poll for it. */
async function arrives(cond, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cond();
}

/** logEvent with TM_ROOT pointing at this store, so the detached child resolves it. */
function loggedFrom(p, event, fields = {}) {
  const saved = process.env.TM_ROOT;
  process.env.TM_ROOT = p.root;
  try {
    logEvent(event, fields, p);
  } finally {
    if (saved === undefined) delete process.env.TM_ROOT;
    else process.env.TM_ROOT = saved;
  }
}

describe("config", () => {
  it("defaults to no webhooks and no remote endpoints", () => {
    const p = store();
    assert.deepEqual(config(p).webhooks, []);
    assert.equal(config(p).webhooksAllowRemote, false);
  });
});

describe("isAllowedUrl", () => {
  it("allows loopback and .local http endpoints by default", () => {
    assert.equal(isAllowedUrl("http://127.0.0.1:8080/hook"), true);
    assert.equal(isAllowedUrl("http://localhost:9000"), true);
    assert.equal(isAllowedUrl("http://nas.local:4000/events"), true);
  });

  it("refuses everything else by default — the stream carries task contents", () => {
    assert.equal(isAllowedUrl("https://hooks.example.com/x"), false);
    assert.equal(isAllowedUrl("http://192.168.1.10:8000"), false);
    assert.equal(isAllowedUrl("https://127.0.0.1:8443"), false, "even loopback must be plain http by default");
    assert.equal(isAllowedUrl("ftp://127.0.0.1/"), false);
    assert.equal(isAllowedUrl("not a url"), false);
  });

  it("admits remote http(s) only with the explicit flag", () => {
    assert.equal(isAllowedUrl("https://hooks.example.com/x", true), true);
    assert.equal(isAllowedUrl("ftp://127.0.0.1/", true), false, "the flag is not a protocol free-for-all");
  });
});

describe("webhookTargets", () => {
  it("matches every event when kinds is omitted, and filters by name when given", () => {
    const p = store({ webhooks: [{ url: "http://127.0.0.1:1/a" }, { url: "http://127.0.0.1:1/b", kinds: ["done"] }] });
    assert.equal(webhookTargets({ event: "done" }, p).length, 2);
    assert.deepEqual(
      webhookTargets({ event: "comment" }, p).map((w) => w.url),
      ["http://127.0.0.1:1/a"],
    );
  });

  it("treats an empty kinds list as no filter", () => {
    const p = store({ webhooks: [{ url: "http://127.0.0.1:1/a", kinds: [] }] });
    assert.equal(webhookTargets({ event: "comment" }, p).length, 1);
  });

  it("refuses remote URLs by default and admits them with webhooksAllowRemote", () => {
    const p = store({ webhooks: [{ url: "https://hooks.example.com/x" }] });
    assert.deepEqual(webhookTargets({ event: "done" }, p), []);
    writeConfig({ webhooksAllowRemote: true }, p);
    assert.equal(webhookTargets({ event: "done" }, p).length, 1);
  });

  it("survives a malformed config", () => {
    const p = store();
    writeConfig({ webhooks: "not-an-array" }, p);
    assert.deepEqual(webhookTargets({ event: "done" }, p), []);
  });
});

describe("fanoutWebhook", () => {
  it("POSTs the exact event row to each matching webhook", async () => {
    const a = await stub();
    const b = await stub();
    const p = store({ webhooks: [{ url: a.url }, { url: b.url }] });
    const row = { ts: "2026-09-02T00:00:00.000Z", event: "done", session: "s1", actor: "tester", id: "TM-1" };
    assert.equal(fanoutWebhook(row, p).sent, 2);
    assert.ok(await arrives(() => a.hits.length === 1 && b.hits.length === 1), "both endpoints received the row");
    assert.deepEqual(a.hits[0], row);
    assert.deepEqual(b.hits[0], row);
  });

  it("never throws on an unreachable endpoint, and reports what it dispatched", async () => {
    const p = store({ webhooks: [{ url: "http://127.0.0.1:1/down" }] });
    assert.doesNotThrow(() => fanoutWebhook({ event: "done" }, p));
    assert.equal(fanoutWebhook({ event: "done" }, p).sent, 1, "dispatch is fire-and-forget — a dead endpoint still counts");
    // Give the refused connection time to settle; nothing may surface as a throw or crash.
    await new Promise((r) => setTimeout(r, 300));
  });
});

describe("logEvent fan-out (through the detached child)", () => {
  it("POSTs the exact row that landed in events.jsonl", async () => {
    const { hits, url } = await stub();
    const p = store({ webhooks: [{ url }] });
    loggedFrom(p, "comment", { id: "TM-1", text: "hello webhook" });
    assert.ok(await arrives(() => hits.length === 1), "the webhook received the event");
    assert.deepEqual(hits[0], readEvents(p).at(-1), "the POST body is the logged row — ts, session and all");
    for (const key of ["ts", "event", "session", "actor"]) {
      assert.ok(key in hits[0], `the row carries ${key} (null is a fine value — no session is set in tests)`);
    }
  });

  it("honours the kind filter through the real write path", async () => {
    const { hits, url } = await stub();
    const p = store({ webhooks: [{ url, kinds: ["done"] }] });
    loggedFrom(p, "comment", { id: "TM-1" });
    assert.equal(await arrives(() => hits.length > 0, 2000), false, "a filtered kind must not fire");
    loggedFrom(p, "done", { id: "TM-1" });
    assert.ok(await arrives(() => hits.length === 1), "the matching kind fires");
    assert.equal(hits[0].event, "done");
  });

  it("still writes the event, and returns immediately, when the endpoint is unreachable", async () => {
    const p = store({ webhooks: [{ url: "http://127.0.0.1:1/down" }] });
    const before = readEvents(p).length;
    const start = Date.now();
    assert.doesNotThrow(() => loggedFrom(p, "done", { id: "TM-2" }));
    assert.ok(Date.now() - start < 1000, "logEvent must not wait on delivery");
    assert.equal(readEvents(p).length, before + 1, "the store write is unaffected");
    // The detached child fails quietly; nothing may crash the suite process either.
    await new Promise((r) => setTimeout(r, 500));
  });
});
