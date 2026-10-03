/** tm migrate: a COPY of a 20-task board (never the live one) round-trips into NATS with both sides counted. */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { cleanup, tempStore } from "./helpers.mjs";
import { startServer } from "./nats-helpers.mjs";
import { NatsBackend } from "../../lib/storage/nats-backend.mjs";
import { migrate } from "../../lib/storage/migrate.mjs";
import { create, list, writeConfig } from "../../lib/store.mjs";

let srv, p, cache;
before(async () => {
  srv = await startServer();
  cache = mkdtempSync(join(tmpdir(), "tm-mig-cache-"));
  process.env.TM_CACHE_DIR = cache;
  p = tempStore();
  writeConfig({ enforce: false }, p);
  const epic = create("epic", { title: "board copy" }, "the epic", p);
  for (let i = 1; i <= 20; i += 1) create("task", { title: `task ${i}`, epic: epic.id, labels: ["x"], oddField: { n: i } }, `body of ${i}\n`, p);
  create("adr", { title: "a decision" }, "why", p);
  mkdirSync(join(p.evidence, "TM-001"), { recursive: true });
  writeFileSync(join(p.evidence, "TM-001", "a.txt"), "alpha");
  writeFileSync(join(p.evidence, "TM-001", "b.txt"), "beta");
  writeFileSync(join(p.evidence, "TM-001", "dupe.txt"), "alpha"); // same bytes: one blob
});
after(async () => {
  await srv.cleanup();
  cleanup(p.root, cache);
});

describe("tm migrate", () => {
  it("--dry-run reports equal source/planned counts and writes nothing", async () => {
    const b = new NatsBackend({ repo: "mig1", url: srv.url });
    const r = await migrate({ backend: b, p, dryRun: true });
    console.log("dry-run:", JSON.stringify(r.types), JSON.stringify(r.evidence));
    assert.equal(r.types["tm/task"].source, 20);
    assert.equal(r.types["tm/task"].planned, 20);
    assert.equal(r.types["tm/epic"].source, 1);
    assert.equal(r.snapshot, null, "dry run takes no snapshot");
    assert.equal((await b.list("tm/task")).length, 0, "destination untouched");
    assert.equal((await b.blobList()).length, 0);
    assert.equal(r.evidence.sourceFiles, 3);
    assert.equal(r.evidence.sourceDistinct, 2);
    await b.close();
  });

  it("a real migrate takes one snapshot, copies, and both sides agree on count and content; re-run is a no-op", async () => {
    const b = new NatsBackend({ repo: "mig1", url: srv.url });
    const r = await migrate({ backend: b, p, dryRun: false });
    console.log("migrate:", JSON.stringify(r.types["tm/task"]), JSON.stringify(r.evidence), "snapshot:", r.snapshot, "exists:", existsSync(r.snapshot));
    assert.equal(r.ok, true);
    assert.deepEqual([r.types["tm/task"].source, r.types["tm/task"].dest, r.types["tm/task"].equal], [20, 20, true]);
    assert.deepEqual([r.evidence.sourceDistinct, r.evidence.dest, r.evidence.equal], [2, 2, true]);
    assert.ok(existsSync(r.snapshot));
    const got = await b.get("tm/task", "TM-007");
    assert.equal(got.envelope.data.title, "task 7");
    assert.deepEqual(got.envelope.data.oddField, { n: 7 }, "unknown field survived the copy");
    assert.equal(got.envelope.schema, 1);
    const again = await migrate({ backend: b, p, dryRun: false });
    assert.equal(again.types["tm/task"].written, 0);
    assert.equal(again.types["tm/task"].skipped, 20);
    // the source board is unchanged
    assert.equal(list("task", {}, p).length, 20);
    await b.close();
  });

  it("a real migrate FAILS loudly if the destination disagrees (count check can fail)", async () => {
    const b = new NatsBackend({ repo: "mig2", url: srv.url });
    const drop = async (type, id, env, o) => (id === "TM-005" ? { rev: 0 } : b.put(type, id, env, o)); // silently drops one write
    const lossy = new Proxy(b, { get: (t, k) => (k === "put" ? drop : typeof t[k] === "function" ? t[k].bind(t) : t[k]) });
    const r = await migrate({ backend: lossy, p, dryRun: false });
    console.log("lossy:", JSON.stringify(r.types["tm/task"]), "ok =", r.ok);
    assert.equal(r.ok, false);
    assert.equal(r.types["tm/task"].dest, 19);
    assert.equal(r.types["tm/task"].equal, false);
    await b.close();
  });
});
