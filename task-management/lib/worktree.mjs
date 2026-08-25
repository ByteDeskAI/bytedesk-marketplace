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
import { dirname, join, resolve } from "node:path";
import { paths } from "./paths.mjs";
import { config as readConfig, list, read, slug, update } from "./store.mjs";

const DEFAULT_SHARE = [
  { path: "node_modules", mode: "symlink" },
  { path: ".env", mode: "copy" },
  { path: ".env.local", mode: "copy" },
];

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

export function createWorktree(task, { base = "HEAD", share = true, p = paths(), config = readConfig(p) } = {}) {
  const path = worktreePath(task.id, task.title, p);
  const branch = branchName(task.id, task.title, config);
  mkdirSync(p.worktrees, { recursive: true });
  // Resuming a task reuses its branch; only a new one gets -b.
  const reuse = tryGit(p.root, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
  try {
    git(p.root, "worktree", "add", ...(reuse ? [path, branch] : ["-b", branch, path, base]));
  } catch (err) {
    throw new Error(`git worktree add failed: ${String(err.stderr || err.message).trim()}`);
  }
  const shared = share ? applyShares(path, { p, config }) : [];
  if (read(task.id, p)) update(task.id, { worktree: path, branch }, p);
  return { path, branch, shared };
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
export function removeWorktree(task, { force = false, p = paths() } = {}) {
  const path = worktreePath(task.id, task.title, p);
  if (!existsSync(path)) return { removed: false, path, reason: `no worktree at ${path}` };

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
