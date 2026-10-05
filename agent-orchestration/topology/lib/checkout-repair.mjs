// TM-394: detect a broken repository checkout and repair it without an operator, or refuse loudly.
//
// The case that motivated it: a checkout whose `.git` is a FILE reading
// `gitdir: /tmp/<x>/repo.git/worktrees/<name>`, the /tmp repository long deleted. Every git command
// fails, the canonical identity falls back to `kind: path`, and the repository can never get a lead.
//
// What counts as broken, and what is done about it:
//
//   dangling-gitdir   `.git` is a pointer file whose target is gone, AND the repository that owned
//                     it is gone too. Repaired.
//   missing-git       a REGISTERED repository has no `.git` at all. Repaired.
//   orphaned-worktree the pointer's owning repository still exists and only its worktree metadata
//                     is gone. `git worktree repair` is a human's call: refused with an alert.
//   unreadable        a `.git` git itself rejects for another reason. Refused with an alert.
//   corrupt           `git fsck` reports errors. Refused with an alert: the old `.git` may hold
//                     commits that exist nowhere else, and only a human can judge what to keep.
//
// THE REPAIR, and why it cannot lose a byte of the working tree:
//   1. The remote comes from bytedesk-package.yaml `repository` or package.json `repository`. None
//      known: refuse. It is cloned --no-checkout into a sibling temp dir (same filesystem, so the
//      `.git` can be renamed in; never /tmp, which is how the original breakage was made).
//   2. Every candidate (newest tags, recent default-branch commits, bounded) is read into a SCRATCH
//      index against the broken tree and its differing paths counted. The closest wins; one further
//      than maxDifferences is refused. Reading never writes the working tree.
//   3. The old pointer file is copied into the new `.git` before it is moved; the clone's `.git` is
//      renamed in; `reset --mixed` points the branch and index at the match. Files untouched.
//   4. A SNAPSHOT commit of the whole working tree as found (scratch index, `add -A`, parent = the
//      match) becomes branch `ao-repair/<stamp>`. From here on every non-ignored file has a copy in
//      git that no later step can remove.
//   5. Local edits go to a named stash (`push -u`), the branch moves to origin/<default>, and the
//      stash is APPLIED by SHA, never popped. Clean: the entry is dropped (the content is on disk and
//      in the snapshot). Conflict: the tree is reset to origin/<default> and the stash is KEPT.
//      Ignored files are the one thing git would overwrite silently, so a path the advance would
//      create that already exists on disk cancels the advance and leaves the tree at the match.
// Each attempt is recorded in the lead recovery state file and its journal, with backoff on
// refusals; a repaired repository then gets its lead through the ordinary recovery path.
import { lstat, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { leadRegistryDir } from "./lead.mjs";
import { readCheckoutRepair, recordCheckoutRepair, recoverLead, retryDelayMs } from "./lead-recovery.mjs";
import { withLock } from "./lockfile.mjs";
import { repoKey } from "./repoid.mjs";
import { readServiceRepos } from "./services-client.mjs";
import { exists, nowIso, run } from "./util.mjs";

export const DEFAULT_MAX_DIFFERENCES = 50;
const REPAIRABLE = new Set(["dangling-gitdir", "missing-git"]);
const IDENTITY = ["-c", "user.name=agent-orchestration", "-c", "user.email=agent-orchestration@localhost", "-c", "core.hooksPath=/dev/null"];

// A caller's GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE would point every command below somewhere else.
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return { ...env, GIT_TERMINAL_PROMPT: "0", ...extra };
}
const git = (args, { env = {}, timeoutMs = 120_000 } = {}) =>
  run("git", [...IDENTITY, ...args], { env: cleanEnv(env), allowFailure: true, timeoutMs, maxBuffer: 64 * 1024 * 1024 });
const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);

/**
 * What state the checkout at `dir` is in. Cheap unless `fsck` is set. `registered` says whether a
 * missing `.git` is a fault (a registered repository) or simply a directory that is not a checkout.
 */
export async function inspectCheckout(dir, { fsck = false, registered = false } = {}) {
  const path = resolve(dir);
  if (!(await exists(path))) return { path, status: "absent" };
  const dotgit = join(path, ".git");
  const entry = await lstat(dotgit).catch(() => null);
  if (!entry) return { path, status: registered ? "missing-git" : "not-a-checkout" };
  if (entry.isFile()) {
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotgit, "utf8").catch(() => ""));
    if (!match) return { path, status: "unreadable", detail: "the .git file is not a gitdir pointer" };
    const gitdir = resolve(path, match[1]);
    if (!(await exists(gitdir))) {
      const owner = /^(.*)[/\\]worktrees[/\\][^/\\]+$/.exec(gitdir)?.[1];
      if (owner && (await exists(owner))) return { path, status: "orphaned-worktree", gitdir, detail: `${owner} still exists; run git worktree repair from it` };
      return { path, status: "dangling-gitdir", gitdir };
    }
  }
  const probe = await git(["-C", path, "rev-parse", "--git-dir"], { timeoutMs: 15_000 });
  if (probe.code !== 0) return { path, status: "unreadable", detail: probe.stderr.trim().slice(-500) };
  if (fsck) {
    const check = await git(["-C", path, "fsck", "--connectivity-only", "--no-dangling", "--no-progress"], { timeoutMs: 120_000 });
    // A timeout proves nothing either way; only a completed fsck that failed is corruption.
    if (check.code !== 0 && check.code !== 124) return { path, status: "corrupt", detail: check.stderr.trim().slice(-1000) };
  }
  return { path, status: "healthy" };
}

/** `owner/repo` and `github:owner/repo` are GitHub; anything else (URL, scp form, path) is used as written. */
function normalizeRemote(value) {
  const text = String(value ?? "").trim().replace(/^git\+/, "");
  if (!text) return null;
  const short = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(text);
  return short ? `https://github.com/${short[1].replace(/\.git$/, "")}.git` : text;
}

/** The remote this checkout belongs to, from bytedesk-package.yaml or package.json; null when unknown. */
export async function knownRemote(dir) {
  const pkg = await readFile(join(dir, "bytedesk-package.yaml"), "utf8").catch(() => null);
  if (pkg !== null) {
    let parsed = null;
    try { parsed = JSON.parse(pkg); } catch { /* YAML proper: read the key below */ }
    const value = parsed ? (parsed.spec?.repository ?? parsed.repository) : /^\s*"?repository"?\s*:\s*["']?([^"'\s,]+)/m.exec(pkg)?.[1];
    const remote = normalizeRemote(typeof value === "object" ? value?.url : value);
    if (remote) return { remote, source: "bytedesk-package.yaml" };
  }
  const json = await readFile(join(dir, "package.json"), "utf8").then(JSON.parse).catch(() => null);
  const value = json?.repository;
  const remote = normalizeRemote(typeof value === "object" ? value?.url : value);
  return remote ? { remote, source: "package.json" } : null;
}

/** How many paths differ between `rev` and the working tree at `dir`, read through a scratch index. */
async function differences({ gitDir, dir, rev, index }) {
  await rm(index, { force: true });
  const env = { GIT_INDEX_FILE: index };
  const base = [`--git-dir=${gitDir}`, `--work-tree=${dir}`];
  if ((await git([...base, "read-tree", rev], { env })).code !== 0) return null;
  await git([...base, "update-index", "-q", "--refresh"], { env, timeoutMs: 300_000 });
  const changed = await git([...base, "diff-files", "--name-only"], { env, timeoutMs: 300_000 });
  const untracked = await git([...base, "ls-files", "--others", "--exclude-standard"], { env, timeoutMs: 300_000 });
  if (changed.code !== 0 || untracked.code !== 0) return null;
  return lines(changed.stdout).length + lines(untracked.stdout).length;
}

async function closestRevision({ gitDir, dir, scratch, defaultBranch, maxTags, maxCommits }) {
  const tags = lines((await git([`--git-dir=${gitDir}`, "for-each-ref", "--sort=-creatordate", `--count=${maxTags}`, "--format=%(refname:short)", "refs/tags"])).stdout);
  const commits = lines((await git([`--git-dir=${gitDir}`, "rev-list", `--max-count=${maxCommits}`, `origin/${defaultBranch}`])).stdout);
  const candidates = [], seenTrees = new Set();
  for (const label of [...tags, ...commits]) {
    const resolved = lines((await git([`--git-dir=${gitDir}`, "rev-parse", `${label}^{commit}`, `${label}^{tree}`])).stdout);
    if (resolved.length !== 2 || seenTrees.has(resolved[1])) continue;
    seenTrees.add(resolved[1]);
    candidates.push({ rev: resolved[0], label });
  }
  let best = null;
  for (const candidate of candidates) {
    const count = await differences({ gitDir, dir, rev: candidate.rev, index: join(scratch, "match.index") });
    if (count === null) continue;
    if (!best || count < best.differences) best = { ...candidate, differences: count };
    if (count === 0) break;
  }
  return { best, examined: candidates.length };
}

/** Paths the move from `from` to `to` would create where something already exists on disk. */
async function collisions(dir, from, to) {
  const added = (await git(["-C", dir, "diff", "--no-renames", "--name-only", "-z", "--diff-filter=A", from, to])).stdout.split("\0").filter(Boolean);
  const hits = [];
  for (const path of added) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      // A leaf that exists, or a parent that exists as something other than a directory.
      if (await lstat(join(dir, ...parts.slice(0, i))).then((s) => i === parts.length || !s.isDirectory(), () => false)) { hits.push(path); break; }
    }
  }
  return hits;
}

async function stashSha(dir) {
  const r = await git(["-C", dir, "rev-parse", "-q", "--verify", "refs/stash"]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/** Drops the stash entry whose commit is `sha`, found by SHA rather than by position. */
async function dropStash(dir, sha) {
  const index = lines((await git(["-C", dir, "stash", "list", "--format=%H"])).stdout).indexOf(sha);
  if (index >= 0) await git(["-C", dir, "stash", "drop", "-q", `stash@{${index}}`]);
}

class Refusal extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; this.extra = extra; }
}

async function performRepair({ found, dir, maxDifferences, maxTags, maxCommits, stamp }) {
  const origin = await knownRemote(dir);
  if (!origin) throw new Refusal("TOPOLOGY_CHECKOUT_NO_REMOTE", `${dir} is a broken checkout and names no repository in bytedesk-package.yaml or package.json, so there is nothing to restore it from.`);
  // Beside the checkout, never in /tmp: the rename below needs the same filesystem, and a checkout
  // pointing into /tmp is exactly the breakage being repaired.
  const scratch = await mkdtemp(join(dirname(dir), `.${basename(dir)}.ao-repair-`)).catch((error) => {
    throw new Refusal("TOPOLOGY_CHECKOUT_SCRATCH_FAILED", `cannot create a scratch directory beside ${dir}: ${error.message}`);
  });
  let keepScratch = false;
  try {
    const clone = join(scratch, "clone"), cloneGit = join(clone, ".git");
    const cloned = await git(["clone", "--no-checkout", "--quiet", origin.remote, clone], { timeoutMs: 600_000 });
    if (cloned.code !== 0) throw new Refusal("TOPOLOGY_CHECKOUT_CLONE_FAILED", `cloning ${origin.remote} failed: ${cloned.stderr.trim().slice(-500)}`, { remote: origin.remote });
    const head = (await git([`--git-dir=${cloneGit}`, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).stdout.trim();
    const defaultBranch = head.replace(/^origin\//, "");
    if (!defaultBranch) throw new Refusal("TOPOLOGY_CHECKOUT_NO_DEFAULT_BRANCH", `${origin.remote} has no default branch`, { remote: origin.remote });
    const { best, examined } = await closestRevision({ gitDir: cloneGit, dir, scratch, defaultBranch, maxTags, maxCommits });
    if (!best || best.differences > maxDifferences) {
      throw new Refusal("TOPOLOGY_CHECKOUT_NO_CLOSE_REVISION",
        `no revision of ${origin.remote} is within ${maxDifferences} differing paths of ${dir} (closest: ${best ? `${best.label} with ${best.differences}` : "none"}, ${examined} examined); refusing to guess.`,
        { remote: origin.remote, closest: best, examined });
    }

    // Adopt. The pointer is copied into the new .git first, so it survives whatever happens next.
    let oldPointer = null;
    if (found.status === "dangling-gitdir") {
      oldPointer = join(dir, ".git", `ao-repair-old-git-pointer-${stamp}`);
      await writeFile(join(cloneGit, basename(oldPointer)), await readFile(join(dir, ".git")));
      await rename(join(dir, ".git"), join(scratch, "old-git-pointer"));
    }
    try { await rename(cloneGit, join(dir, ".git")); }
    catch (error) {
      if (oldPointer) await rename(join(scratch, "old-git-pointer"), join(dir, ".git")).catch(() => { keepScratch = true; });
      throw new Refusal("TOPOLOGY_CHECKOUT_ADOPT_FAILED", `could not move the restored .git into ${dir}: ${error.message}`, { remote: origin.remote, kept_scratch: keepScratch ? scratch : null });
    }
    const g = (...args) => git(["-C", dir, ...args], { timeoutMs: 300_000 });
    const mixed = await g("reset", "--mixed", "-q", best.rev);
    if (mixed.code !== 0) {
      throw new Refusal("TOPOLOGY_CHECKOUT_RESET_FAILED", `the restored .git is in place in ${dir}, but reset --mixed to ${best.label} failed (${mixed.stderr.trim()}); nothing else was changed.`,
        { remote: origin.remote, matched: best, repaired_git: true });
    }

    // The snapshot: every non-ignored file as found, committed on a backup branch.
    const snapEnv = { GIT_INDEX_FILE: join(scratch, "snapshot.index") };
    await git(["-C", dir, "read-tree", best.rev], { env: snapEnv });
    await git(["-C", dir, "add", "-A"], { env: snapEnv, timeoutMs: 300_000 });
    const tree = (await git(["-C", dir, "write-tree"], { env: snapEnv })).stdout.trim();
    const snapshot = tree ? (await g("commit-tree", tree, "-p", best.rev, "-m", `ao-repair ${stamp}: working tree as found in ${dir}`)).stdout.trim() : "";
    const backupBranch = `ao-repair/${stamp}`;
    const branched = snapshot ? await g("branch", backupBranch, snapshot) : { code: 1, stderr: "no snapshot commit" };
    if (branched.code !== 0) {
      // The .git is adopted and every file is untouched; stop before anything moves.
      throw new Refusal("TOPOLOGY_CHECKOUT_SNAPSHOT_FAILED", `the restored repository is in place at ${best.label}, but the working-tree snapshot failed (${branched.stderr.trim()}); the tree was not advanced.`,
        { remote: origin.remote, matched: best, repaired_git: true });
    }

    const result = { remote: origin.remote, remote_source: origin.source, matched: best, examined, default_branch: defaultBranch,
      backup_branch: backupBranch, snapshot, old_pointer: oldPointer, stash: null, advance: "done" };
    const before = await stashSha(dir);
    const pushed = await g("stash", "push", "-u", "-q", "-m", `ao-repair ${stamp}: local edits against ${best.label}`);
    if (pushed.code !== 0) {
      // Without the stash, the reset below would put the edits only in the snapshot. Stop at the match.
      throw new Refusal("TOPOLOGY_CHECKOUT_STASH_FAILED", `the restored repository is in place at ${best.label} with every local edit on disk and in ${backupBranch}, but stashing failed (${pushed.stderr.trim()}); the tree was not advanced.`,
        { ...result, repaired_git: true });
    }
    const after = await stashSha(dir);
    const created = after && after !== before ? after : null;
    // With local edits stashed, anything the advance would create that is still on disk is an
    // ignored file, which reset --hard would overwrite without a word. Stay at the match instead.
    const blocked = await collisions(dir, best.rev, `origin/${defaultBranch}`);
    if (blocked.length) Object.assign(result, { advance: "skipped-ignored-collision", collisions: blocked.slice(0, 20) });
    else await g("reset", "--hard", "-q", `origin/${defaultBranch}`);
    if (created) {
      const applied = await g("stash", "apply", "-q", created);
      const unmerged = lines((await g("diff", "--name-only", "--diff-filter=U")).stdout);
      if (applied.code === 0 && !unmerged.length) {
        await dropStash(dir, created);
        result.stash = { sha: created, state: "applied" };
      } else {
        // Upstream wins on disk; the local edit lives on in the kept stash and the snapshot branch.
        await g("reset", "--hard", "-q", result.advance === "done" ? `origin/${defaultBranch}` : best.rev);
        result.stash = { sha: created, state: "kept", conflicts: unmerged.slice(0, 20), message: applied.stderr.trim().slice(-500) };
      }
    }
    result.head = (await g("rev-parse", "HEAD")).stdout.trim();
    return result;
  } finally {
    if (!keepScratch) await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Repair the checkout at `dir` if it is broken. A broken checkout never throws: the answer is
 * { action: healthy | repaired | refused | backoff | busy | not-a-checkout | absent, ... }, and every
 * repaired or refused attempt is recorded. `ensureLead` (default: the supervisor's recoverLead) runs
 * after a repair; pass null to skip it.
 */
export async function repairCheckout({ dir, registered = false, fsck = false, env = process.env, home = homedir(), now = Date.now,
  maxDifferences = DEFAULT_MAX_DIFFERENCES, maxTags = 50, maxCommits = 200, ensureLead = recoverLead }) {
  const path = await realpath(resolve(dir)).catch(() => resolve(dir));
  const lock = join(leadRegistryDir(env, home), `${repoKey(`checkout:${path}`)}.checkout-repair.lock`);
  try {
    return await withLock(lock, async () => {
      const found = await inspectCheckout(path, { fsck, registered });
      if (["healthy", "absent", "not-a-checkout"].includes(found.status)) return { action: found.status, path };
      const prior = await readCheckoutRepair({ consumer: path, env, home });
      const at = now();
      if (prior?.action === "refused" && prior.next_retry_at && at < Date.parse(prior.next_retry_at)) return { ...prior, action: "backoff", status: found.status };
      const stamp = new Date(at).toISOString().replace(/[:.]/g, "-");
      let entry;
      try {
        if (!REPAIRABLE.has(found.status)) {
          throw new Refusal("TOPOLOGY_CHECKOUT_NOT_REPAIRABLE", `${path} is ${found.status}${found.detail ? ` (${found.detail})` : ""}; this needs a human, so nothing was changed.`);
        }
        entry = { action: "repaired", path, status: found.status, ...(found.gitdir ? { gitdir: found.gitdir } : {}),
          ...(await performRepair({ found, dir: path, maxDifferences, maxTags, maxCommits, stamp })), alert: null, at: nowIso() };
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        const attempts = prior?.action === "refused" ? (prior.attempts ?? 0) + 1 : 1;
        entry = { action: "refused", path, status: found.status, ...(found.gitdir ? { gitdir: found.gitdir } : {}), ...error.extra,
          attempts, next_retry_at: new Date(at + retryDelayMs(attempts)).toISOString(),
          alert: { code: error.code, path, message: error.message }, at: nowIso() };
      }
      await recordCheckoutRepair({ consumer: path, entry, env, home });
      if (entry.action === "repaired" && ensureLead) {
        entry.lead = await ensureLead({ consumer: path, env, home })
          .catch((error) => ({ action: "failed", last_error: `${error?.code ?? "ERROR"}: ${error?.message ?? error}` }));
      }
      return entry;
    }, { timeoutMs: 5_000 });
  } catch (error) {
    // Another process is repairing this checkout right now; its answer is the one that counts.
    if (error?.code === "TOPOLOGY_LOCK_TIMEOUT") return { action: "busy", path };
    throw error;
  }
}

async function registeredRoots(env, home) {
  return (await readServiceRepos(env, home)).map((repo) => resolve(repo.consumer));
}

/**
 * The checkout containing `consumer`: the nearest ancestor holding a `.git` entry, else a registered
 * repository at or above it (whose `.git` may be missing altogether). null when it is neither.
 */
export async function checkoutRoot(consumer, { env = process.env, home = homedir() } = {}) {
  const start = resolve(consumer), roots = await registeredRoots(env, home);
  for (let dir = start; ; dir = dirname(dir)) {
    if (await lstat(join(dir, ".git")).then(() => true, () => false)) return { dir, registered: roots.includes(dir) };
    if (dirname(dir) === dir) break;
  }
  const root = roots.filter((r) => start === r || start.startsWith(`${r}${sep}`)).sort((a, b) => b.length - a.length)[0];
  return root ? { dir: root, registered: true } : null;
}

/** Repair the checkout containing `consumer`, if any. The supervise entry point. */
export async function repairConsumerCheckout({ consumer, ...options }) {
  const root = await checkoutRoot(consumer, options);
  if (!root) return { action: "not-a-checkout", path: resolve(consumer) };
  return repairCheckout({ ...options, dir: root.dir, registered: root.registered });
}

/**
 * `services ensure`: every registered repository, fsck included. Returns only the ones not healthy.
 * `ensureLead` also receives the registry entry ({ key, consumer }), so a caller can restart that
 * repository's supervisor rather than launch a lead from its own process.
 */
export async function repairRegisteredCheckouts({ env = process.env, home = homedir(), ensureLead = recoverLead, ...options } = {}) {
  const reports = [];
  for (const repo of await readServiceRepos(env, home)) {
    const lead = ensureLead ? (args) => ensureLead({ ...args, repo }) : null;
    const report = await repairCheckout({ ...options, ensureLead: lead, dir: repo.consumer, registered: true, fsck: true, env, home })
      .catch((error) => ({ action: "failed", path: repo.consumer, error: `${error?.code ?? "ERROR"}: ${error?.message ?? error}` }));
    if (!["healthy", "absent"].includes(report.action)) reports.push(report);
  }
  return reports;
}

/** `lead ensure`: repair first, and refuse to mint a lead for a checkout that is still broken. */
export async function ensureCheckout(options) {
  const report = await repairConsumerCheckout({ fsck: true, ensureLead: null, ...options });
  if (["refused", "backoff", "busy"].includes(report.action)) {
    const message = report.alert?.message ?? `${report.path} is a broken checkout (${report.status ?? report.action}); not ensuring a lead for it.`;
    throw Object.assign(new Error(message), { code: "TOPOLOGY_CHECKOUT_BROKEN", details: report });
  }
  return report;
}
