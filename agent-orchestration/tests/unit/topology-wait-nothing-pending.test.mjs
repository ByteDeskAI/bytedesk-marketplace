// TM-327: a barrier with nothing to wait for must refuse, not succeed with zero replies.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readJournal, recordReply, sendMessage, waitForReplies } from "../../topology/lib/mailbox.mjs";
import { writeJson } from "../../topology/lib/util.mjs";

const cli = fileURLToPath(new URL("../../topology/cli.mjs", import.meta.url));

async function fakeRun() {
  const runDir = await mkdtemp(join(os.tmpdir(), "ao-wait-np-"));
  await writeJson(join(runDir, "run.json"), {
    consumer: runDir, version: 1, name: "t", run_id: "r1", session: "t-r1", sequence: 0,
    agents: [{ id: "conductor", role: "orchestrator" }, { id: "a", role: "worker" }],
  });
  return runDir;
}

test("wait on an unknown message id refuses with TOPOLOGY_NOTHING_PENDING and journals no wait.satisfied", async () => {
  const runDir = await fakeRun();
  try {
    const result = await waitForReplies({ runDir, agentIds: ["a"], messageId: "999-ghost", timeoutMs: 200, pollMs: 20 });
    console.log("library result:", JSON.stringify(result));
    assert.equal(result.ok, false);
    assert.equal(result.code, "TOPOLOGY_NOTHING_PENDING");
    assert.ok(!(await readJournal(runDir)).some((e) => e.type === "wait.satisfied"));

    // The no-id barrier over a run with no obligations at all is the same refusal.
    const empty = await waitForReplies({ runDir, timeoutMs: 200, pollMs: 20 });
    assert.equal(empty.code, "TOPOLOGY_NOTHING_PENDING");

    const env = { ...process.env, AO_TRANSPORT: "file", AGENT_ORCHESTRATION_SERVICES: "0", NATS_URL: "", AO_NATS_URL: "" };
    const cliRun = spawnSync(process.execPath, [cli, "wait", "--run", runDir, "--message", "999-ghost", "--timeout", "1s", "--json"], { env, encoding: "utf8" });
    console.log("cli exit:", cliRun.status, cliRun.stdout.trim());
    assert.notEqual(cliRun.status, 0);
    assert.match(cliRun.stdout, /TOPOLOGY_NOTHING_PENDING/);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});

test("real pending and already-answered messages keep their behaviour", async () => {
  const runDir = await fakeRun();
  try {
    const m = await sendMessage({ runDir, fromProject: runDir, from: "conductor", to: ["a"], stage: "brief", body: "x" });
    const pending = await waitForReplies({ runDir, agentIds: ["a"], messageId: m.id, timeoutMs: 100, pollMs: 20 });
    assert.equal(pending.ok, false);
    assert.equal(pending.pending.length, 1);
    assert.equal(pending.code, undefined);
    await recordReply({ runDir, agentId: "a", messageId: m.id, body: "done" });
    const done = await waitForReplies({ runDir, agentIds: ["a"], messageId: m.id, timeoutMs: 1000, pollMs: 20 });
    assert.equal(done.ok, true);
    assert.equal(done.replies.length, 1);
  } finally { await rm(runDir, { recursive: true, force: true }); }
});
