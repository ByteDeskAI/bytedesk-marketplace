/**
 * Where the store lives.
 *
 * Rules, in order:
 *   1. TM_ROOT wins outright (the deliberate-dogfooding escape hatch).
 *   2. The *executing project* (CLAUDE_PROJECT_DIR) beats the terminal's cwd —
 *      the store follows the project being worked on, not wherever a shell sits.
 *   3. Any candidate is canonicalized to its main checkout via `git --git-common-dir`,
 *      so every worktree of a project shares one store (fleet's hooks do the same).
 *   4. A store is never created inside this plugin's own repo. Developing the plugin
 *      must not litter it with task stores; TM_ROOT is the opt-in for that.
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

let pluginRepoCache;
/** The repo this plugin's own source lives in, if any. Cached — it cannot change mid-process. */
export function pluginRepoRoot() {
  if (pluginRepoCache === undefined) pluginRepoCache = canonical(join(HERE, ".."));
  return pluginRepoCache;
}

function insidePluginRepo(dir) {
  const plugin = pluginRepoRoot();
  if (!plugin || !dir) return false;
  const d = real(dir);
  return d === plugin || d.startsWith(plugin + sep);
}

/**
 * The store root, or null when every candidate would land inside the plugin's own
 * repo. Callers that write must surface that as an error, not create a store anyway.
 */
export function resolveRoot() {
  if (process.env.TM_ROOT && existsSync(process.env.TM_ROOT)) return process.env.TM_ROOT;
  for (const candidate of [process.env.CLAUDE_PROJECT_DIR, process.cwd()]) {
    const root = canonical(candidate);
    if (root && !insidePluginRepo(root)) return root;
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
        "task-management refuses to create a store inside its own repo. " +
        "Run tm from the project you're working on, or set TM_ROOT to dogfood deliberately.",
    };
  }
  const base = join(root, ".bytedesk", "task-management");
  return {
    root,
    base,
    epics: join(base, "epics"),
    tasks: join(base, "tasks"),
    adrs: join(base, "adrs"),
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
  for (const key of ["base", "epics", "tasks", "adrs", "plans", "evidence"]) {
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
