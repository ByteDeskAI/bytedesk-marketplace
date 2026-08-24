import assert from "node:assert/strict";
import { access, appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunStore } from "../../src/state/store.mjs";

function input() {
  return {
    input: { task: "test", intent: "review", permissionProfile: "read" },
    consumer: { repositoryKey: "repo", checkoutRoot: "/fixture", baseSha: "a".repeat(40) },
    plan: { protocol: "single.v1", stages: [] },
    idempotencyKey: "same-request",
  };
}

test("idempotency keys return one durable run", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    const runs = await Promise.all(Array.from({ length: 8 }, () => store.create(input())));
    assert.equal(new Set(runs.map((run) => run.runId)).size, 1);
    assert.equal((await store.list()).length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("run IDs cannot traverse outside the state root", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    await assert.rejects(() => store.get("../../foreign"), { code: "AO_INVALID_RUN_ID" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a torn final event is ignored but prior hashes remain verified", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    const run = await store.create({ ...input(), idempotencyKey: null });
    await appendFile(store.eventsPath(run.runId), "{\"torn\":");
    const events = await store.events(run.runId);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "run_created");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("events are sequenced and terminal states are immutable", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    let run = await store.create({ ...input(), idempotencyKey: null });
    run = await store.transition(run.runId, ["queued"], "preparing");
    run = await store.transition(run.runId, ["preparing"], "failed", { error: { code: "fixture" } });
    const events = await store.events(run.runId);
    assert.deepEqual(events.map((event) => event.seq), [1, 2, 3]);
    assert.equal(events[1].previousHash, events[0].hash);
    await assert.rejects(() => store.transition(run.runId, ["failed"], "running"), { code: "AO_TERMINAL_RUN" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("operator_message events append to the verified hash chain", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    const run = await store.create({ ...input(), idempotencyKey: null });
    await store.appendJournal(run.runId, "operator_message", { text: "tighten the bind test" });
    const events = await store.events(run.runId);
    assert.equal(events.at(-1).type, "operator_message");
    assert.equal(events.at(-1).payload.text, "tighten the bind test");
    assert.equal(events.at(-1).previousHash, events[0].hash);
    assert.equal(events.at(-1).seq, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cancel requests are idempotent", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    const run = await store.create({ ...input(), idempotencyKey: null });
    const first = await store.requestCancel(run.runId);
    const second = await store.requestCancel(run.runId);
    assert.equal(first.cancelRequestedAt, second.cancelRequestedAt);
    assert.equal(first.revision, second.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the durable journal repairs a stale snapshot after an interrupted commit", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    const created = await store.create({ ...input(), idempotencyKey: null });
    const transitioned = await store.transition(created.runId, ["queued"], "preparing");
    await writeFile(store.snapshotPath(created.runId), `${JSON.stringify(created)}\n`);
    const recovered = await store.get(created.runId);
    assert.equal(recovered.state, "preparing");
    assert.equal(recovered.revision, transitioned.revision);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generic updates cannot mutate lifecycle or identity fields", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    const run = await store.create({ ...input(), idempotencyKey: null });
    await assert.rejects(() => store.update(run.runId, { state: "succeeded" }), { code: "AO_IMMUTABLE_RUN_FIELD" });
    await assert.rejects(() => store.update(run.runId, { consumer: { repositoryKey: "foreign" } }), { code: "AO_IMMUTABLE_RUN_FIELD" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("generic updates reject terminal evidence changes while clearWorkspace is narrow and idempotent", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    let run = await store.create({ ...input(), idempotencyKey: null });
    run = await store.update(run.runId, { workspace: { path: "/fixture/worktree" } }, "workspace_created");
    await assert.rejects(() => store.clearWorkspace(run.runId), { code: "AO_RUN_NOT_TERMINAL" });
    run = await store.transition(run.runId, ["queued"], "failed", { error: { code: "fixture" } });
    await assert.rejects(() => store.update(run.runId, { outputs: [{ text: "late" }] }), { code: "AO_TERMINAL_RUN" });

    const cleared = await store.clearWorkspace(run.runId);
    assert.equal(cleared.workspace, null);
    assert.equal(typeof cleared.cleanup.workspaceRemovedAt, "string");
    const repeated = await store.clearWorkspace(run.runId);
    assert.equal(repeated.revision, cleared.revision);
    assert.equal((await store.events(run.runId)).at(-1).type, "workspace_removed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("list fails closed when a valid run directory contains a corrupt journal", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    const run = await store.create({ ...input(), idempotencyKey: null });
    await appendFile(store.eventsPath(run.runId), "{\"not\":\"a valid chained event\"}\n");
    await mkdir(join(root, "runs", "not-a-run"));
    await assert.rejects(() => store.list(), { code: "AO_EVENT_LOG_CORRUPT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an empty or malformed stale primary lock is reclaimed under the breaker", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    const old = new Date(Date.now() - 5_000);
    for (const [key, contents] of [["empty", ""], ["malformed", "{\"pid\":"]]) {
      const lockPath = store.lockPath(key);
      await writeFile(lockPath, contents);
      await utimes(lockPath, old, old);
      assert.equal(await store.tryBreakStaleLock(lockPath), true);
      await assert.rejects(() => access(lockPath));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an abandoned breaker can be reclaimed before breaking a stale lock", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-test-"));
  try {
    const store = await new RunStore(root).initialize();
    const lockPath = store.lockPath("fixture");
    const old = new Date(Date.now() - 5_000);
    await writeFile(lockPath, JSON.stringify({ pid: 99999999, nonce: "stale", startIdentity: "dead", at: old.toISOString() }));
    await writeFile(`${lockPath}.breaker`, "");
    await utimes(`${lockPath}.breaker`, old, old);
    assert.equal(await store.tryBreakStaleLock(lockPath), false);
    assert.equal(await store.tryBreakStaleLock(lockPath), true);
    await assert.rejects(() => access(lockPath));
  } finally { await rm(root, { recursive: true, force: true }); }
});
