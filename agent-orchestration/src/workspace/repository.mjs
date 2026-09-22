import { basename } from "node:path";
import { join, resolve } from "node:path";
import { access, readFile } from "node:fs/promises";
import { assertAbsolutePath, assertDirectory, canonicalPath, git, isPathWithin, sha256 } from "../util.mjs";
import { invariant } from "../errors.mjs";
import { runtimePath } from "../platform/path-mapper.mjs";

const readJson = (path) => readFile(path, "utf8").then(JSON.parse).catch(() => null);

// A consumer can publish an unrelated marketplace (Gateway publishes `setup`).
// Identify this product's payload, rather than treating every marketplace as us.
async function containsOrchestrationPayload(checkoutRoot) {
  const marketplace = await readJson(join(checkoutRoot, ".claude-plugin", "marketplace.json"));
  const sources = (Array.isArray(marketplace?.plugins) ? marketplace.plugins : []).filter(entry => entry?.name === "agent-orchestration" && typeof entry.source === "string").map(entry => entry.source);
  for (const source of new Set([".", "agent-orchestration", ...sources])) {
    const candidate = await canonicalPath(resolve(checkoutRoot, source)).catch(() => null);
    if (!candidate || !isPathWithin(checkoutRoot, candidate)) continue;
    const [pkg, manifest] = await Promise.all([
      readJson(join(candidate, "package.json")),
      readJson(join(candidate, ".claude-plugin", "plugin.json")),
    ]);
    if (pkg?.name !== "@bytedesk/agent-orchestration" || manifest?.name !== "agent-orchestration") continue;
    if (await access(join(candidate, "bin", "agent-orchestration-mcp")).then(() => true, () => false)) return true;
  }
  return false;
}

async function isOrchestrationSource(checkoutRoot, commonGitDir, pluginRoot) {
  if (pluginRoot) {
    const pluginCommon = await git(pluginRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
      .then(({ stdout }) => canonicalPath(stdout)).catch(() => null);
    if (pluginCommon === commonGitDir) return true;
  }
  // Check every registered checkout: an older or sparse worktree may omit the
  // payload while sharing the source repository's Git authority.
  const listing = await git(checkoutRoot, ["worktree", "list", "--porcelain", "-z"]);
  const roots = listing.stdout.split("\0").filter(field => field.startsWith("worktree ")).map(field => field.slice(9));
  for (const root of new Set([checkoutRoot, ...roots])) {
    const canonical = await canonicalPath(root).catch(() => null);
    if (!canonical) continue;
    const currentCommon=await git(canonical,["rev-parse","--path-format=absolute","--git-common-dir"]).then(({stdout})=>canonicalPath(stdout)).catch(()=>null);
    if (currentCommon===commonGitDir && await containsOrchestrationPayload(canonical)) return true;
  }
  return false;
}

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
  const [{ stdout: commonGitDir }, { stdout: baseSha }, { stdout: branch }, { stdout: status }] = await Promise.all([
    git(checkoutRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
    git(checkoutRoot, ["rev-parse", "HEAD"]),
    git(checkoutRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ({ stdout: "", stderr: "" })),
    git(checkoutRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
  ]);
  const canonicalCommonGitDir = await canonicalPath(commonGitDir);
  invariant(!await isOrchestrationSource(checkoutRoot, canonicalCommonGitDir, canonicalPluginRoot), "AO_MARKETPLACE_IS_NOT_CONSUMER", "The Agent Orchestration source or payload repository cannot be used as its own consumer.");
  if (requireClean) {
    invariant(status === "", "AO_CONSUMER_DIRTY", "The consumer repository must be clean before creating an orchestration worktree.", { checkoutRoot });
  }

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
