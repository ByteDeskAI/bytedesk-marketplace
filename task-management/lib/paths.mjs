/**
 * Where the store lives.
 *
 * Rules, in order:
 *   1. TM_ROOT wins outright (the deliberate-dogfooding escape hatch).
 *   2. The *executing project* (CLAUDE_PROJECT_DIR) beats the terminal's cwd —
 *      the store follows the project being worked on, not wherever a shell sits.
 *   3. Any candidate is canonicalized to its main checkout via `git --git-common-dir`,
 *      so every worktree of a project shares one store (fleet's hooks do the same).
 *   4. A store is never created inside an *installed* copy of this plugin — the managed
 *      tree under ~/.claude/plugins, which `/plugin update` overwrites. A source checkout
 *      is not that: developing the plugin is working on a project, and the marketplace
 *      repo tracks its own work like any other repo, with no TM_ROOT and no local config.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep, basename } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function real(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** The main checkout for a directory: worktrees and the primary tree both land here. */
function canonical(dir) {
  if (!dir || !existsSync(dir)) return null;
  const common = git(dir, ["rev-parse", "--git-common-dir"]);
  if (common) return dirname(real(resolve(dir, common)));
  return real(dir);
}

/** The checkout you are actually standing in — a worktree path, not the store root. */
export function currentCheckout(cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  return git(cwd, ["rev-parse", "--show-toplevel"]) || real(cwd);
}

/**
 * Which board a directory belongs to.
 *
 * The store is per-repo, so the repo IS the board — and its identity has to survive a clone, so it
 * is the origin remote reduced to `owner/name`, not a path. Two people's checkouts of the same
 * project are the same board; two sibling repos on one machine are not, which is the case that
 * matters: `gh pr create` run in one checkout while the store resolves to another is how
 * `bytedesk-persona`'s TM-001 ended up holding 25 marketplace pull-request URLs.
 *
 * No remote (a local-only project) falls back to the directory name. That is weaker — two clones
 * in differently-named directories read as different boards — but a project with no remote has no
 * better name, and the alternative is no identity at all.
 */
/**
 * What git says this project is: `owner/name` from the origin remote, or null.
 *
 * Kept separate from the fallback on purpose. A derived identity and an assumed one are different
 * kinds of fact, and the caller has to be able to tell them apart — see `boardIdentity`.
 */
export function gitBoardId(dir) {
  if (!dir) return null;
  const remote = git(dir, ["remote", "get-url", "origin"]);
  if (!remote) return null;
  const m = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return m ? m[1].toLowerCase() : null;
}

/** Git's answer, or the directory name as a guess when the project has no remote. */
export function boardId(dir) {
  if (!dir) return null;
  return gitBoardId(dir) || basename(real(dir)).toLowerCase();
}

let installCache;
/**
 * This plugin's directory, but only when it is a *managed install* — the copy Claude Code
 * writes under ~/.claude/plugins and replaces wholesale on update. Null for a source
 * checkout. Deliberately a path test, not a git test: the installed tree can sit inside a
 * dotfiles repo, and asking git would then claim the whole home directory as the plugin.
 */
export function pluginInstallRoot() {
  if (installCache === undefined) {
    const dir = real(join(HERE, ".."));
    installCache = dir.includes(`${sep}.claude${sep}plugins${sep}`) ? dir : null;
  }
  return installCache;
}

function insidePluginInstall(dir) {
  const install = pluginInstallRoot();
  if (!install || !dir) return false;
  const d = real(dir);
  return d === install || d.startsWith(install + sep);
}

/**
 * The store root, or null when every candidate would land inside an installed copy of the
 * plugin. Callers that write must surface that as an error, not create a store anyway.
 */
export function resolveRoot() {
  if (process.env.TM_ROOT && existsSync(process.env.TM_ROOT)) return process.env.TM_ROOT;
  for (const candidate of [process.env.CLAUDE_PROJECT_DIR, process.cwd()]) {
    // Both the candidate and its canonical root: an installed copy that happens to sit
    // inside a git repo would otherwise canonicalize its way out of the guard.
    if (insidePluginInstall(candidate)) continue;
    const root = canonical(candidate);
    if (root && !insidePluginInstall(root)) return root;
  }
  return null;
}

/** A pre-v0.2 store stranded in a worktree, from before stores were shared. */
export function legacyStore(root = resolveRoot()) {
  const checkout = currentCheckout();
  if (!checkout || !root || real(checkout) === real(root)) return null;
  const stranded = join(checkout, ".bytedesk", "task-management");
  return existsSync(stranded) ? stranded : null;
}

export function paths(root = resolveRoot()) {
  if (!root) {
    return {
      root: null,
      base: null,
      unavailable:
        "task-management refuses to create a store inside an installed copy of itself — " +
        "/plugin update would wipe it. Run tm from your project, or set TM_ROOT to it.",
    };
  }
  const base = join(root, ".bytedesk", "task-management");
  return {
    root,
    base,
    epics: join(base, "epics"),
    tasks: join(base, "tasks"),
    adrs: join(base, "adrs"),
    sprints: join(base, "sprints"),
    capabilities: join(base, "capabilities"),
    plans: join(base, "plans"),
    evidence: join(base, "evidence"),
    templates: join(base, "templates"),
    worktrees: join(root, ".bytedesk", "worktrees"),
    events: join(base, "events.jsonl"),
    index: join(base, "index.json"),
    state: join(base, "state.json"),
    config: join(base, "config.json"),
    gitignore: join(base, ".gitignore"),
    gitattributes: join(base, ".gitattributes"),
  };
}

/** Entity kind → directory key + id prefix. */
export const KINDS = {
  epic: { dir: "epics", prefix: "EP", pad: 3 },
  task: { dir: "tasks", prefix: "TM", pad: 3 },
  adr: { dir: "adrs", prefix: "ADR", pad: 4 },
  /**
   * A sprint is a kind, not a label with extra rules.
   *
   * Everything a sprint needs — an id, a markdown file, a body someone can write a goal into,
   * `create`/`read`/`list`, a status — the store already does for epics and ADRs. Inventing a
   * parallel mechanism for "a named set of tasks with a commitment" would be a second way to say
   * what the store already says once.
   */
  sprint: { dir: "sprints", prefix: "SP", pad: 3 },
  capability: { dir: "capabilities", prefix: "CAP", pad: 4 },
};


/**
 * The project this board belongs to, in title case.
 *
 * Every board called itself "task-management" — the plugin's name, which is the same on every board
 * and so tells you nothing. With two open, the header and the browser tab were identical and the
 * only way to tell them apart was the port in the URL.
 *
 * The repo's directory name is the answer: it is what a person calls the project, it needs no
 * configuration, and it is already the thing the store is scoped to. Separators become spaces and
 * each word is capitalised, so `bytedesk-persona` reads `Bytedesk Persona`.
 *
 * A word that is already mixed case is left alone: `myApp` is how someone wrote it, and
 * title-casing it to `Myapp` would be a worse name than the one they chose.
 */
export function projectName(p = paths()) {
  const dir = basename(p.root || "") || "task-management";
  return dir
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function ensureDirs(p = paths()) {
  assertRoot(p);
  for (const key of ["base", "epics", "tasks", "adrs", "sprints", "capabilities", "plans", "evidence"]) {
    mkdirSync(p[key], { recursive: true });
  }
  return p;
}

/** Guard for anything that writes. Reads should degrade quietly instead. */
export function assertRoot(p = paths()) {
  if (!p.root) throw new Error(p.unavailable);
  return p;
}

export function isInitialized(p = paths()) {
  return Boolean(p.base) && existsSync(p.base);
}
