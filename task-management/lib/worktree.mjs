/**
 * A worktree per task, made cheap enough to actually use.
 *
 * A fresh `git worktree` is an empty install: no node_modules, no .env, so the first
 * thing anyone does is spend ten minutes and a gigabyte re-creating what the main
 * checkout already has. Shared artifacts fix that — symlink what is identical, copy
 * what must diverge — under three rules that keep the trick invisible to git:
 *   1. never share a tracked path (a symlink over one is a committable type change),
 *   2. never clobber something the worktree already has,
 *   3. a missing source is not an error, it is a repo without that file.
 *
 * What was shared is recorded in the worktree's git dir (outside the working tree, so
 * the manifest itself is never untracked noise) and unlinked before removal — git
 * refuses to remove a worktree while untracked files sit in it.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { paths } from "./paths.mjs";
import { config as readConfig, list, logEvent, read, release, slug, update } from "./store.mjs";
import { claimTask, claimant } from "./claims.mjs";
import { detectHostCaps } from "./hostcaps.mjs";

const DEFAULT_SHARE = [
  { path: "node_modules", mode: "symlink" },
  { path: ".env", mode: "copy" },
  { path: ".env.local", mode: "copy" },
];

/**
 * Artifacts tm itself drops in a task worktree, which git must never see.
 *
 * Every dispatch backend writes the handoff to `.tm-dispatch-prompt.md` in the
 * worktree root (dispatch/tmux.mjs `PROMPT_FILE`, and dispatch/topology.mjs
 * re-exports it). Untracked, it makes the checkout dirty — and a dirty consumer
 * is not cosmetic: agent-orchestration refuses a `write` run whose consumer has
 * anything in `git status --porcelain` (AO_CONSUMER_DIRTY), so an artifact tm
 * left behind on a previous dispatch blocks the next one. Excluding them at
 * CREATION is what makes that unreachable — a name added here is ignored before
 * any backend can write it, rather than after.
 */
const TM_WORKTREE_ARTIFACTS = [".tm-dispatch-prompt.md"];

/** How deep `**` scans. Deep enough for a workspace layout, shallow enough to stay instant. */
const SCAN_DEPTH = 6;

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** git, for questions where "no" is an answer and not a failure. */
function tryGit(cwd, ...args) {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** existsSync follows symlinks, so it calls a dangling link absent. Here it is in the way. */
function present(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

// ── naming ───────────────────────────────────────────────────────────────────

export function worktreePath(taskId, title, p = paths()) {
  return join(p.worktrees, `${taskId}-${slug(title)}`);
}

export function branchName(taskId, title, config = {}) {
  return `${config.branchPrefix ?? "tm/"}${taskId}-${slug(title)}`;
}

// ── shared artifacts ─────────────────────────────────────────────────────────

/**
 * `**​/node_modules` → every match in the main checkout, never recursing into one
 * (a pnpm workspace has one per package, plus a nested tree inside each that must
 * come along with its parent, not on its own). Anything else is a literal path.
 */
function expand(pattern, root) {
  const m = /^\*\*\/(.+)$/.exec(pattern);
  if (!m) return [pattern];
  const target = m[1];
  const hits = [];
  const walk = (rel, depth) => {
    let entries;
    try {
      entries = readdirSync(rel ? join(root, rel) : root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git") continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.name === target) {
        hits.push(child);
      } else if (depth < SCAN_DEPTH) {
        walk(child, depth + 1);
      }
    }
  };
  walk("", 0);
  return hits;
}

function place(mode, src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  if (mode === "symlink") return symlinkSync(src, dest);
  if (mode === "copy") return cpSync(src, dest, { recursive: true });
  // ponytail: no stdlib recursive hardlink; `cp -al` is one call and exists everywhere
  // this plugin runs. Swap for a walk if a Windows shell ever needs it.
  if (mode === "hardlink") {
    if (process.platform === "win32") return cpSync(src, dest, { recursive: true });
    return void execFileSync("cp", ["-al", src, dest]);
  }
  throw new Error(`unknown share mode: ${mode}`);
}

/**
 * Link the configured artifacts into a worktree. Returns one entry per candidate that
 * had something to say: `{ path, mode, ok: true }` or `{ path, mode, ok: false, reason }`.
 * Sources missing from the main checkout are silent — they are not a problem to report.
 */
export function applyShares(worktree, { p = paths(), config = readConfig(p) } = {}) {
  const root = p.root;
  const applied = [];
  for (const spec of config.worktreeShare ?? DEFAULT_SHARE) {
    for (const rel of expand(spec.path, root)) {
      const entry = { path: rel, mode: spec.mode };
      if (!present(join(root, rel))) continue;
      if (tryGit(root, "ls-files", "--error-unmatch", "--", rel) !== null) {
        applied.push({ ...entry, ok: false, reason: "tracked by git — sharing it would commit a type change" });
        continue;
      }
      if (present(join(worktree, rel))) {
        // Still ignore it: a share left by an earlier provision is just as untracked
        // as one placed now, and skipping the exclude here is how a re-dispatch
        // inherited a dirty consumer.
        ensureIgnored(worktree, root, rel);
        applied.push({ ...entry, ok: false, reason: "already exists in the worktree" });
        continue;
      }
      place(spec.mode, join(root, rel), join(worktree, rel));
      ensureIgnored(worktree, root, rel);
      applied.push({ ...entry, ok: true });
    }
  }
  writeManifest(worktree, [...readManifest(worktree), ...applied.filter((e) => e.ok).map(({ path, mode }) => ({ path, mode }))]);
  return applied;
}

/**
 * A `node_modules/` gitignore rule matches directories, so a *symlink* named
 * node_modules slips past it and shows up untracked — one `git add -A` away from being
 * committed, which is the hazard the tracked-path guard exists to prevent. git has no
 * per-worktree exclude file (info/ lives in the common dir), so the line goes there.
 * ponytail: it is a local, untracked, idempotent line naming a path the repo already
 * treats as an artifact. If that ever bites, filter shares out of the dirty check instead.
 */
function ensureIgnored(worktree, root, rel) {
  if (tryGit(worktree, "check-ignore", "-q", "--", rel) !== null) return;
  const common = tryGit(root, "rev-parse", "--git-common-dir");
  if (!common) return;
  const file = join(resolve(root, common), "info", "exclude");
  mkdirSync(dirname(file), { recursive: true });
  const current = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (current.split("\n").includes(rel)) return;
  writeFileSync(file, `${current}${current.endsWith("\n") || !current ? "" : "\n"}${rel}\n`);
}

/**
 * Exclude every artifact tm puts in a worktree, before anything can write one.
 * Called from createWorktree so it covers `share: false` checkouts too — the
 * dispatch prompt lands in those exactly the same way.
 */
export function ignoreTmArtifacts(worktree, root) {
  for (const rel of TM_WORKTREE_ARTIFACTS) ensureIgnored(worktree, root, rel);
  return [...TM_WORKTREE_ARTIFACTS];
}

function manifestFile(worktree) {
  const gitDir = tryGit(worktree, "rev-parse", "--absolute-git-dir");
  return gitDir ? join(gitDir, "tm-shares.json") : null;
}

function readManifest(worktree) {
  const file = manifestFile(worktree);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function writeManifest(worktree, entries) {
  const file = manifestFile(worktree);
  if (file) writeFileSync(file, `${JSON.stringify(entries)}\n`);
}

/** Removes the shares and hands back what they were, so a caller can put them back. */
function takeShares(worktree) {
  const taken = [];
  for (const entry of readManifest(worktree)) {
    const target = join(worktree, entry.path);
    if (!present(target)) continue;
    // rmSync unlinks a symlink rather than following it — the main checkout is never touched.
    rmSync(target, { recursive: true, force: true });
    taken.push(entry);
  }
  writeManifest(worktree, []);
  return taken;
}

/** Undo applyShares. The manifest lives with the worktree, so no store paths are needed. */
export function unlinkShares(worktree) {
  return takeShares(worktree).map((e) => e.path);
}

function restoreShares(worktree, entries, root) {
  for (const entry of entries) {
    if (!present(join(worktree, entry.path))) place(entry.mode, join(root, entry.path), join(worktree, entry.path));
  }
  writeManifest(worktree, entries);
}

// ── lifecycle ────────────────────────────────────────────────────────────────

/** Commits that exist only here. No remote at all means nothing can be unpushed. */
function unpushed(worktree) {
  const count = (...args) => Number(tryGit(worktree, "rev-list", "--count", ...args) || 0);
  if (tryGit(worktree, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")) return count("@{u}..HEAD");
  if (!tryGit(worktree, "remote")) return 0;
  return count("HEAD", "--not", "--remotes");
}

/** Resolve recorded placement before claiming or creating anything. Unknown ownership holds. */
export function taskPlacement(task, { p = paths(), config = readConfig(p) } = {}) {
  // `tm start` historically stamped its current main checkout before a task had
  // an isolated placement. That stamp is context, never permission to use main.
  const mainStamp = task.worktree && real(task.worktree) === real(p.root);
  const path = (!mainStamp && task.worktree) || worktreePath(task.id, task.title, p);
  const branch = (!mainStamp && task.branch) || branchName(task.id, task.title, config);
  if (!isAbsolute(path) || real(path) === real(p.root)) throw new Error("task worktree must be an absolute isolated checkout");
  if (!branch || tryGit(p.root, "check-ref-format", "--branch", branch) === null) throw new Error("recorded task branch is invalid");
  const conflict = list("task", {}, p).find((other) => other.id !== task.id &&
    ((other.worktree && real(other.worktree) === real(path)) || other.branch === branch) &&
    (other.status === "in_progress" || claimant(other.id, p)));
  if (conflict) throw new Error(`task placement has another writer: ${conflict.id}`);
  const registrations = (tryGit(p.root, "worktree", "list", "--porcelain") || "").split("\n\n");
  const registered = registrations.find((entry) => real(/^worktree (.+)$/m.exec(entry)?.[1] || "/__absent__") === real(path));
  if (present(path)) {
    const common = tryGit(path, "rev-parse", "--path-format=absolute", "--git-common-dir");
    const expected = tryGit(p.root, "rev-parse", "--path-format=absolute", "--git-common-dir");
    if (!registered || !common || !expected || real(common) !== real(expected) || real(tryGit(path, "rev-parse", "--show-toplevel") || "/__absent__") !== real(path)) {
      throw new Error("recorded worktree is not a registered checkout of this repository");
    }
    if (tryGit(path, "symbolic-ref", "--short", "HEAD") !== branch) throw new Error("recorded worktree branch does not match its current branch");
    return { path, branch, reused: true };
  }
  if (registered) throw new Error("recorded worktree is missing but remains registered; reconcile it before dispatch");
  const branchElsewhere = registrations.find((entry) => entry.split("\n").includes(`branch refs/heads/${branch}`));
  if (branchElsewhere) throw new Error(`task branch already belongs to another checkout: ${/^worktree (.+)$/m.exec(branchElsewhere)?.[1]}`);
  return { path, branch, reused: false };
}

/** The configured integration branch, unresolved — "HEAD" (the repo default, unnamed) when nothing is set. */
export function integrationBranch(config) {
  return String(config.dispatch?.integrationBranch ?? config.integrationBranch ?? "HEAD").trim() || "HEAD";
}

/**
 * `integrationBranch()`, resolved to a concrete branch name a `gh pr create --base` can use.
 *
 * "HEAD" is a valid `git worktree add` base — it just means "whatever the main checkout has
 * checked out" — but it names no branch a PR can target, so `gh` falls back to the repository
 * default silently (TM-235). When nothing is configured, this resolves HEAD to the main
 * checkout's actual branch name; null only for a detached HEAD, which names nothing to resolve.
 */
export function resolveIntegrationBranch(p, config = readConfig(p)) {
  const configured = integrationBranch(config);
  return configured === "HEAD" ? tryGit(p.root, "symbolic-ref", "--short", "HEAD") : configured;
}

export function createWorktree(task, { base, share = true, p = paths(), config = readConfig(p) } = {}) {
  const { path, branch, reused } = taskPlacement(task, { p, config });
  if (reused) {
    ignoreTmArtifacts(path, p.root);
    return { path, branch, shared: [], reused: true };
  }
  base ??= integrationBranch(config);
  if (!tryGit(p.root, "rev-parse", "--verify", `${base}^{commit}`)) throw new Error(`configured integration branch does not resolve: ${base}`);
  mkdirSync(p.worktrees, { recursive: true });
  // Resuming a task reuses its branch; only a new one gets -b.
  const reuse = tryGit(p.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
  try {
    git(p.root, "worktree", "add", ...(reuse ? [path, branch] : ["-b", branch, path, base]));
  } catch (err) {
    throw new Error(`git worktree add failed: ${String(err.stderr || err.message).trim()}`);
  }
  ignoreTmArtifacts(path, p.root);
  const shared = share ? applyShares(path, { p, config }) : [];
  if (read(task.id, p)) update(task.id, { worktree: path, branch }, p);
  return { path, branch, shared, reused: false };
}

/** Every git worktree of this project except the main checkout, joined to its task. */
export function listWorktrees(p = paths()) {
  const byPath = new Map(
    list("task", {}, p)
      .filter((t) => t.worktree)
      .map((t) => [real(t.worktree), t.id]),
  );
  const rows = [];
  for (const block of (tryGit(p.root, "worktree", "list", "--porcelain") ?? "").split("\n\n")) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (!path || real(path) === real(p.root)) continue;
    const exists = existsSync(path);
    rows.push({
      path,
      branch: /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null,
      taskId: byPath.get(real(path)) ?? null,
      dirty: exists ? Boolean(tryGit(path, "status", "--porcelain")) : false,
      ahead: exists ? unpushed(path) : 0,
      exists,
    });
  }
  return rows;
}

/**
 * Remove a task's worktree. Shares come out first — they are untracked files, and git
 * refuses to remove a worktree while they exist. A refusal puts them straight back.
 */
export function preserveWorkflowEvidence(task, worktree, { p = paths(), caps = null, exec = execFileSync } = {}) {
  const legacy = [join(worktree, ".orchestration", "runs"), join(worktree, ".bytedesk", "agent-orchestration", "runs")].some(existsSync);
  if (!legacy && task.dispatched?.backend !== "topology" && task.dispatchFailure?.backend !== "topology") return { ok: true, records: [] };
  const entry = (caps || detectHostCaps()).backends?.topology;
  if (!entry?.available || !entry.path) throw new Error("workflow evidence must be preserved before cleanup; ao-topology is unavailable");
  const result = JSON.parse(exec(entry.path, ["console", "preserve", "--consumer", p.root, "--worktree", worktree, "--json"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
  }));
  if (result.ok !== true || result.rejected?.length || result.records?.some((record) => !record.preserved || !record.verified)) {
    throw new Error("workflow evidence preservation is incomplete; retain the worktree and resolve producer diagnostics");
  }
  return result;
}

export function removeWorktree(task, { force = false, p = paths(), preserve = preserveWorkflowEvidence } = {}) {
  const candidate = task.worktree && real(task.worktree) !== real(p.root) ? task.worktree : worktreePath(task.id, task.title, p);
  const path = candidate;
  if (!existsSync(path)) return { removed: false, path, reason: `no worktree at ${path}` };
  taskPlacement(task, { p });
  const preservation = preserve(task, path, { p });
  if (preservation?.ok !== true) return { removed: false, path, reason: "workflow evidence preservation was not verified" };

  const shares = takeShares(path);
  const ahead = unpushed(path);
  const blocker = tryGit(path, "status", "--porcelain")
    ? "uncommitted changes"
    : ahead
      ? `${ahead} unpushed commit${ahead === 1 ? "" : "s"}`
      : null;
  if (blocker && !force) {
    restoreShares(path, shares, p.root);
    return { removed: false, path, reason: `${blocker} in ${path} — use --force` };
  }

  git(p.root, "worktree", "remove", ...(force ? ["--force"] : []), path);
  if (read(task.id, p)) update(task.id, { worktree: null }, p);
  return { removed: true, path, unlinked: shares.map((e) => e.path) };
}

/**
 * Provision a worktree for a task: claim, checkout, record, log — the whole verb `tm worktree new`
 * performs, so the CLI, MCP and the dashboard cannot disagree about what "give me a checkout" does.
 *
 * The claim comes FIRST, against the path and branch the checkout will have. Claiming after the
 * checkout existed meant a refusal left a worktree on disk for a task someone else holds — and the
 * CLI never even read the refusal, so it took the claim silently. A refused claim now returns
 * `{ ok: false, reason }` with nothing created.
 */
export function provision(task, { base, share = true, steal = false, session = null, actor = null, p = paths() } = {}) {
  const { path, branch } = taskPlacement(task, { p });
  const claim = claimTask(task.id, { session, actor, worktree: path, branch, steal, p });
  if (!claim.ok) return { ok: false, reason: claim.reason, holder: claim.holder };
  const res = createWorktree(task, { base, share, p });
  update(task.id, { worktree: res.path, branch: res.branch }, p);
  logEvent(res.reused ? "worktree_reused" : "worktree_new", { id: task.id, path: res.path, branch: res.branch, shared: res.shared.length }, p);
  return { ok: true, ...res, stolenFrom: claim.stolenFrom };
}

/** The inverse: remove, clear the fields, release the claim, log. Refusals pass through. */
export function unprovision(task, { force = false, p = paths() } = {}) {
  const res = removeWorktree(task, { force, p });
  if (!res.removed) return { ok: false, ...res };
  update(task.id, { worktree: undefined, branch: undefined }, p);
  release(task.id, p);
  logEvent("worktree_rm", { id: task.id }, p);
  return { ok: true, ...res };
}
