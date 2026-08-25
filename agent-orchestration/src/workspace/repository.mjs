import { basename } from "node:path";
import { join } from "node:path";
import { access } from "node:fs/promises";
import { assertAbsolutePath, assertDirectory, canonicalPath, git, isPathWithin, sha256 } from "../util.mjs";
import { invariant } from "../errors.mjs";
import { runtimePath } from "../platform/path-mapper.mjs";

export async function resolveConsumerRepository({ consumerCwd, pluginRoot, stateRoot, requireClean = false }) {
  invariant(typeof consumerCwd === "string" && consumerCwd.length > 0, "AO_CONSUMER_CWD_REQUIRED", "consumerCwd is required and must be an absolute repository or worktree path.");
  consumerCwd = await runtimePath(consumerCwd);
  assertAbsolutePath(consumerCwd, "consumerCwd");
  await assertDirectory(consumerCwd, "consumerCwd");

  const requestedCwd = await canonicalPath(consumerCwd);
  const [canonicalPluginRoot, canonicalStateRoot] = await Promise.all([
    pluginRoot ? canonicalPath(pluginRoot) : null,
    stateRoot ? canonicalPath(stateRoot).catch(() => stateRoot) : null,
  ]);
  invariant(!canonicalPluginRoot || !isPathWithin(canonicalPluginRoot, requestedCwd), "AO_PLUGIN_ROOT_IS_NOT_CONSUMER", "consumerCwd cannot be inside the plugin installation or marketplace source.");
  invariant(!canonicalStateRoot || !isPathWithin(canonicalStateRoot, requestedCwd), "AO_STATE_ROOT_IS_NOT_CONSUMER", "consumerCwd cannot be inside the orchestration state root.");

  let checkoutRoot;
  try {
    checkoutRoot = (await git(requestedCwd, ["rev-parse", "--show-toplevel"])).stdout;
  } catch (error) {
    invariant(false, "AO_NOT_A_GIT_REPOSITORY", "consumerCwd must be inside a Git working tree.", { consumerCwd: requestedCwd, cause: error.message });
  }
  checkoutRoot = await canonicalPath(checkoutRoot);
  invariant(!canonicalPluginRoot || (!isPathWithin(canonicalPluginRoot, checkoutRoot) && !isPathWithin(checkoutRoot, canonicalPluginRoot)), "AO_PLUGIN_ROOT_IS_NOT_CONSUMER", "The plugin installation or marketplace source cannot be used as a consumer repository.");
  invariant(!canonicalStateRoot || (!isPathWithin(canonicalStateRoot, checkoutRoot) && !isPathWithin(checkoutRoot, canonicalStateRoot)), "AO_STATE_ROOT_IS_NOT_CONSUMER", "The orchestration state root cannot be used as a consumer repository.");
  const marketplaceManifest = join(checkoutRoot, ".claude-plugin", "marketplace.json");
  const isMarketplaceSource = await access(marketplaceManifest).then(() => true, () => false);
  invariant(!isMarketplaceSource, "AO_MARKETPLACE_IS_NOT_CONSUMER", "A marketplace source checkout cannot be used as an orchestration consumer repository.");

  const [{ stdout: commonGitDir }, { stdout: baseSha }, { stdout: branch }, { stdout: status }] = await Promise.all([
    git(checkoutRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    git(checkoutRoot, ["rev-parse", "HEAD"]),
    git(checkoutRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ({ stdout: "", stderr: "" })),
    git(checkoutRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
  ]);
  if (requireClean) {
    invariant(status === "", "AO_CONSUMER_DIRTY", "The consumer repository must be clean before creating an orchestration worktree.", { checkoutRoot });
  }

  const canonicalCommonGitDir = await canonicalPath(commonGitDir);
  return Object.freeze({
    requestedCwd,
    checkoutRoot,
    commonGitDir: canonicalCommonGitDir,
    baseSha,
    branch: branch || null,
    dirty: status !== "",
    repositoryName: basename(checkoutRoot),
    // Authority is checkout-scoped, not merely repository-scoped. Linked
    // worktrees share a common Git directory but must not be able to inspect or
    // control one another's runs.
    repositoryKey: sha256(`${canonicalCommonGitDir}\0${checkoutRoot}`).slice(0, 24),
  });
}
