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
import { fail, invariant, readJson, writeJson } from "./util.mjs";
import { safeGit } from "./safe-git.mjs";

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
  const git = await safeGit(abs, ["rev-parse", "--git-common-dir"], { allowFailure: true, timeoutMs: 10_000 })
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
 * TM-371: the human-readable name beside `repoKey`, from the same canonical id: the checkout folder
 * for `<repo>/.git`, the bare repository's name otherwise. Display only; subjects stay keyed by digest.
 */
export function repoSlug(id) {
  const path = String(id ?? "");
  const name = basename(basename(path) === ".git" ? dirname(path) : path).replace(/\.git$/, "");
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 64) || "repo";
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

/** The `owner/name` a GitHub remote URL names (https, ssh:// or scp-style git@github.com:), else null. */
export function githubRepoOfUrl(url) {
  const m = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com(?::22)?\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(String(url));
  return m ? m[1] : null;
}

/** TM-472: the URL every host fetch reads. `remote.origin.url` lives in the shared .git/config, which a
 * worker can write, so it is never trusted as such:
 *  - `<key>.origin.json` in host state, when present, is the URL: the operator's explicit pin, and the
 *    record of a local-only repository's first fetch;
 *  - else, when the repository has a GitHub pin (`<key>.github.json`), origin is used only if it names
 *    exactly that repository on github.com (any protocol, so the operator's ssh or https auth keeps
 *    working); a repointed origin (a file:// path, another repository, another host) is refused, and
 *    nothing is recorded, so an upgrade never pins whatever origin says at that moment;
 *  - else (no GitHub pin) a github.com origin is used but never recorded, so a GitHub pin made later
 *    still decides; any other origin is recorded on first use, and only from the main checkout: a
 *    worker's linked worktree never chooses it.
 * Same-uid limit as pinnedGithubRepo: host state is a file that user can edit; the operator writes or
 * removes `<key>.origin.json` to move it. Rewriting by url.*.insteadOf is checked by fetchPinned. */
export async function pinnedFetchUrl(repoDir, { env = process.env, home = homedir() } = {}) {
  const identity = await canonicalRepoId(repoDir);
  const dir = join(stateRoot(env, home), "repositories"), key = repoKey(identity.id), path = join(dir, `${key}.origin.json`);
  const read = async file => readJson(file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const pinned = await read(path);
  if (typeof pinned?.url === "string" && pinned.url) return pinned.url;
  // The raw value: `remote get-url` would already apply url.*.insteadOf, which fetchPinned must see to refuse.
  const got = await safeGit(repoDir, ["config", "--get", "remote.origin.url"], { allowFailure: true, timeoutMs: 10_000 });
  const url = got.code === 0 ? got.stdout.trim().split("\n")[0] : "";
  if (!url || url.startsWith("-")) fail("TOPOLOGY_REPOSITORY_PIN", `no origin URL to fetch from (exit ${got.code}): ${(got.stderr || url).trim().split("\n")[0]}`);
  const github = (await read(join(dir, `${key}.github.json`)))?.nameWithOwner;
  if (typeof github === "string" && github) {
    if (githubRepoOfUrl(url)?.toLowerCase() === github.toLowerCase()) return url;
    fail("TOPOLOGY_REPOSITORY_PIN", `origin is ${url}, which is not the pinned GitHub repository ${github}; refusing to fetch from it. If the change is intended, the operator writes {"url": "<fetch url>"} to ${path}.`, { origin: url, pinned: github });
  }
  // A github.com origin is never recorded: it would outrank the GitHub pin made later (a release fetch can
  // run before any pin), and the check above validates it once that pin exists.
  if (githubRepoOfUrl(url)) return url;
  const dirs = await safeGit(repoDir, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { allowFailure: true, timeoutMs: 10_000 });
  const [gitDir, commonDir] = dirs.stdout.trim().split("\n");
  if (dirs.code !== 0 || !gitDir || gitDir !== commonDir) fail("TOPOLOGY_REPOSITORY_PIN", `the origin URL is pinned only from the main checkout, never from a linked worktree (${repoDir}); run a host fetch there first`);
  await writeJson(path, { repo_id: identity.id, url, pinned_at: new Date().toISOString() });
  return url;
}
