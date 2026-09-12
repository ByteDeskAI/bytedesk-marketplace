/**
 * The control seam a gateway can drive: a capability URL without a browser, an approval that carries
 * the name of the person who took it, and a run that records who launched it and from which terminal.
 *
 * Each of these exists because a reader outside this process had to guess otherwise: it opened a
 * browser on the wrong machine, it recorded every approval as "operator", and it matched working
 * directories to find the terminal a run came from.
 */
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { OrchestrationService } from "../../src/service.mjs";
import { createExecutionPlan } from "../../src/protocols/index.mjs";
import { launcherBinding, parentRunIdFromEnv } from "../../src/launcher.mjs";
import { git } from "../../src/util.mjs";

const execFile = promisify(execFileCallback);
const CLI = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "src", "cli.mjs");
const uiRoot = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "session-ui", "mockup");
const A_RUN_ID = "run_11111111-2222-3333-4444-555555555555";

async function fixture() {
  const root = await mkdtemp(join(os.tmpdir(), "ao-control-seam-"));
  const pluginRoot = join(root, "plugin");
  const stateRoot = join(root, "state");
  const consumerCwd = join(root, "consumer");
  await Promise.all([mkdir(pluginRoot), mkdir(stateRoot), mkdir(consumerCwd)]);
  await git(consumerCwd, ["init", "-q"]);
  await git(consumerCwd, ["config", "user.email", "agent-orchestration@test.invalid"]);
  await git(consumerCwd, ["config", "user.name", "Agent Orchestration Test"]);
  await writeFile(join(consumerCwd, "README.md"), "fixture\n");
  await git(consumerCwd, ["add", "README.md"]);
  await git(consumerCwd, ["commit", "-qm", "fixture"]);
  const service = await new OrchestrationService({ pluginRoot, stateRoot, autoRecover: false, sessionUiRoot: uiRoot }).initialize();
  service.providerAvailabilitySnapshot = async () => ({
    providers: { claude: "available", codex: "available", "grok-build": "available", kimi: "available" },
    endpoints: { "claude.fable-5": "available", "claude.opus-4-8": "available", "openai.gpt-5.6-sol": "available", "grok-build.default": "available", "kimi.default": "available" },
  });
  service.launchWorker = async () => {};
  return {
    root, stateRoot, consumerCwd, service,
    snapshot: async (runId) => JSON.parse(await readFile(join(stateRoot, "runs", runId, "snapshot.json"), "utf8")),
    cleanup: async () => {
      await service.sessionHost?.close?.().catch(() => {});
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Run a body with these variables set, and put the environment back however it ends. */
async function withEnv(overrides, body) {
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await body();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function waitingForDecision(fx) {
  const consumer = await fx.service.resolveConsumer(fx.consumerCwd);
  const plan = createExecutionPlan({ intent: "architecture" });
  let run = await fx.service.store.create({ input: { intent: "architecture", task: "fixture", permissionProfile: "read" }, consumer, plan });
  for (const [from, to] of [["queued", "preparing"], ["preparing", "running"], ["running", "verifying"]]) run = await fx.service.store.transition(run.runId, [from], to);
  const outputs = ["proposal", "critique", "revision", "decision_gate"].map((stageId) => ({ stageId, text: "{}" }));
  return fx.service.store.transition(run.runId, ["verifying"], "waiting_for_decision", { outputs, decision: { state: "waiting_for_decision", requiresHumanApproval: true } });
}

test("a launcher binding is read from the environment, and is null when nothing names one", () => {
  assert.equal(launcherBinding({}), null, "an object of nulls would read as a launcher we failed to record");
  assert.equal(launcherBinding({ PATH: "/usr/bin" }), null);

  const gateway = launcherBinding({
    BYTEDESK_EMOTE_GATEWAY_TAB_ID: "codex-CnHFbFK9GgGc",
    BYTEDESK_EMOTE_GATEWAY_TAB_SESSION: "bytedesk-emote-gateway-codex-CnHFbFK9GgGc",
    TMUX: "/tmp/tmux-1000/default,2760865,363",
    TMUX_PANE: "%619",
    AO_AGENT_ID: "worker",
    AO_AGENT_ROLE: "orchestrator",
    AO_SESSION: "tm-304-20260911-224439-pg9v",
    AO_PARENT_RUN_ID: "20260911-224439-pg9v",
    AO_PARENT_RUN_DIR: "/repo/.bytedesk/agent-orchestration/runs/20260911-224439-pg9v",
  });
  // The tab id wins the kind: it is the only one of these a gateway can jump to exactly.
  assert.equal(gateway.kind, "gateway-tab");
  assert.equal(gateway.tabId, "codex-CnHFbFK9GgGc");
  assert.equal(gateway.tmuxPane, "%619");
  assert.equal(gateway.tmuxServer, "/tmp/tmux-1000/default", "the socket, without the server pid and session id");
  assert.equal(gateway.agentRole, "orchestrator");
  assert.equal(gateway.topologyRunId, "20260911-224439-pg9v", "the conductor link: which run delegated this one");

  assert.equal(launcherBinding({ TMUX_PANE: "%7", TMUX: "/tmp/tmux-1000/default,1,2" }).kind, "tmux");
  assert.equal(launcherBinding({ AO_AGENT_ID: "lead" }).kind, "agent");
});

test("launcher labels are bounded single lines, because another program renders them", () => {
  const binding = launcherBinding({ BYTEDESK_EMOTE_GATEWAY_TAB_ID: `tab\u0007one\n${"x".repeat(500)}` });
  assert.equal(binding.tabId.includes("\u0007"), false);
  assert.equal(binding.tabId.includes("\n"), false);
  assert.equal(binding.tabId.length, 200);
  assert.equal(launcherBinding({ BYTEDESK_EMOTE_GATEWAY_TAB_ID: "   ", AO_AGENT_ID: "lead" }).tabId, null, "whitespace is not an id");
});

test("a run spawned inside a worker names that worker's run as its parent", async () => {
  assert.equal(parentRunIdFromEnv({}), null);
  assert.equal(parentRunIdFromEnv({ AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID: "not-a-run-id" }), null, "a malformed id is worse than none");
  assert.equal(parentRunIdFromEnv({ AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID: A_RUN_ID }), A_RUN_ID);
});

test("spawn records the parent run and the launcher it was started from", async () => {
  const fx = await fixture();
  try {
    const spawned = await withEnv({
      AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID: A_RUN_ID,
      BYTEDESK_EMOTE_GATEWAY_TAB_ID: "claude-abc123",
      BYTEDESK_EMOTE_GATEWAY_TAB_SESSION: "bytedesk-emote-gateway-claude-abc123",
      TMUX_PANE: "%42",
      AO_AGENT_ID: "lead",
      AO_AGENT_ROLE: "lead",
      AO_SESSION: "repo-lead",
      AO_PARENT_RUN_ID: "20260911-224439-pg9v",
      AGENT_ORCHESTRATION_OPEN_BROWSER: "0",
    }, () => fx.service.spawn({ consumerCwd: fx.consumerCwd, intent: "review", task: "Lineage fixture", permissionProfile: "read" }));

    // On disk, because the gateway reads the snapshot rather than this return value.
    const disk = await fx.snapshot(spawned.run.runId);
    assert.equal(disk.parentRunId, A_RUN_ID);
    assert.equal(disk.launcher.kind, "gateway-tab");
    assert.equal(disk.launcher.tabId, "claude-abc123");
    assert.equal(disk.launcher.tmuxPane, "%42");
    assert.equal(disk.launcher.agentId, "lead");
    assert.equal(disk.launcher.agentRole, "lead");
    assert.equal(disk.launcher.topologyRunId, "20260911-224439-pg9v");
  } finally { await fx.cleanup(); }
});

test("a run launched from nowhere identifiable says so, rather than inventing a launcher", async () => {
  const fx = await fixture();
  try {
    const spawned = await withEnv({
      AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID: undefined,
      BYTEDESK_EMOTE_GATEWAY_TAB_ID: undefined,
      BYTEDESK_EMOTE_GATEWAY_TAB_SESSION: undefined,
      TMUX: undefined,
      TMUX_PANE: undefined,
      AO_AGENT_ID: undefined,
      AO_AGENT_ROLE: undefined,
      AO_SESSION: undefined,
      AO_PARENT_RUN_ID: undefined,
      AO_PARENT_RUN_DIR: undefined,
      AGENT_ORCHESTRATION_OPEN_BROWSER: "0",
    }, () => fx.service.spawn({ consumerCwd: fx.consumerCwd, intent: "review", task: "Rootless fixture", permissionProfile: "read" }));
    const disk = await fx.snapshot(spawned.run.runId);
    assert.equal(disk.parentRunId, null);
    assert.equal(disk.launcher, null);
  } finally { await fx.cleanup(); }
});

test("session-open returns the capability URL without opening a browser", async () => {
  const fx = await fixture();
  try {
    const spawned = await withEnv({ AGENT_ORCHESTRATION_OPEN_BROWSER: "0" },
      () => fx.service.spawn({ consumerCwd: fx.consumerCwd, intent: "review", task: "Session fixture", permissionProfile: "read" }));

    // The only place a browser could be opened from is this host; a gateway operator is somewhere
    // else entirely. `opened` is the honest report, and the URL is what the caller actually needs.
    const session = await fx.service.openRunSession(spawned.run.runId, { openBrowser: false });
    assert.match(session.url, /^http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]+$/);
    assert.equal(session.opened, false);
    assert.equal(session.bind.startsWith("127.0.0.1:"), true);
    assert.equal(typeof session.expiresAt, "string");

    // Still a single exchange on loopback: the seam hands over the URL, it does not widen it.
    const exchange = await fetch(session.url, { redirect: "manual" });
    assert.equal(exchange.status, 302);
    assert.equal((await fetch(session.url, { redirect: "manual" })).status, 404, "a capability is exchanged once");
  } finally { await fx.cleanup(); }
});

test("session-open refuses a run that does not exist, before minting anything", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(() => fx.service.openRunSession(A_RUN_ID, { openBrowser: false }), { code: "AO_RUN_NOT_FOUND" });
    await assert.rejects(() => fx.service.openRunSession("not-a-run-id", { openBrowser: false }), { code: "AO_INVALID_RUN_ID" });
    await assert.rejects(() => stat(join(fx.stateRoot, "runs", A_RUN_ID, "session.json")), { code: "ENOENT" });
  } finally { await fx.cleanup(); }
});

test("a one-shot caller is refused a URL served by a host that dies with the command", async () => {
  const fx = await fixture();
  try {
    const spawned = await withEnv({ AGENT_ORCHESTRATION_OPEN_BROWSER: "0" },
      () => fx.service.spawn({ consumerCwd: fx.consumerCwd, intent: "review", task: "Durability fixture", permissionProfile: "read" }));
    // The spawn above left an in-process host: unref'd, so it exits with this process. A URL from it
    // would stop answering before the caller could use it, which is worse than an error.
    assert.equal(fx.service.sessionHost.external, false);
    await assert.rejects(
      () => fx.service.openRunSession(spawned.run.runId, { openBrowser: false, requireDurableHost: true }),
      { code: "AO_SESSION_HOST_NOT_DURABLE" },
    );
    // A host owned by another process is durable, and the same call then succeeds.
    fx.service.joinSessionHost({ port: fx.service.sessionHost.port, hostNonce: fx.service.sessionHost.hostNonce, bind: fx.service.sessionHost.bind });
    const session = await fx.service.openRunSession(spawned.run.runId, { openBrowser: false, requireDurableHost: true });
    assert.equal(session.hostExternal, true);
  } finally { await fx.cleanup(); }
});

test("an attested decision records the actor label the caller holding the capability gave", async () => {
  const fx = await fixture();
  try {
    const run = await waitingForDecision(fx);
    const decided = await fx.service.sessionDecide(run.runId, { approved: true, rationale: "reviewed in the gateway", actor: "ryan@gateway" });
    assert.equal(decided.decision.approval.by, "ryan@gateway");
    // The label is not what is attested — the channel is. A name is still a name.
    assert.equal(decided.decision.approval.by_attested, true);
    assert.equal(decided.decision.approval.via, "session");
  } finally { await fx.cleanup(); }
});

test("an actor label is optional and bounded, and never blanks the record", async () => {
  for (const [actor, expected] of [[undefined, "operator"], ["   ", "operator"], [42, "operator"], ["a\u0000b", "ab"], ["x".repeat(400), "x".repeat(120)]]) {
    const fx = await fixture();
    try {
      const run = await waitingForDecision(fx);
      const decided = await fx.service.sessionDecide(run.runId, { approved: false, rationale: "r", actor });
      assert.equal(decided.decision.approval.by, expected);
      assert.equal(decided.decision.approval.via, "session");
    } finally { await fx.cleanup(); }
  }
});

test("the session-open verb answers on stdout, as JSON or as the bare URL", async () => {
  const fx = await fixture();
  try {
    const spawned = await withEnv({ AGENT_ORCHESTRATION_OPEN_BROWSER: "0" },
      () => fx.service.spawn({ consumerCwd: fx.consumerCwd, intent: "review", task: "CLI fixture", permissionProfile: "read" }));
    // Terminal, so the command's own recovery sweep has nothing to reconcile while it runs.
    await fx.service.store.transition(spawned.run.runId, ["queued"], "failed", {}, "worker_launch_failed");
    // The fixture's in-process host holds the lease, so the command joins a host it did not start —
    // which is exactly the arrangement the durability check demands.
    const env = { ...process.env, AGENT_ORCHESTRATION_OPEN_BROWSER: "0", DISPLAY: "", WAYLAND_DISPLAY: "" };
    const args = ["session-open", "--run-id", spawned.run.runId, "--no-browser", "--state-root", fx.stateRoot];

    const asJson = await execFile(process.execPath, [CLI, ...args, "--json"], { env });
    const session = JSON.parse(asJson.stdout);
    assert.match(session.url, /^http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]+$/);
    assert.equal(session.opened, false);
    assert.equal(session.hostExternal, true);

    const asUrl = await execFile(process.execPath, [CLI, ...args], { env });
    assert.match(asUrl.stdout.trim(), /^http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]+$/);
    assert.notEqual(asUrl.stdout.trim(), session.url, "each call mints its own single-use capability");

    const missing = await execFile(process.execPath, [CLI, "session-open", "--json", "--state-root", fx.stateRoot], { env })
      .then(() => null, (error) => error);
    assert.match(missing.stderr, /--run-id is required/);
  } finally { await fx.cleanup(); }
});
