// TM-328: a spec-launched worker must be able to acknowledge the prompt launch staged for it.
// Real launch into an isolated tmux server; the fake agent runs the ack command from its own pane.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { killEnvServer } from "../helpers/isolated-tmux.mjs";
import { NO_PROVIDER } from "../helpers/temp-repo.mjs";
import { sleep, writeJson } from "../../topology/lib/util.mjs";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const cli = join(root, "topology", "cli.mjs");
const fakeAgent = join(root, "tests", "fixtures", "fake-agent.mjs");
const tmuxAvailable = await execFile("tmux", ["-V"]).then(() => true, () => false);

test("a launched worker's `prompt ack` succeeds and its prompt state becomes current", { skip: tmuxAvailable ? false : "tmux not installed" }, async (t) => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-pack-"));
  const env = { TMUX: "", AO_TMUX_COMMAND: "tmux", TMUX_TMPDIR: consumer, AO_CONSUMER: consumer, AGENT_ORCHESTRATION_STATE_HOME: join(consumer, "state"),
    AO_TRANSPORT: "file", AGENT_ORCHESTRATION_SERVICES: "0", NATS_URL: "", AO_NATS_URL: "" };
  const supervisors = async () => (await execFile("pgrep", ["-f", `supervise --consumer ${consumer}( |$)`]).catch((e) => ({ stdout: e.stdout ?? "" }))).stdout.split("\n").filter(Boolean).map(Number);
  t.after(async () => {
    for (const pid of await supervisors()) { try { process.kill(pid, "SIGTERM"); } catch {} }
    for (let i = 0; i < 50 && (await supervisors()).length; i += 1) await sleep(100);
    await killEnvServer(env);
    await rm(consumer, { recursive: true, force: true });
  });
  const specPath = join(consumer, "spec.json");
  await writeJson(specPath, { version: 1, name: "pack", session: "ao-pack-{{run_id}}", layout: "grid",
    agents: [{ id: "conductor", role: "orchestrator", cli: "fake-agent", model: "c", args: [fakeAgent] },
             { id: "worker-a", role: "worker", cli: "fake-agent", model: "w", args: [fakeAgent, "--ack-cli", cli] }],
    workflow: [{ stage: "ping", from: "conductor", to: ["worker-a"] }] });
  await writeJson(join(consumer, ".bytedesk", "agent-orchestration", "config.json"), { enabled: true, lead: { provider: NO_PROVIDER } });
  const launched = JSON.parse((await execFile(process.execPath, [cli, "launch", "--spec", specPath, "--consumer", consumer, "--providers-dir", join(root, "tests", "fixtures"), "--run-id", `pack-${process.pid}`, "--json"], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 120_000 })).stdout);
  const dir = join(launched.runDir, "agents", "worker-a");
  let ack = null;
  for (let i = 0; i < 100 && !ack; i += 1) { ack = await readFile(join(dir, "ack-result.json"), "utf8").then(JSON.parse, () => null); if (!ack) await sleep(100); }
  const state = JSON.parse(await readFile(join(dir, "prompt-state.json"), "utf8"));
  console.log("ack result:", JSON.stringify(ack));
  console.log("prompt-state:", JSON.stringify({ status: state.status, desired_session: state.desired_session, has_binding: Boolean(state.desired_binding), repo_id: state.repo_id, applied: state.applied_revision }));
  assert.ok(ack, "the fake agent never ran the ack command");
  assert.equal(ack.code, 0, ack.stderr);
  assert.equal(state.status, "current");
  assert.equal(state.applied_revision, state.desired_revision);
});
