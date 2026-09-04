import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";

import { pendingReplies, readJournal, recordReply, sendMessage, waitForReplies } from "../../topology/lib/mailbox.mjs";
import { adapterFor, buildArgv, loadAdapters } from "../../topology/lib/providers.mjs";
import { writeJson } from "../../topology/lib/util.mjs";

async function fakeRun() {
  const runDir = await mkdtemp(join(os.tmpdir(), "ao-topology-run-"));
  await writeJson(join(runDir, "run.json"), {
    version: 1,
    name: "t",
    run_id: "r1",
    session: "t-r1",
    sequence: 0,
    agents: [
      { id: "conductor", role: "orchestrator" },
      { id: "a", role: "worker" },
      { id: "b", role: "worker" },
    ],
  });
  return runDir;
}

test("sendMessage writes one inbox file per recipient and journals it", async () => {
  const runDir = await fakeRun();
  try {
    const message = await sendMessage({ runDir, from: "conductor", to: ["a", "b"], stage: "brief", body: "Do the thing.", contract: "x.v1", round: 1 });
    assert.equal(message.id, "001-brief");
    assert.equal(message.deliveries.length, 2);
    const inbox = await readFile(message.deliveries[0].inbox, "utf8");
    assert.match(inbox, /^---\nid: 001-brief\nfrom: conductor\nto: a\nstage: brief\nround: 1\ncontract: x.v1/);
    assert.match(inbox, /Do the thing\./);
    assert.match(inbox, /Write your complete reply to: .*001-brief\.reply\.md/);
    const pending = await pendingReplies(runDir);
    assert.deepEqual(pending.map((item) => `${item.agent}:${item.id}`), ["a:001-brief", "b:001-brief"]);
    const journal = await readJournal(runDir);
    assert.equal(journal.at(-1).type, "message.sent");
    await assert.rejects(sendMessage({ runDir, from: "conductor", to: ["ghost"], stage: "x", body: "y" }), /Unknown agent "ghost"/);
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("waitForReplies resolves when every reply file exists and times out otherwise", async () => {
  const runDir = await fakeRun();
  try {
    const message = await sendMessage({ runDir, from: "conductor", to: ["a", "b"], stage: "brief", body: "Do the thing." });
    const timeout = await waitForReplies({ runDir, agentIds: ["a", "b"], messageId: message.id, timeoutMs: 200, pollMs: 50 });
    assert.equal(timeout.ok, false);
    assert.equal(timeout.pending.length, 2);

    setTimeout(() => recordReply({ runDir, agentId: "a", messageId: message.id, body: "done a" }), 60);
    setTimeout(() => recordReply({ runDir, agentId: "b", messageId: message.id, body: "done b" }), 120);
    const result = await waitForReplies({ runDir, agentIds: ["a", "b"], messageId: message.id, timeoutMs: 5000, pollMs: 50 });
    assert.equal(result.ok, true);
    assert.deepEqual(result.replies.map((reply) => [reply.agent, reply.body.trim()]), [["a", "done a"], ["b", "done b"]]);
    const journal = await readJournal(runDir);
    assert.ok(journal.some((event) => event.type === "wait.timeout"));
    assert.ok(journal.some((event) => event.type === "message.replied" && event.from === "b"));
    assert.equal(journal.at(-1).type, "wait.satisfied");
  } finally {
    await rm(runDir, { recursive: true, force: true });
  }
});

test("adapters: unknown cli falls back to generic with the id as command; argv order is stable", async () => {
  const adapters = await loadAdapters([join(process.cwd(), "providers")]);
  assert.ok(adapters.has("claude"));
  assert.ok(adapters.has("generic"));
  const aider = adapterFor({ cli: "aider", args: ["--no-git"], skills: [] }, adapters);
  assert.equal(aider.fallback, true);
  assert.equal(aider.command, "aider");
  const claude = adapterFor({ cli: "claude", model: "opus", auto_approve: true, args: [], skills: [] }, adapters);
  const argv = buildArgv(claude, { cli: "claude", model: "opus", auto_approve: true, args: ["--verbose"], skills: [] }, { system_prompt: "SP", bootstrap_file: "/b" });
  assert.deepEqual(argv, ["claude", "--verbose", "--model", "opus", "--append-system-prompt", "SP", "--dangerously-skip-permissions"]);
});
