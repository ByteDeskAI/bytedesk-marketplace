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
import { isAbsolute, join, resolve } from "node:path";
import { invariant, run } from "./util.mjs";

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
