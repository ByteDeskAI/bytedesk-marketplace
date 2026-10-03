/**
 * The modules that used to touch files directly, now with TM_STORAGE=nats in-process:
 * evidence, plans, goal-import rollback, readEvents, doctor, and the repo-key alias.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { startServer } from "./nats-helpers.mjs";
import { NatsBackend } from "../../lib/storage/nats-backend.mjs";
import { repoAliases, repoKey, storageInfo } from "../../lib/storage/index.mjs";
import { attachEvidence, listEvidence } from "../../lib/evidence.mjs";
import { capturePlan, listPlans } from "../../lib/plans.mjs";
import { diagnose } from "../../lib/doctor.mjs";
import { create, list, logEvent, read, readEvents, removeEntity, writeConfig } from "../../lib/store.mjs";
import { encode } from "../../lib/storage/registry.mjs";

let srv, p, cache, scratch, direct;
before(async () => {
  srv = await startServer();
  cache = mkdtempSync(join(tmpdir(), "tm-route-cache-"));
  scratch = mkdtempSync(join(tmpdir(), "tm-route-scratch-"));
  p = tempStore();
  writeConfig({ enforce: false, requireEpic: false, requireAcceptance: false }, p);
  Object.assign(process.env, { TM_STORAGE: "nats", TM_NATS_URL: srv.url, TM_CACHE_DIR: cache });
  direct = new NatsBackend({ repo: repoKey(p), url: srv.url });
});
after(async () => {
  delete process.env.TM_STORAGE;
  delete process.env.TM_NATS_URL;
  delete process.env.TM_CACHE_DIR;
  await direct.close();
  await srv.cleanup();
  cleanup(p.root, cache, scratch);
});

describe("modules routed through the backend", () => {
  it("evidence: bytes go to TM_EVIDENCE; a missing working copy is restored from the blob", async () => {
    const t = create("task", { title: "with evidence" }, "b", p);
    const { dest, ref, provenance } = attachEvidence(t.id, { content: "the proof" }, p);
    const blob = await direct.blobGet(provenance.sha256);
    console.log("evidence: ref", ref, "sha", provenance.sha256.slice(0, 12), "blob =", JSON.stringify(blob?.toString()));
    assert.equal(blob.toString(), "the proof");
    unlinkSync(dest);
    assert.equal(existsSync(dest), false);
    const listed = listEvidence(read(t.id, p), p);
    console.log("after deleting the file, listEvidence says exists =", listed[0].exists);
    assert.equal(listed[0].exists, true);
    assert.equal(existsSync(dest), true, "working copy restored from the blob");
  });

  it("plans: capture stores a tm/plan entity; a missing file is restored from it", async () => {
    const src = join(scratch, "my-plan.md");
    writeFileSync(src, "# Ship the thing\n\nsteps\n");
    const got = capturePlan({ tool_input: { file_path: src } }, p, { claudePlans: scratch });
    const entity = await direct.get("tm/plan", got.dest.split("/").pop());
    console.log("plan entity:", JSON.stringify({ id: entity.envelope.id, text: entity.envelope.data.text }));
    assert.match(entity.envelope.data.text, /Ship the thing/);
    unlinkSync(got.dest);
    const plans = listPlans(p);
    console.log("listPlans after deleting the file:", JSON.stringify(plans.map((x) => [x.name, x.exists])));
    assert.equal(plans.length, 1);
    assert.equal(plans[0].exists, true);
  });

  it("goal-import rollback: removeEntity deletes from the backend, not from a directory", async () => {
    const t = create("task", { title: "to roll back" }, "b", p);
    assert.ok(read(t.id, p));
    removeEntity(t.id, p);
    assert.equal(read(t.id, p), null);
    assert.equal(list("task", {}, p).some((x) => x.id === t.id), false);
  });

  it("readEvents reads the backend: an event appended by another machine is visible", async () => {
    logEvent("local_probe", { n: 1 }, p);
    await direct.appendEvent({ event: "remote_probe", n: 2, session: "other-machine" });
    const names = readEvents(p).map((e) => e.event);
    console.log("readEvents has local_probe:", names.includes("local_probe"), "remote_probe:", names.includes("remote_probe"));
    assert.ok(names.includes("local_probe"), "logEvent and readEvents are symmetric");
    assert.ok(names.includes("remote_probe"), "and the stream, not the local file, is what is read");
  });

  it("doctor: reports the backend and server, has no file-store findings, and flags an unreachable server", async () => {
    const info = storageInfo(p);
    console.log("storageInfo:", JSON.stringify(info));
    assert.equal(info.kind, "nats");
    assert.equal(info.server, srv.url);
    const codes = diagnose(p).map((f) => f.code);
    assert.ok(!codes.includes("index-drift") && !codes.includes("duplicate-id"), `file-store findings leaked: ${codes}`);
    await srv.stop();
    const down = diagnose(p).map((f) => f.code);
    console.log("doctor with the server down:", JSON.stringify(down));
    assert.ok(down.includes("storage-offline"));
    srv = await srv.restart();
  });

  it("repo key alias: a board created under the old path-based key still resolves", async () => {
    const old_ = tempStore(); // a board whose only data sits under the old path-based key
    try {
      const [alias] = repoAliases(old_);
      assert.notEqual(alias, repoKey(old_));
      const old = new NatsBackend({ repo: alias, url: srv.url });
      await old.create("tm/task", "TM-900", encode("tm/task", { id: "TM-900", title: "created under the old key" }));
      const hit = read("TM-900", old_);
      console.log(`primary ${repoKey(old_)} has nothing, alias ${alias} has TM-900: store read ->`, JSON.stringify(hit?.title));
      assert.equal(hit?.title, "created under the old key");
      // writes follow the key that holds the board, so the board stays in one place
      create("task", { title: "new on old board" }, "b", old_);
      assert.equal((await old.list("tm/task")).length, 2);
      await old.close();
    } finally {
      cleanup(old_.root);
    }
  });
});
