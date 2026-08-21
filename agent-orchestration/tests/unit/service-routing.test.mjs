import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OrchestrationService, discoverProviderPaths, externalProviderPaths } from "../../src/service.mjs";
import { createExecutionPlan } from "../../src/protocols/index.mjs";
import { git } from "../../src/util.mjs";

async function fixture() {
  const root = await mkdtemp(join(os.tmpdir(), "ao-service-test-"));
  const consumerCwd = join(root, "consumer");
  const pluginRoot = join(root, "plugin");
  const stateRoot = join(root, "state");
  await Promise.all([mkdir(consumerCwd), mkdir(pluginRoot), mkdir(stateRoot)]);
  await git(consumerCwd, ["init", "-q"]);
  await git(consumerCwd, ["config", "user.email", "agent-orchestration@test.invalid"]);
  await git(consumerCwd, ["config", "user.name", "Agent Orchestration Test"]);
  await writeFile(join(consumerCwd, "README.md"), "fixture\n");
  await git(consumerCwd, ["add", "README.md"]);
  await git(consumerCwd, ["commit", "-qm", "fixture"]);
  const service = await new OrchestrationService({ pluginRoot, stateRoot }).initialize();
  return { root, consumerCwd, service, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const allAvailable = {
  providers: { claude: "available", codex: "available", "grok-build": "available", kimi: "available" },
  endpoints: { "claude.fable-5": "available", "claude.opus-4-8": "available", "openai.gpt-5.6-sol": "available", "grok-build.default": "available", "kimi.default": "available" },
};

test("provider executable discovery excludes plugin-local binaries and aliases", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-provider-path-test-"));
  const pluginRoot = join(root, "plugin");
  const localBinary = join(pluginRoot, "node_modules", ".bin", "codex");
  const externalBinary = join(root, "external-codex");
  const externalAliasToLocal = join(root, "aliased-local-codex");
  try {
    await mkdir(join(pluginRoot, "node_modules", ".bin"), { recursive: true });
    await Promise.all([writeFile(localBinary, "local\n"), writeFile(externalBinary, "external\n")]);
    await symlink(localBinary, externalAliasToLocal);
    assert.deepEqual(
      await externalProviderPaths(pluginRoot, [localBinary, externalAliasToLocal, externalBinary], [root]),
      [externalBinary],
    );
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("provider executable discovery resolves a trusted target when PATH contains only a shim", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-provider-resolver-test-"));
  const pluginRoot = join(root, "plugin");
  const trustedRoot = join(root, "trusted");
  const shimRoot = join(root, "shims");
  const shim = join(shimRoot, "codex");
  const target = join(trustedRoot, "codex.js");
  const resolver = join(root, "volta");
  try {
    await Promise.all([mkdir(pluginRoot), mkdir(trustedRoot), mkdir(shimRoot)]);
    await Promise.all([writeFile(shim, "shim\n"), writeFile(target, "codex\n"), writeFile(resolver, "resolver\n")]);
    const adapter = {
      executableRoots: [trustedRoot],
      candidateResolvers: [{ executable: resolver, args: ["which", "codex"] }],
    };
    const paths = await discoverProviderPaths(pluginRoot, adapter, [shim], async (executable, args) => {
      assert.equal(executable, resolver);
      assert.deepEqual(args, ["which", "codex"]);
      return { stdout: `${target}\n` };
    });
    assert.deepEqual(paths, [target]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("run authority does not cross linked consumer worktrees", async () => {
  const fx = await fixture();
  const sibling = join(fx.root, "consumer-sibling");
  try {
    await git(fx.consumerCwd, ["worktree", "add", "--detach", "--", sibling, "HEAD"]);
    const consumer = await fx.service.resolveConsumer(fx.consumerCwd, false);
    const run = await fx.service.store.create({
      input: { task: "fixture", intent: "review", permissionProfile: "read" },
      consumer,
      plan: { protocolId: "single.v1", stages: [] },
    });
    await assert.rejects(
      () => fx.service.getRun({ consumerCwd: sibling, runId: run.runId }),
      { code: "AO_RUN_REPOSITORY_MISMATCH" },
    );
    assert.deepEqual(await fx.service.list({ consumerCwd: sibling }), []);
  } finally { await fx.cleanup(); }
});

test("request semantics dynamically route design, implementation, research, and large context", async () => {
  const fx = await fixture();
  try {
    const design = await fx.service.route({ consumerCwd: fx.consumerCwd, intent: "design", task: "Design a UI" });
    assert.equal(design.decision.selected.providerId, "claude");
    assert.equal(design.decision.selected.modelId, "claude-fable-5");
    assert.equal(design.decision.selected.effort, "high");

    const implementation = await fx.service.route({ consumerCwd: fx.consumerCwd, intent: "implementation", task: "Implement API", risk: "critical" });
    assert.equal(implementation.decision.selected.providerId, "codex");
    assert.equal(implementation.decision.selected.modelId, "gpt-5.6-sol");
    assert.equal(implementation.decision.selected.effort, "max");

    const research = await fx.service.route({ consumerCwd: fx.consumerCwd, intent: "research", task: "Research current ecosystem" });
    assert.equal(research.decision.selected.providerId, "grok-build");

    const largeContext = await fx.service.route({ consumerCwd: fx.consumerCwd, intent: "general", task: "Analyze a very large context", requiredCapabilities: ["large_context"] });
    assert.equal(largeContext.decision.selected.providerId, "kimi");
  } finally { await fx.cleanup(); }
});

test("architecture is a max-effort Claude and Sol adversarial protocol", async () => {
  const fx = await fixture();
  try {
    const { plan } = await fx.service.plan({ consumerCwd: fx.consumerCwd, intent: "architecture", task: "Choose a durable orchestration design", permissionProfile: "read" });
    assert.equal(plan.protocolId, "architecture.adversarial.v1");
    assert.equal(plan.stages[0].route.selected.providerId, "claude");
    assert.equal(plan.stages[0].route.selected.effort, "max");
    assert.equal(plan.stages[1].route.selected.providerId, "codex");
    assert.equal(plan.stages[1].route.selected.effort, "max");
    assert.equal(plan.stages[2].selection.sourceStageId, "proposal");
    assert.equal(plan.stages[3].selection.kind, "deterministic_gate");
  } finally { await fx.cleanup(); }
});

test("single-route preview refuses to hide architecture protocol stages", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(
      () => fx.service.route({ consumerCwd: fx.consumerCwd, intent: "architecture", task: "Choose an architecture" }),
      { code: "AO_PLAN_REQUIRED" },
    );
  } finally { await fx.cleanup(); }
});

test("review excludes the originating provider family when possible", async () => {
  const fx = await fixture();
  try {
    const { decision } = await fx.service.route({ consumerCwd: fx.consumerCwd, intent: "review", task: "Review Sol implementation", originProvider: "codex" });
    assert.equal(decision.selected.providerId, "claude");
  } finally { await fx.cleanup(); }
});

test("explicit Claude and Codex provider requests resolve through catalog aliases", async () => {
  const fx = await fixture();
  try {
    const claude = await fx.service.route({ consumerCwd: fx.consumerCwd, intent: "design", task: "Design", provider: "claude" });
    const codex = await fx.service.route({ consumerCwd: fx.consumerCwd, intent: "implementation", task: "Implement", provider: "codex" });
    assert.equal(claude.decision.selected.providerId, "claude");
    assert.equal(codex.decision.selected.providerId, "codex");
  } finally { await fx.cleanup(); }
});

test("state roots must be absolute and outside the plugin installation", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ao-state-config-test-"));
  const pluginRoot = join(root, "plugin");
  await mkdir(pluginRoot);
  try {
    await assert.rejects(() => new OrchestrationService({ pluginRoot, stateRoot: "relative-state" }).initialize(), { code: "AO_STATE_ROOT_NOT_ABSOLUTE" });
    await assert.rejects(() => new OrchestrationService({ pluginRoot, stateRoot: join(pluginRoot, "state") }).initialize(), { code: "AO_STATE_ROOT_OVERLAPS_PLUGIN" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scheduler enforces concurrency and preserves idempotent spawn", async () => {
  const fx = await fixture();
  try {
    fx.service.maxConcurrentRuns = 1;
    fx.service.providerAvailabilitySnapshot = async () => allAvailable;
    fx.service.launchWorker = async () => {};
    const request = { consumerCwd: fx.consumerCwd, intent: "implementation", task: "Fixture", permissionProfile: "read", idempotencyKey: "fixture-key" };
    const first = await fx.service.spawn(request);
    const repeated = await fx.service.spawn(request);
    assert.equal(repeated.run.runId, first.run.runId);
    await assert.rejects(() => fx.service.spawn({ ...request, idempotencyKey: "another-key" }), { code: "AO_CONCURRENCY_LIMIT" });
  } finally { await fx.cleanup(); }
});

test("architecture decisions can transition only from complete waiting evidence", async () => {
  const fx = await fixture();
  try {
    const consumer = await fx.service.resolveConsumer(fx.consumerCwd);
    const plan = createExecutionPlan({ intent: "architecture" });
    let run = await fx.service.store.create({
      input: { intent: "architecture", task: "fixture", permissionProfile: "read" },
      consumer,
      plan,
    });
    run = await fx.service.store.transition(run.runId, ["queued"], "preparing");
    run = await fx.service.store.transition(run.runId, ["preparing"], "running");
    run = await fx.service.store.transition(run.runId, ["running"], "verifying");
    const outputs = ["proposal", "critique", "revision", "decision_gate"].map((stageId) => ({ stageId, text: "{}" }));
    run = await fx.service.store.transition(run.runId, ["verifying"], "waiting_for_decision", { outputs, decision: { state: "waiting_for_decision", requiresHumanApproval: true } });
    const approved = await fx.service.approveDecision({ consumerCwd: fx.consumerCwd, runId: run.runId, approved: true, rationale: "Evidence reviewed", approvedBy: "test" });
    assert.equal((await fx.service.store.get(run.runId)).state, "succeeded");
    assert.equal(approved.decision.approval.state, "approved");
    await assert.rejects(() => fx.service.approveDecision({ consumerCwd: fx.consumerCwd, runId: run.runId, approved: true, rationale: "again", approvedBy: "test" }), { code: "AO_DECISION_NOT_WAITING" });
  } finally { await fx.cleanup(); }
});

test("waiting-for-decision returns immediately and can be cancelled without a live worker", async () => {
  const fx = await fixture();
  try {
    const consumer = await fx.service.resolveConsumer(fx.consumerCwd);
    const plan = createExecutionPlan({ intent: "architecture" });
    let run = await fx.service.store.create({ input: { intent: "architecture", task: "fixture", permissionProfile: "read" }, consumer, plan });
    run = await fx.service.store.transition(run.runId, ["queued"], "preparing");
    run = await fx.service.store.transition(run.runId, ["preparing"], "running");
    run = await fx.service.store.transition(run.runId, ["running"], "verifying");
    run = await fx.service.store.transition(run.runId, ["verifying"], "waiting_for_decision", { decision: { requiresHumanApproval: true } });
    const startedAt = Date.now();
    assert.equal((await fx.service.wait({ consumerCwd: fx.consumerCwd, runId: run.runId, timeoutMs: 5_000 })).state, "waiting_for_decision");
    assert.ok(Date.now() - startedAt < 1_000);
    assert.equal((await fx.service.cancel({ consumerCwd: fx.consumerCwd, runId: run.runId })).state, "cancelled");
  } finally { await fx.cleanup(); }
});

test("restart recovery relaunches queued work and quarantines a lost active worker", async () => {
  const fx = await fixture();
  try {
    fx.service.recoveryGraceMs = 0;
    const consumer = await fx.service.resolveConsumer(fx.consumerCwd);
    const plan = createExecutionPlan({ intent: "review" });
    const launched = [];
    fx.service.launchWorker = async (runId) => { launched.push(runId); };
    const queued = await fx.service.store.create({ input: { intent: "review", task: "queued", permissionProfile: "read" }, consumer, plan });
    await fx.service.recoverInterruptedRuns();
    assert.deepEqual(launched, [queued.runId]);

    let active = await fx.service.store.create({ input: { intent: "review", task: "active", permissionProfile: "read" }, consumer, plan });
    active = await fx.service.store.transition(active.runId, ["queued"], "preparing");
    await fx.service.recoverInterruptedRuns();
    assert.equal((await fx.service.store.get(active.runId)).state, "recovery_required");
  } finally { await fx.cleanup(); }
});

test("worker startup acknowledgement fails closed and leaves a durable terminal failure", async () => {
  const fx = await fixture();
  try {
    const consumer = await fx.service.resolveConsumer(fx.consumerCwd);
    const plan = createExecutionPlan({ intent: "review" });
    const run = await fx.service.store.create({ input: { intent: "review", task: "launch failure", permissionProfile: "read" }, consumer, plan });
    const supervisorUnit = `agent-orchestration-run-${run.runId.replaceAll("_", "-")}.scope`;
    const launchError = await fx.service.waitForWorkerRegistration(
      run.runId,
      supervisorUnit,
      { pid: process.pid },
      { error: null, exited: { code: 1, signal: null } },
      100,
    ).then(() => null, (error) => error);
    assert.equal(launchError?.code, "AO_WORKER_LAUNCH_FAILED");
    fx.service.terminateRecordedProcessGroup = async (worker) => {
      assert.equal(worker.supervisorUnit, supervisorUnit);
      return true;
    };
    await fx.service.quarantineWorkerLaunchFailure(run.runId, supervisorUnit, launchError);
    const failed = await fx.service.store.get(run.runId);
    assert.equal(failed.state, "failed");
    assert.equal(failed.error.code, "AO_WORKER_LAUNCH_FAILED");
  } finally { await fx.cleanup(); }
});
