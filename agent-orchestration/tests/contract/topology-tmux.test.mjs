// End-to-end: launch a two-agent spec into a real tmux server with fake agent CLIs, send a
// message through the mailbox, wait for the replies, and stop the session. Skips without tmux.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { writeJson } from "../../topology/lib/util.mjs";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const cli = join(root, "topology", "cli.mjs");
const fakeAgent = join(root, "tests", "fixtures", "fake-agent.mjs");

async function ao(args, env = {}) {
  const result = await execFile(process.execPath, [cli, ...args], { env: { ...process.env, ...env }, encoding: "utf8", timeout: 120_000 });
  return result.stdout;
}

const tmuxAvailable = await execFile("tmux", ["-V"]).then(() => true, () => false);

test("launch → send → wait → status → stop with fake agents in tmux", { skip: tmuxAvailable ? false : "tmux not installed" }, async () => {
  const consumer = await mkdtemp(join(os.tmpdir(), "ao-topology-e2e-"));
  const tmpSocket = `ao-test-${process.pid}`;
  const env = { AO_TMUX_COMMAND: "tmux", TMUX_TMPDIR: consumer };
  const spec = {
    version: 1,
    name: "e2e",
    session: "ao-e2e-{{run_id}}",
    layout: "grid",
    agents: [
      { id: "conductor", role: "orchestrator", cli: "fake-agent", model: "fable", args: [fakeAgent] },
      { id: "worker-a", role: "worker", cli: "fake-agent", model: "w1", args: [fakeAgent] },
      { id: "worker-b", role: "designer", cli: "fake-agent", model: "w2", args: [fakeAgent], skills: ["definitely-missing-skill"] },
    ],
    workflow: [{ stage: "ping", from: "conductor", to: ["worker-a", "worker-b"] }],
  };
  const specPath = join(consumer, "spec.json");
  await writeJson(specPath, spec);
  let runDir;
  let session;
  try {
    const launched = JSON.parse(await ao(["launch", "--spec", specPath, "--consumer", consumer, "--providers-dir", join(root, "tests", "fixtures"), "--run-id", `t-${tmpSocket}`, "--json"], env));
    runDir = launched.runDir;
    session = launched.session;
    assert.equal(launched.agents.length, 3);
    assert.ok(launched.agents.every((agent) => agent.ready), JSON.stringify(launched, null, 2));
    assert.ok(launched.warnings.some((warning) => warning.includes("definitely-missing-skill")));

    const bootstrap = await readFile(join(runDir, "agents", "worker-b", "BOOTSTRAP.md"), "utf8");
    assert.match(bootstrap, /Role: \*\*designer\*\*/);
    assert.match(bootstrap, /NOT FOUND/);
    const conductorBootstrap = await readFile(join(runDir, "agents", "conductor", "BOOTSTRAP.md"), "utf8");
    assert.match(conductorBootstrap, /## Workflow you conduct/);
    assert.match(conductorBootstrap, /\*\*ping\*\*/);

    // Give the fake agents a moment to answer READY, then check their screens.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const screen = await ao(["capture", "--run", runDir, "--agent", "worker-a", "--lines", "20"], env);
    assert.match(screen, /READY/);

    const sent = JSON.parse(await ao(["send", "--run", runDir, "--from", "conductor", "--to", "worker-a,worker-b", "--stage", "ping", "--body", "PING please"], env));
    assert.equal(sent.id, "001-ping");
    assert.ok(sent.delivered.every((item) => item.rang));

    const waited = JSON.parse(await ao(["wait", "--run", runDir, "--from", "worker-a,worker-b", "--message", "001-ping", "--timeout", "30s", "--poll", "500ms", "--json", "--quiet"], env));
    assert.equal(waited.ok, true, JSON.stringify(waited));
    assert.deepEqual(waited.replies.map((reply) => reply.agent).sort(), ["worker-a", "worker-b"]);
    assert.match(waited.replies[0].body, /saw-body: PING/);
    assert.match(waited.replies.find((reply) => reply.agent === "worker-b").body, /model: w2/);

    const status = JSON.parse(await ao(["status", "--run", runDir, "--json"], env));
    assert.equal(status.session_alive, true);
    assert.equal(status.pending_count, 0);
    assert.ok(status.agents.every((agent) => agent.alive));

    const stopped = JSON.parse(await ao(["stop", "--run", runDir], env));
    assert.equal(stopped.killed, true);
    const after = JSON.parse(await ao(["status", "--run", runDir, "--json"], env));
    assert.equal(after.session_alive, false);
    assert.equal(after.state, "stopped");
  } finally {
    if (session) await execFile("tmux", ["kill-session", "-t", session], { env: { ...process.env, ...env } }).catch(() => {});
    await rm(consumer, { recursive: true, force: true });
  }
});
