import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, dirname, basename, isAbsolute } from "node:path";
import test from "node:test";
import { git } from "../../src/util.mjs";
import { resolveConsumerRepository } from "../../src/workspace/repository.mjs";
import { createOrchestrationWorktree, orchestrationWorktreeRoot, removeOrchestrationWorktree } from "../../src/workspace/worktrees.mjs";

async function fixture() {
  const root = await mkdtemp(join(os.tmpdir(), "ao-repository-test-"));
  const consumer = join(root, "consumer");
  const plugin = join(root, "plugin-cache");
  const state = join(root, "state");
  await Promise.all([mkdir(consumer), mkdir(plugin), mkdir(state)]);
  await git(consumer, ["init", "-q"]);
  await git(consumer, ["config", "user.email", "agent-orchestration@test.invalid"]);
  await git(consumer, ["config", "user.name", "Agent Orchestration Test"]);
  await writeFile(join(consumer, "README.md"), "fixture\n");
  await git(consumer, ["add", "README.md"]);
  await git(consumer, ["commit", "-qm", "fixture"]);
  return { root, consumer, plugin, state, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("consumerCwd is required and never falls back to the plugin process cwd", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(() => resolveConsumerRepository({ pluginRoot: fx.plugin, stateRoot: fx.state }), { code: "AO_CONSUMER_CWD_REQUIRED" });
    await assert.rejects(() => resolveConsumerRepository({ consumerCwd: fx.plugin, pluginRoot: fx.plugin, stateRoot: fx.state }), { code: "AO_PLUGIN_ROOT_IS_NOT_CONSUMER" });
  } finally { await fx.cleanup(); }
});

test("linked consumer worktrees have distinct run authority keys", async () => {
  const fx = await fixture();
  const linked = join(fx.root, "consumer-linked");
  try {
    await git(fx.consumer, ["worktree", "add", "--detach", "--", linked, "HEAD"]);
    const [primary, sibling] = await Promise.all([
      resolveConsumerRepository({ consumerCwd: fx.consumer, pluginRoot: fx.plugin, stateRoot: fx.state }),
      resolveConsumerRepository({ consumerCwd: linked, pluginRoot: fx.plugin, stateRoot: fx.state }),
    ]);
    assert.equal(primary.commonGitDir, sibling.commonGitDir);
    assert.notEqual(primary.repositoryKey, sibling.repositoryKey);
  } finally { await fx.cleanup(); }
});

test("worktrees derive from the consumer repository sibling and register only there", async () => {
  const fx = await fixture();
  try {
    const repo = await resolveConsumerRepository({ consumerCwd: fx.consumer, pluginRoot: fx.plugin, stateRoot: fx.state, requireClean: true });
    const workspace = await createOrchestrationWorktree(repo, { runId: "run_fixture", taskId: "implementation" });
    assert.equal(orchestrationWorktreeRoot(repo), join(dirname(repo.checkoutRoot), `.${basename(repo.checkoutRoot)}-worktrees`, "agent-orchestration", repo.repositoryKey));
    assert.ok(workspace.path.startsWith(orchestrationWorktreeRoot(repo)));
    assert.equal(isAbsolute((await git(workspace.path, ["rev-parse", "--git-common-dir"])).stdout), true);
    assert.equal((await git(workspace.path, ["rev-parse", "HEAD"])).stdout, repo.baseSha);
    assert.equal(workspace.runId, "run_fixture");
    assert.equal(dirname(workspace.ownership.path), join(dirname(workspace.path), ".broker-ownership"));
    const ownership = JSON.parse(await readFile(workspace.ownership.path, "utf8"));
    assert.equal(ownership.nonce, workspace.ownership.nonce);
    assert.equal(ownership.path, workspace.path);
    assert.equal(ownership.gitAdminDir, workspace.gitAdminDir);

    assert.deepEqual(await removeOrchestrationWorktree(repo, workspace), { removed: true });
    await assert.rejects(() => access(workspace.path));
    await assert.rejects(() => access(workspace.ownership.path));
    assert.deepEqual(await removeOrchestrationWorktree(repo, workspace), { removed: false, reason: "already_removed" });
  } finally { await fx.cleanup(); }
});

test("cleanup rejects a sibling worktree path and a mismatched ownership nonce", async () => {
  const fx = await fixture();
  try {
    const repo = await resolveConsumerRepository({ consumerCwd: fx.consumer, pluginRoot: fx.plugin, stateRoot: fx.state, requireClean: true });
    const first = await createOrchestrationWorktree(repo, { runId: "run_first", taskId: "implementation" });
    const second = await createOrchestrationWorktree(repo, { runId: "run_second", taskId: "implementation" });

    await assert.rejects(
      () => removeOrchestrationWorktree(repo, { ...first, path: second.path }),
      { code: "AO_UNSAFE_WORKTREE_REMOVAL" },
    );
    await assert.rejects(
      () => removeOrchestrationWorktree(repo, { ...first, ownership: { ...first.ownership, nonce: "workspace_forged" } }),
      { code: "AO_WORKSPACE_OWNERSHIP_MISMATCH" },
    );
    await access(first.path);
    await access(second.path);
    await removeOrchestrationWorktree(repo, first);
    await removeOrchestrationWorktree(repo, second);
  } finally { await fx.cleanup(); }
});

test("cleanup verifies the marker hash, base SHA, and exact Git administration entry", async () => {
  const fx = await fixture();
  try {
    const repo = await resolveConsumerRepository({ consumerCwd: fx.consumer, pluginRoot: fx.plugin, stateRoot: fx.state, requireClean: true });
    const workspace = await createOrchestrationWorktree(repo, { runId: "run_integrity", taskId: "implementation" });
    const markerPath = join(workspace.path, ".git");
    const markerBackup = `${markerPath}.original`;
    await rename(markerPath, markerBackup);
    await writeFile(markerPath, "gitdir: /tmp/foreign\n");
    await assert.rejects(() => removeOrchestrationWorktree(repo, workspace), { code: "AO_GIT_METADATA_CHANGED" });
    await rm(markerPath, { force: true });
    await rename(markerBackup, markerPath);

    const ownership = JSON.parse(await readFile(workspace.ownership.path, "utf8"));
    const wrongBase = "f".repeat(40);
    await writeFile(workspace.ownership.path, `${JSON.stringify({ ...ownership, baseSha: wrongBase }, null, 2)}\n`);
    await assert.rejects(
      () => removeOrchestrationWorktree(repo, { ...workspace, baseSha: wrongBase }),
      { code: "AO_WORKTREE_HEAD_MISMATCH" },
    );
    await writeFile(workspace.ownership.path, `${JSON.stringify(ownership, null, 2)}\n`);

    await assert.rejects(
      () => removeOrchestrationWorktree(repo, { ...workspace, gitAdminDir: `${workspace.gitAdminDir}-foreign` }),
      { code: "AO_WORKSPACE_OWNERSHIP_MISMATCH" },
    );
    await removeOrchestrationWorktree(repo, workspace);
  } finally { await fx.cleanup(); }
});

test("the marketplace checkout containing the plugin source is rejected as a consumer", async () => {
  const fx = await fixture();
  try {
    const pluginInsideConsumer = join(fx.consumer, "agent-orchestration");
    await mkdir(pluginInsideConsumer);
    await assert.rejects(() => resolveConsumerRepository({ consumerCwd: fx.consumer, pluginRoot: pluginInsideConsumer, stateRoot: fx.state }), { code: "AO_PLUGIN_ROOT_IS_NOT_CONSUMER" });
  } finally { await fx.cleanup(); }
});

test("a separate marketplace source checkout is rejected from an installed plugin cache", async () => {
  const fx = await fixture();
  try {
    await mkdir(join(fx.consumer, ".claude-plugin"));
    await writeFile(join(fx.consumer, ".claude-plugin", "marketplace.json"), "{}\n");
    await assert.rejects(() => resolveConsumerRepository({ consumerCwd: fx.consumer, pluginRoot: fx.plugin, stateRoot: fx.state }), { code: "AO_MARKETPLACE_IS_NOT_CONSUMER" });
  } finally { await fx.cleanup(); }
});

test("dirty tracked and untracked consumers are rejected for write orchestration", async () => {
  const fx = await fixture();
  try {
    await writeFile(join(fx.consumer, "untracked.txt"), "dirty\n");
    await assert.rejects(() => resolveConsumerRepository({ consumerCwd: fx.consumer, pluginRoot: fx.plugin, stateRoot: fx.state, requireClean: true }), { code: "AO_CONSUMER_DIRTY" });
  } finally { await fx.cleanup(); }
});
