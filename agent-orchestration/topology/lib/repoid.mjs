// Canonical repository identity. A repo is not the path you happen to be standing in: linked
// worktrees, checkouts reached through symlinks, and a bare repo's working trees are all the SAME
// repository, and the features built on this — one persistent lead, one reviewer, one presence
// snapshot per repository — only hold if the identity says so.
//
// git already answers the question. Every worktree linked to a repository reports the same
// `--git-common-dir`, so that directory, resolved through symlinks, is the identity. A directory
// that is not a git repository falls back to its own real path: it still gets a stable identity,
// it just shares it with nothing.
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fail, invariant, readJson, run, writeJson } from "./util.mjs";

/**
 * The canonical identity of the repository containing `consumer`.
 * Returns { id, kind, git_common_dir }:
 *   id              absolute real path of the git common directory, or of the directory itself
 *   kind            "git-common-dir" | "path"
 *   git_common_dir  same as id when kind is git-common-dir, else null
 */
export async function canonicalRepoId(consumer) {
  invariant(consumer && typeof consumer === "string", "TOPOLOGY_REPO_REQUIRED", "A consumer path is required to identify a repository.");
  const abs = resolve(consumer);
  const git = await run("git", ["-C", abs, "rev-parse", "--git-common-dir"], { allowFailure: true, timeoutMs: 10_000 })
    .catch(() => ({ code: 1, stdout: "", stderr: "" }));
  if (git.code === 0 && git.stdout.trim()) {
    const reported = git.stdout.trim().split("\n")[0];
    const common = isAbsolute(reported) ? resolve(reported) : resolve(abs, reported);
    const real = await realpath(common).catch(() => common);
    return { id: real, kind: "git-common-dir", git_common_dir: real };
  }
  const real = await realpath(abs).catch(() => abs);
  return { id: real, kind: "path", git_common_dir: null };
}

/**
 * Stable repository-scoped consumer. Linked worktrees and paths below them all supervise through
 * the main checkout which owns the shared git common directory. Run records keep their original
 * consumer; this normalization is only for repository-scoped services.
 */
export async function repositoryConsumer(consumer) {
  const identity = await canonicalRepoId(consumer);
  if (identity.kind === "git-common-dir" && basename(identity.git_common_dir) === ".git") {
    return await realpath(dirname(identity.git_common_dir)).catch(() => dirname(identity.git_common_dir));
  }
  return await realpath(resolve(consumer)).catch(() => resolve(consumer));
}

/**
 * The filename-safe form of a canonical id. The id itself is a path — long, separator-laden, and
 * useless as a filename — so records keyed by repository are named by this digest. One way, on
 * purpose: the record stores the id; the key only finds it.
 */
export function repoKey(id) {
  return createHash("sha256").update(String(id)).digest("hex").slice(0, 16);
}

/**
 * Host-local state shared across every checkout of every repo: lead and reviewer registries,
 * presence snapshots, watcher leases. Mirrors the broker's stateRoot in src/config.mjs so both
 * runtimes agree on one home — but resolved here, dependency-free, because the topology layer
 * cannot import the bundled side.
 */
export function stateRoot(env = process.env, home = homedir()) {
  if (env.AGENT_ORCHESTRATION_STATE_HOME) return resolve(env.AGENT_ORCHESTRATION_STATE_HOME);
  const xdg = env.XDG_STATE_HOME || join(home, ".local", "state");
  return join(xdg, "bytedesk", "agent-orchestration");
}

/**
 * TM-263: the GitHub repository this repository lands on, pinned in host state on its first successful
 * resolution. `gh repo view` resolves from the checkout's remotes and gh's own default, both of which a
 * same-user process can repoint at a repository it controls. So the first answer is recorded at
 * <stateRoot>/repositories/<repoKey>.github.json and every later answer must agree with it; a
 * disagreement throws TOPOLOGY_REPOSITORY_PIN and the caller refuses. Callers then address gh with the
 * pinned name explicitly (`--repo`, or the name in the `gh api` path), never through cwd resolution.
 * `gh` is `args => { code, stdout, stderr }` run in `repoDir`. Returns { repo, branch }.
 * Same-uid limit: the pin file is host state that same user can edit; it is trust-on-first-use.
 */
export async function pinnedGithubRepo(repoDir, gh, { env = process.env, home = homedir() } = {}) {
  const view = await gh(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
  let value = null;
  try { value = JSON.parse(view.stdout); } catch { /* reported below */ }
  const repo = value?.nameWithOwner, branch = value?.defaultBranchRef?.name;
  if (view.code !== 0 || typeof repo !== "string" || !repo || typeof branch !== "string" || !branch)
    fail("TOPOLOGY_REPOSITORY_PIN", `gh repo view named no repository and default branch (exit ${view.code}): ${(view.stderr || view.stdout || "").trim().split("\n")[0]}`);
  const identity = await canonicalRepoId(repoDir);
  const path = join(stateRoot(env, home), "repositories", `${repoKey(identity.id)}.github.json`);
  const pinned = await readJson(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  // ponytail: two first resolutions racing both write; the later rename wins. Add an O_EXCL create if that ever matters.
  if (!pinned) await writeJson(path, { repo_id: identity.id, nameWithOwner: repo, pinned_at: new Date().toISOString() });
  else if (String(pinned.nameWithOwner).toLowerCase() !== repo.toLowerCase())
    fail("TOPOLOGY_REPOSITORY_PIN", `gh now resolves this repository to ${repo}, but it is pinned to ${pinned.nameWithOwner} (${path}); refusing. If the move is intended, the operator removes that file.`, { pinned: pinned.nameWithOwner, resolved: repo, path });
  return { repo: pinned?.nameWithOwner ?? repo, branch };
}
