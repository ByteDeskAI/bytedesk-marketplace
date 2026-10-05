// TM-355: MCP parity for run mail (send/reply/wait), lead status and session handoff, plus the
// run follow-up renames. Each tool is driven through a real MCP client, so the adapter, the
// identity rule (TM-356) and the ao-topology verb it runs are exercised end to end.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/mcp.mjs";
import { initTempRepo } from "../helpers/temp-repo.mjs";
import { writeJson } from "../../topology/lib/util.mjs";
import { agentsRoot } from "../../topology/lib/agents.mjs";
import { pendingLeadProbes } from "../../topology/lib/lead.mjs";

// In-process library calls (lead status) read homedir(); keep every test off the operator's home.
process.env.HOME = await mkdtemp(join(os.tmpdir(), "ao-mcp-parity-home-"));

/** A server whose session identity is `agentId` — the env is read once, when the server is made. */
async function serverAs(root, agentId, repo) {
  const saved = { AO_AGENT_ID: process.env.AO_AGENT_ID, AO_CONSUMER: process.env.AO_CONSUMER };
  Object.assign(process.env, { AO_AGENT_ID: agentId, AO_CONSUMER: repo });
  try {
    const pluginRoot = join(root, `plugin-${agentId}`);
    await mkdir(pluginRoot, { recursive: true });
    const { server } = await createServer({ pluginRoot, stateRoot: join(root, "state"), autoRecover: false });
    const client = new Client({ name: "mcp-parity", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    return { client, close: async () => { await client.close().catch(() => {}); await server.close().catch(() => {}); } };
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

async function fixture() {
  const root = await mkdtemp(join(os.tmpdir(), "ao-mcp-parity-"));
  const repo = await initTempRepo(join(root, "repo"), { commit: true });
  const runDir = join(repo, ".bytedesk", "agent-orchestration", "runs", "r1");
  await writeJson(join(runDir, "run.json"), { consumer: repo, version: 1, name: "t", run_id: "r1", session: "t-r1", sequence: 0,
    agents: [{ id: "conductor", role: "orchestrator" }, { id: "a", role: "worker" }] });
  return { root, repo, runDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const call = (client, name, args) => client.callTool({ name, arguments: args });

test("TM-355: run follow-up and run wait have new names; the old names stay as aliases", async () => {
  const fx = await fixture();
  const server = await serverAs(fx.root, "conductor", fx.repo);
  try {
    const tools = Object.fromEntries((await server.client.listTools()).tools.map((tool) => [tool.name, tool]));
    for (const name of ["orchestration_run_followup", "orchestration_run_wait", "orchestration_send", "orchestration_wait",
      "orchestration_run_mail_send", "orchestration_run_mail_reply", "orchestration_run_mail_wait", "orchestration_lead_status", "orchestration_session_handoff"]) {
      assert.ok(tools[name], `${name} is registered`);
    }
    assert.match(tools.orchestration_send.description, /alias of orchestration_run_followup/);
    assert.match(tools.orchestration_wait.description, /alias of orchestration_run_wait/);
    assert.deepEqual(tools.orchestration_send.inputSchema, tools.orchestration_run_followup.inputSchema);
    // The alias reaches the same handler: an unknown run is the same refusal under both names.
    const [renamed, alias] = await Promise.all(["orchestration_run_wait", "orchestration_wait"]
      .map((name) => call(server.client, name, { consumerCwd: fx.repo, runId: "no-such-run", timeoutMs: 10 })));
    assert.equal(renamed.isError, true);
    assert.equal(alias.structuredContent.data.code, renamed.structuredContent.data.code);
  } finally { await server.close(); await fx.cleanup(); }
});

test("TM-355: run mail send, wait and reply act as the session's own agent", async () => {
  const fx = await fixture();
  const conductor = await serverAs(fx.root, "conductor", fx.repo);
  const worker = await serverAs(fx.root, "a", fx.repo);
  try {
    const base = { consumerCwd: fx.repo, runDir: fx.runDir };
    const spoofed = await call(conductor.client, "orchestration_run_mail_send", { ...base, from: "a", to: ["a"], body: "x" });
    assert.equal(spoofed.structuredContent.data.code, "TOPOLOGY_SENDER_MISMATCH");

    const sent = await call(conductor.client, "orchestration_run_mail_send", { ...base, to: ["a"], stage: "brief", body: "Do the thing." });
    assert.equal(sent.isError, undefined, JSON.stringify(sent.structuredContent));
    const id = sent.structuredContent.data.id;
    assert.equal(id, "001-brief");
    const inbox = await readdir(join(fx.runDir, "agents", "a", "inbox"));
    assert.match(await readFile(join(fx.runDir, "agents", "a", "inbox", inbox[0]), "utf8"), /from: conductor/);

    const pending = await call(conductor.client, "orchestration_run_mail_wait", { ...base, from: ["a"], messageId: id, timeoutMs: 300, pollIntervalMs: 50 });
    assert.equal(pending.structuredContent.data.code, "TOPOLOGY_WAIT_TIMEOUT");
    assert.match(pending.structuredContent.data.message, /a:001-brief/);

    const replied = await call(worker.client, "orchestration_run_mail_reply", { ...base, messageId: id, body: "done" });
    assert.equal(replied.isError, undefined, JSON.stringify(replied.structuredContent));
    const answered = await call(conductor.client, "orchestration_run_mail_wait", { ...base, from: ["a"], messageId: id, timeoutMs: 5000 });
    assert.equal(answered.isError, undefined, JSON.stringify(answered.structuredContent));
    assert.equal(answered.structuredContent.data.replies[0].body.trim(), "done");
  } finally { await conductor.close(); await worker.close(); await fx.cleanup(); }
});

test("TM-355: lead status cached answers fast and mints no probe", async () => {
  const fx = await fixture();
  const server = await serverAs(fx.root, "conductor", fx.repo);
  try {
    const started = Date.now();
    const status = await call(server.client, "orchestration_lead_status", { consumerCwd: fx.repo, cached: true });
    assert.equal(status.isError, undefined, JSON.stringify(status.structuredContent));
    assert.ok(Date.now() - started < 1000, "cached lead status returns in under a second");
    assert.ok("recovery" in status.structuredContent.data);
    assert.deepEqual(await pendingLeadProbes({ consumer: fx.repo, env: { AO_AGENT_ID: "conductor" } }), []);
  } finally { await server.close(); await fx.cleanup(); }
});

test("TM-355: session handoff runs the session handoff verb", async () => {
  const fx = await fixture();
  const server = await serverAs(fx.root, "conductor", fx.repo);
  try {
    await writeJson(join(agentsRoot(fx.repo), "worker01", "agent.json"), { id: "worker01", role: "worker", full_name: "worker01" });
    const file = join(fx.root, "handoff.md");
    await writeFile(file, "# handoff\n");
    const missing = await call(server.client, "orchestration_session_handoff", { consumerCwd: fx.repo, agent: "worker01", file: join(fx.root, "nope.md") });
    assert.equal(missing.structuredContent.data.code, "TOPOLOGY_HANDOFF_FILE_MISSING");
    const notLive = await call(server.client, "orchestration_session_handoff", { consumerCwd: fx.repo, agent: "worker01", file });
    assert.equal(notLive.structuredContent.data.code, "TOPOLOGY_AGENT_NOT_LIVE");
  } finally { await server.close(); await fx.cleanup(); }
});
