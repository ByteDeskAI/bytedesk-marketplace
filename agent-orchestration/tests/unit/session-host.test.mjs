import assert from "node:assert/strict";
import { createServer } from "node:http";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { OrchestrationService } from "../../src/service.mjs";
import { git } from "../../src/util.mjs";
import { assertLoopbackBind, mintCapability, sessionMetaPath, writeSessionMeta } from "../../src/session/capability.mjs";
import { startSessionHost } from "../../src/session/host.mjs";
import { RunStore } from "../../src/state/store.mjs";

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
    blocker.listen(0, "127.0.0.1", resolve);
  });
  const busyPort = blocker.address().port;
  try {
    const host = await startSessionHost({ stateRoot, uiRoot, port: busyPort });
    assert.equal(host.bind.startsWith("127.0.0.1:"), true);
    assert.notEqual(host.port, busyPort);
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

function parseSse(text) {
  const events = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim() || block.startsWith(":")) continue;
    let id;
    let data;
    let eventType = "message";
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) id = line.slice(3).trim();
      else if (line.startsWith("event:")) eventType = line.slice(6).trim();
      else if (line.startsWith("data:")) data = JSON.parse(line.slice(5).trim());
    }
    if (data) events.push({ id, data, eventType });
  }
  return events;
}

async function collectSse(response, { until, timeoutMs = 2_000, abort }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), remaining)),
      ]);
      if (result.timeout) break;
      if (result.done) break;
      buf += decoder.decode(result.value, { stream: true });
      const events = parseSse(buf);
      if (until(events)) return { events, raw: buf };
    }
  } finally {
    abort?.abort();
  }
  throw new Error(`sse timeout: ${buf.slice(0, 500)}`);
}

async function fetchSse(host, runId, cookie, { query = "?after=0", headers = {} } = {}) {
  const abort = new AbortController();
  const response = await fetch(`http://127.0.0.1:${host.port}/api/runs/${runId}/events${query}`, {
    headers: { cookie, ...headers },
    signal: abort.signal,
  });
  return { response, abort };
}

function sessionControls(store) {
  return {
    cancel: async (runId) => {
      const run = await store.requestCancel(runId);
      if (["queued", "waiting_for_decision"].includes(run.state)) {
        return store.transition(runId, [run.state], "cancelled", {}, "cancelled_without_worker");
      }
      return run;
    },
    followUp: async (runId, message) => {
      await store.appendJournal(runId, "operator_message", { text: message });
      return { queued: true, runId };
    },
    decide: async (runId, body) => store.transition(
      runId,
      ["waiting_for_decision"],
      body.approved ? "succeeded" : "rejected",
      { decision: { state: body.approved ? "approved" : "rejected", approval: { rationale: body.rationale, by: "operator" } } },
      "decision_reviewed",
    ),
  };
}

async function liveSession(root, { withControls = false } = {}) {
  const stateRoot = join(root, "state");
  const store = await new RunStore(stateRoot).initialize();
  const run = await store.create({
    input: { intent: "review", task: "live sse", permissionProfile: "read" },
    consumer: { repositoryKey: "k", checkoutRoot: root, baseSha: "a".repeat(40) },
    plan: {
      kind: "execution_plan",
      protocolId: "architecture.adversarial.v1",
      stages: [
        { stageId: "proposal", role: "proposer", route: { selected: { providerId: "claude", modelId: "claude-fable-5" } } },
        { stageId: "critique", role: "adversary", route: { selected: { providerId: "codex", modelId: "gpt-5.6-sol" } } },
      ],
    },
    idempotencyKey: null,
  });
  const host = await startSessionHost({
    stateRoot,
    uiRoot,
    ...(withControls ? { controls: sessionControls(store) } : {}),
  });
  const cap = mintCapability();
  await writeSessionMeta(stateRoot, run.runId, {
    tokenHash: cap.tokenHash,
    expiresAt: cap.expiresAt,
    exchangedAt: null,
    hostNonce: host.hostNonce,
  });
  const exchange = await fetch(`http://127.0.0.1:${host.port}/s/${cap.token}`, { redirect: "manual" });
  const cookie = exchange.headers.get("set-cookie").split(";")[0];
  return { store, run, host, cookie };
}

test("SSE after=N returns only later events and Last-Event-ID is equivalent", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-session-sse-after-"));
  try {
    const { store, run, host, cookie } = await liveSession(root);
    await store.transition(run.runId, ["queued"], "preparing");
    await store.transition(run.runId, ["preparing"], "running");
    const after = await fetchSse(host, run.runId, cookie, { query: "?after=1" });
    assert.equal(after.response.status, 200);
    assert.match(after.response.headers.get("content-type"), /text\/event-stream/);
    const first = await collectSse(after.response, {
      until: (events) => events.some((event) => event.data.seq === 3),
      abort: after.abort,
    });
    assert.deepEqual(first.events.map((event) => event.data.seq), [2, 3]);
    assert.equal(first.events[0].id, "2");

    const lastId = await fetchSse(host, run.runId, cookie, { query: "", headers: { "Last-Event-ID": "2" } });
    const second = await collectSse(lastId.response, {
      until: (events) => events.some((event) => event.data.seq === 3),
      abort: lastId.abort,
    });
    assert.deepEqual(second.events.map((event) => event.data.seq), [3]);
    await host.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SSE returns 409 when the journal hash chain is corrupt", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-session-sse-corrupt-"));
  try {
    const { store, run, host, cookie } = await liveSession(root);
    await appendFile(store.eventsPath(run.runId), `${JSON.stringify({
      schemaVersion: 1,
      runId: run.runId,
      seq: 2,
      at: new Date().toISOString(),
      type: "state_changed",
      revision: 1,
      previousHash: "not-a-real-hash",
      payload: { from: "queued", to: "running" },
      hash: "also-not-a-real-hash",
    })}\n`);
    const response = await fetch(`http://127.0.0.1:${host.port}/api/runs/${run.runId}/events?after=0`, {
      headers: { cookie },
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, "AO_EVENT_LOG_CORRUPT");
    await host.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SSE watch delivers seq+1 after a later journal append", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-session-sse-watch-"));
  try {
    const { store, run, host, cookie } = await liveSession(root);
    const stream = await fetchSse(host, run.runId, cookie, { query: "?after=1" });
    assert.equal(stream.response.status, 200);
    const pending = collectSse(stream.response, {
      until: (events) => events.some((event) => event.data.seq === 2),
      timeoutMs: 2_000,
      abort: stream.abort,
    });
    await store.transition(run.runId, ["queued"], "preparing");
    const { events } = await pending;
    assert.equal(events.at(-1).data.seq, 2);
    assert.equal(events.at(-1).data.type, "state_changed");
    await host.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("POST controls require loopback Origin, journal follow-up, and cancel the run", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-session-controls-"));
  try {
    const { store, run, host, cookie } = await liveSession(root, { withControls: true });
    const headers = { cookie, "content-type": "application/json" };
    const followUrl = `http://127.0.0.1:${host.port}/api/runs/${run.runId}/follow-up`;
    const foreign = await fetch(followUrl, {
      method: "POST",
      headers: { ...headers, origin: "http://example.invalid" },
      body: JSON.stringify({ message: "nope" }),
    });
    assert.equal(foreign.status, 403);
    assert.equal((await foreign.json()).code, "AO_SESSION_ORIGIN");

    const queued = await fetch(followUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: "tighten the bind test" }),
    });
    assert.equal(queued.status, 202);
    assert.equal((await queued.json()).queued, true);
    const events = await store.events(run.runId);
    assert.equal(events.at(-1).type, "operator_message");
    assert.equal(events.at(-1).payload.text, "tighten the bind test");

    const cancel = await fetch(`http://127.0.0.1:${host.port}/api/runs/${run.runId}/cancel`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json()).state, "cancelled");
    await host.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("POST decision reviews a waiting architecture run", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-session-decision-"));
  try {
    const { store, run, host, cookie } = await liveSession(root, { withControls: true });
    await store.transition(run.runId, ["queued"], "waiting_for_decision");
    const response = await fetch(`http://127.0.0.1:${host.port}/api/runs/${run.runId}/decision`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ approved: false, rationale: "scope too wide" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await store.get(run.runId)).state, "rejected");
    await host.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
