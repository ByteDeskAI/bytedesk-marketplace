import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { OrchestrationService } from "../../src/service.mjs";
import { git } from "../../src/util.mjs";
import { assertLoopbackBind, mintCapability, sessionMetaPath } from "../../src/session/capability.mjs";
import { startSessionHost } from "../../src/session/host.mjs";

const uiRoot = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "session-ui", "mockup");

async function repo(root) {
  const consumerCwd = join(root, "consumer");
  await mkdir(consumerCwd);
  await git(consumerCwd, ["init", "-q"]);
  await git(consumerCwd, ["config", "user.email", "agent-orchestration@test.invalid"]);
  await git(consumerCwd, ["config", "user.name", "Agent Orchestration Test"]);
  await writeFile(join(consumerCwd, "README.md"), "fixture\n");
  await git(consumerCwd, ["add", "README.md"]);
  await git(consumerCwd, ["commit", "-qm", "fixture"]);
  return consumerCwd;
}

test("session host refuses non-loopback binds", () => {
  assert.throws(() => assertLoopbackBind("0.0.0.0"), { code: "AO_SESSION_BIND" });
  assert.throws(() => assertLoopbackBind("::"), { code: "AO_SESSION_BIND" });
  assert.doesNotThrow(() => assertLoopbackBind("127.0.0.1"));
});

test("session host binds 127.0.0.1, walks a busy port, and exchanges a one-time capability", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-session-host-"));
  const stateRoot = join(root, "state");
  const blocker = createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(45_000, "127.0.0.1", resolve);
  });
  try {
    const host = await startSessionHost({ stateRoot, uiRoot, port: 45_000 });
    assert.equal(host.bind.startsWith("127.0.0.1:"), true);
    assert.notEqual(host.port, 45_000);
    const health = await fetch(`http://127.0.0.1:${host.port}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).hostNonce, host.hostNonce);

    const runId = "run_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    await mkdir(join(stateRoot, "runs", runId), { recursive: true, mode: 0o700 });
    await writeFile(join(stateRoot, "runs", runId, "snapshot.json"), `${JSON.stringify({
      schemaVersion: 1, runId, revision: 0, state: "running", input: { intent: "review", task: "t", permissionProfile: "read" },
      consumer: { repositoryKey: "k" }, plan: { stages: [] }, sessions: [], outputs: [],
    }, null, 2)}\n`, { mode: 0o600 });
    const cap = mintCapability();
    const { writeSessionMeta } = await import("../../src/session/capability.mjs");
    await writeSessionMeta(stateRoot, runId, { tokenHash: cap.tokenHash, expiresAt: cap.expiresAt, exchangedAt: null, hostNonce: host.hostNonce });

    const first = await fetch(`http://127.0.0.1:${host.port}/s/${cap.token}`, { redirect: "manual" });
    assert.equal(first.status, 302);
    assert.equal(first.headers.get("location"), `/runs/${runId}`);
    const cookie = first.headers.get("set-cookie");
    assert.match(cookie, /ao_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);

    const second = await fetch(`http://127.0.0.1:${host.port}/s/${cap.token}`, { redirect: "manual" });
    assert.equal(second.status, 404);

    const page = await fetch(`http://127.0.0.1:${host.port}/runs/${runId}`, { headers: { cookie: cookie.split(";")[0] } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /id="app"/);

    const snap = await fetch(`http://127.0.0.1:${host.port}/api/runs/${runId}/snapshot`, { headers: { cookie: cookie.split(";")[0] } });
    const body = await snap.json();
    assert.equal(body.runId, runId);
    assert.equal(body.session, undefined);
    const meta = JSON.parse(await readFile(sessionMetaPath(stateRoot, runId), "utf8"));
    assert.equal(typeof meta.tokenHash, "string");
    assert.equal(JSON.stringify(meta).includes(cap.token), false);
    await host.close();
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("spawn returns a session URL that is not stored on the snapshot", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-session-spawn-"));
  const pluginRoot = join(root, "plugin");
  const stateRoot = join(root, "state");
  await mkdir(pluginRoot);
  await mkdir(stateRoot);
  const consumerCwd = await repo(root);
  const service = await new OrchestrationService({
    pluginRoot,
    stateRoot,
    autoRecover: false,
    sessionUiRoot: uiRoot,
  }).initialize();
  service.providerAvailabilitySnapshot = async () => ({
    providers: { claude: "available", codex: "available", "grok-build": "available", kimi: "available" },
    endpoints: { "claude.fable-5": "available", "claude.opus-4-8": "available", "openai.gpt-5.6-sol": "available", "grok-build.default": "available", "kimi.default": "available" },
  });
  service.launchWorker = async () => {};
  const previous = process.env.AGENT_ORCHESTRATION_OPEN_BROWSER;
  process.env.AGENT_ORCHESTRATION_OPEN_BROWSER = "0";
  try {
    const result = await service.spawn({ consumerCwd, intent: "review", task: "Session fixture", permissionProfile: "read" });
    assert.match(result.session.url, /^http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]+$/);
    assert.equal(result.session.bind.startsWith("127.0.0.1:"), true);
    const disk = JSON.parse(await readFile(join(stateRoot, "runs", result.run.runId, "snapshot.json"), "utf8"));
    assert.equal(disk.session, undefined);
    assert.equal(JSON.stringify(disk).includes(result.session.url.split("/s/")[1]), false);
    const exchange = await fetch(result.session.url, { redirect: "manual" });
    assert.equal(exchange.status, 302);
    await service.sessionHost.close();
  } finally {
    process.env.AGENT_ORCHESTRATION_OPEN_BROWSER = previous;
    await rm(root, { recursive: true, force: true });
  }
});
