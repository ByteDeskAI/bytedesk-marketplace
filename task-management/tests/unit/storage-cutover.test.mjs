/** Plan + event-history migration (re-runnable) and `tm cutover`, on temp copies of a board only. */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import { startServer } from "./nats-helpers.mjs";
import { NatsBackend } from "../../lib/storage/nats-backend.mjs";
import { migrate } from "../../lib/storage/migrate.mjs";
import { cutover } from "../../lib/storage/cutover.mjs";
import { repoAliases, repoKey, storageKind } from "../../lib/storage/index.mjs";
import { create, readEvents, writeConfig } from "../../lib/store.mjs";

const TM = fileURLToPath(new URL("../../bin/tm", import.meta.url));
let srv, cache, boards = [];

const board = (tasks = 20) => {
  const p = tempStore();
  boards.push(p.root);
  writeConfig({ enforce: false, requireEpic: false, requireAcceptance: false }, p);
  const epic = create("epic", { title: "copy" }, "e", p);
  for (let i = 1; i <= tasks; i += 1) create("task", { title: `task ${i}`, epic: epic.id }, `body ${i}\n`, p);
  mkdirSync(p.plans, { recursive: true });
  writeFileSync(join(p.plans, "2026-01-01-alpha.md"), "# alpha\n");
  writeFileSync(join(p.plans, "2026-01-02-beta.plan.json"), '{"plan":"beta"}');
  return p;
};
const backendFor = (p, o = {}) => new NatsBackend({ repo: repoKey(p), aliases: repoAliases(p), url: srv.url, ...o });

before(async () => {
  srv = await startServer();
  cache = mkdtempSync(join(tmpdir(), "tm-cut-cache-"));
  process.env.TM_CACHE_DIR = cache;
});
after(async () => {
  await srv.cleanup();
  cleanup(cache, ...boards);
});

describe("migrate: plans and event history", () => {
  it("copies plans, and publishes the event history once — a second run leaves the stream count unchanged", async () => {
    const p = board();
    const b = backendFor(p);
    const sourceEvents = readEvents(p).length;
    const r1 = await migrate({ backend: b, p });
    const r2 = await migrate({ backend: b, p });
    console.log("source events on disk:", sourceEvents);
    console.log("run 1: plans", JSON.stringify(r1.types["tm/plan"]), "| events", JSON.stringify(r1.events));
    console.log("run 2: plans", JSON.stringify(r2.types["tm/plan"]), "| events", JSON.stringify(r2.events));
    assert.equal(r1.ok && r2.ok, true);
    assert.deepEqual([r1.types["tm/plan"].source, r1.types["tm/plan"].dest], [2, 2]);
    assert.equal((await b.get("tm/plan", "2026-01-02-beta.plan.json")).envelope.data.text, '{"plan":"beta"}');
    assert.equal(r1.events.published, r1.events.sourceDistinct);
    assert.ok(r1.events.sourceDistinct > 20);
    assert.equal(r2.events.published, 0, "nothing re-published");
    assert.equal(r1.events.streamCount, r2.events.streamCount, "stream count identical after the second run");
    assert.equal(r2.events.streamCount, r1.events.sourceDistinct);
    await b.close();
  });
});

describe("cutover", () => {
  it("--dry-run changes nothing: config untouched, nothing written", async () => {
    const p = board(5);
    const b = backendFor(p);
    const v = await cutover({ backend: b, p, dryRun: true });
    console.log("dry run:", JSON.stringify({ wouldSwitch: v.wouldSwitch, switched: v.switched, tasks: v.types["tm/task"] }), "| storage kind =", storageKind(p));
    assert.equal(v.wouldSwitch, true);
    assert.equal(v.switched, false);
    assert.equal(storageKind(p), "file");
    assert.equal((await b.list("tm/task")).length, 0);
    await b.close();
  });

  it("REFUSES when the destination disagrees, and leaves storage.backend alone", async () => {
    const p = board(5);
    const real = backendFor(p);
    const drop = async (type, id, env, o) => (id === "TM-003" ? { rev: 0 } : real.put(type, id, env, o));
    const lossy = new Proxy(real, { get: (t, k) => (k === "put" ? drop : typeof t[k] === "function" ? t[k].bind(t) : t[k]) });
    const v = await cutover({ backend: lossy, p });
    console.log("lossy cutover:", JSON.stringify({ switched: v.switched, refused: v.refused, tasks: v.types["tm/task"] }), "| storage kind =", storageKind(p));
    assert.equal(v.switched, false);
    assert.match(v.refused, /count check failed/);
    assert.equal(storageKind(p), "file");
    await real.close();
  });

  it("switches when both sides are equal, and tm then reads the board from NATS", async () => {
    const p = board(5);
    const env = { ...process.env, TM_ROOT: p.root, TM_NATS_URL: srv.url, TM_CACHE_DIR: cache };
    delete env.TM_STORAGE;
    for (const k of Object.keys(env)) if (/^NATS_/.test(k)) delete env[k];
    const tm = (...a) => spawnSync("node", [TM, ...a], { env, encoding: "utf8", timeout: 60_000 });
    const dry = tm("cutover", "--dry-run");
    console.log("tm cutover --dry-run:", dry.status, dry.stdout.trim().split("\n").slice(-1)[0]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(JSON.parse(readFileSync(p.config, "utf8")).storage?.backend, undefined, "dry run did not touch config");
    const real = tm("cutover");
    console.log("tm cutover:", real.status, real.stdout.trim().split("\n").slice(-4).join(" | "));
    assert.equal(real.status, 0, real.stderr + real.stdout);
    assert.equal(JSON.parse(readFileSync(p.config, "utf8")).storage.backend, "nats");
    const b = tm("board");
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /task 3/);
    assert.doesNotMatch(b.stderr, /offline/);
    // writes now land in NATS, not in the markdown directory
    const made = tm("task", "new", "after cutover");
    assert.equal(made.status, 0, made.stderr);
    const nb = backendFor(p);
    const titles = (await nb.list("tm/task")).map((e) => e.envelope.data.title);
    console.log("titles on the server:", JSON.stringify(titles));
    assert.ok(titles.includes("after cutover"));
    assert.equal(titles.length, 6);
    await nb.close();
  });
});
