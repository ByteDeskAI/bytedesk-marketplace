/**
 * Where the store lives.
 *
 * Rules, in order:
 *   0. An explicit repo (`--repo <dir>`, see setRepo) wins over everything.
 *   1. TM_ROOT wins next (the deliberate-dogfooding escape hatch). Set to a missing directory it
 *      is an error, not a fall-through: the operator named a store and it is not there.
 *   2. The hook payload's cwd (the `hint`), then the *executing project* (CLAUDE_PROJECT_DIR),
 *      then the terminal's cwd — the store follows the project being worked on, not wherever a
 *      shell sits.
 *   3. Any candidate is canonicalized to its main checkout via `git --git-common-dir`,
 *      so every worktree of a project shares one store (fleet's hooks do the same).
 *   4. A store is never created inside an *installed* copy of this plugin — the managed
 *      tree under ~/.claude/plugins, which `/plugin update` overwrites. A source checkout
 *      is not that: developing the plugin is working on a project, and the marketplace
 *      repo tracks its own work like any other repo, with no TM_ROOT and no local config.
 *
 * Fail closed: where the repo is ambiguous the answer is null plus a reason that names --repo,
 * never a guess — a non-repo directory with no store, a submodule, a stale CLAUDE_PROJECT_DIR
 * that names a different repo than cwd. A global install runs from anywhere, so a wrong guess
 * would create a store in the wrong place.
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

const hasStore = (dir) => existsSync(join(dir, ".bytedesk", "task-management"));

/**
 * The main checkout for a directory: worktrees and the primary tree both land here.
 *
 * Null when the directory is not a place a store belongs: it does not exist, it is not in a work
 * tree and holds no store already (a bare cwd is not a repo), or it is a submodule — whose common
 * dir sits under the parent's `.git/modules`, so the naive answer is inside the parent's .git.
 * `explicit` (the caller named this directory with --repo) accepts a submodule as its own repo.
 * `why` receives the reason when the answer is null.
 */
function canonical(dir, { explicit = false, why = () => {} } = {}) {
  if (!dir || !existsSync(dir)) return null;
  const common = git(dir, ["rev-parse", "--git-common-dir"]);
  if (!common) {
    if (hasStore(dir)) return real(dir);
    why(`${dir} is not in a git work tree and has no task-management store`);
    return null;
  }
  const gitDir = real(resolve(dir, common));
  if (gitDir.includes(`${sep}.git${sep}modules${sep}`)) {
    if (explicit) return real(git(dir, ["rev-parse", "--show-toplevel"]) || dir);
    why(`${dir} is inside a git submodule, whose store would land inside the parent's .git`);
    return null;
  }
  return dirname(gitDir);
}

/**
 * The explicit inputs, set once per process by whoever parsed them (bin/tm: --repo; a hook: the
 * payload cwd). Module state rather than an argument because roughly a hundred library functions
 * default `p = paths()`; threading a parameter through all of them is how one caller would end up
 * resolving differently from its sibling. Never the environment: a child process inheriting it
 * would address this repo when it was spawned to work on another.
 */
let explicitRepo = null;
let payloadHint = null;
export function setRepo(dir) {
  explicitRepo = dir ? resolve(dir) : null;
}
export function setHint(dir) {
  payloadHint = dir || null;
}

/**
 * Take the global `--repo <dir>` / `--repo=<dir>` out of an argv, set it, and return the rest.
 * One parser for every entry point (tm, tm-dashboard, tm-mcp) so they cannot disagree. A flag
 * with no value throws rather than being dropped: silently ignoring it would resolve the store
 * from cwd, which is exactly the guess --repo exists to avoid.
 */
export function takeRepoFlag(args) {
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--repo" || a.startsWith("--repo=")) {
      const value = a === "--repo" ? args[++i] : a.slice("--repo=".length);
      if (!value || value.startsWith("--")) throw new Error("--repo needs a directory: --repo <dir>");
      setRepo(value);
    } else rest.push(a);
  }
  return rest;
}

/** Why the last resolveRoot() returned null, for paths() to put in its error. */
let refusal = null;

/**
 * The checkout you are actually standing in — a worktree path, not the store root.
 *
 * Takes the same inputs as resolveRoot, in the same order, so store, branch and actor come from
 * one directory. It used to read CLAUDE_PROJECT_DIR/cwd only: in a hook the store came from the
 * payload cwd and the branch from somewhere else (TM-190).
 */
export function currentCheckout(
  cwd = [explicitRepo, payloadHint, process.env.CLAUDE_PROJECT_DIR, process.cwd()].find(
    (c) => c && !insidePluginInstall(c) && existsSync(c),
  ) || process.cwd(),
) {
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

/**
 * Who git says is working here — `Name <email>`, or null.
 *
 * Deliberately NOT the board's identity (see ADR-0002). One person commits to every repo on a
 * machine, so keying identity on them would make two projects the same board and re-open the leak
 * TM-036 closed. It answers a different question — who set this board up — that nothing recorded.
 */
export function gitUser(dir) {
  if (!dir) return null;
  const name = git(dir, ["config", "user.name"]);
  const email = git(dir, ["config", "user.email"]);
  if (!name && !email) return null;
  return email ? `${name || email} <${email}>`.trim() : name;
}

let installCache;
/**
 * This plugin's directory, but only when it is a *managed install* — the copy an agent host
 * writes under its Claude, Codex, or Grok plugin area and replaces wholesale on update. Null for a source
 * checkout. Deliberately a path test, not a git test: the installed tree can sit inside a
 * dotfiles repo, and asking git would then claim the whole home directory as the plugin.
 */
export function pluginInstallRoot() {
  if (installCache === undefined) {
    const dir = real(join(HERE, ".."));
    installCache = [
      `${sep}.claude${sep}plugins${sep}`,
      `${sep}.codex${sep}plugins${sep}`,
      `${sep}.grok${sep}installed-plugins${sep}`,
    ].some((marker) => dir.includes(marker)) ? dir : null;
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
 * plugin, or the repo is ambiguous (see the header). Callers that write must surface that as an
 * error, not create a store anyway — paths() carries the reason.
 */
export function resolveRoot(hint = payloadHint, repo = explicitRepo) {
  refusal = null;
  const refuse = (msg) => {
    refusal = `${msg}. Pass --repo <dir> (the repository whose .bytedesk/task-management to use) or set TM_ROOT.`;
    return null;
  };
  if (repo) {
    if (!existsSync(repo)) return refuse(`--repo ${repo} does not exist`);
    let why = "";
    return canonical(repo, { explicit: true, why: (m) => (why = m) }) || refuse(why);
  }
  if (process.env.TM_ROOT) {
    if (!existsSync(process.env.TM_ROOT)) return refuse(`TM_ROOT=${process.env.TM_ROOT} is set but that directory does not exist`);
    return process.env.TM_ROOT;
  }
  // `hint` is a location the caller was told authoritatively — the `cwd` on a hook payload.
  // It outranks CLAUDE_PROJECT_DIR because that is inherited environment: a hook process
  // inherits whatever launched the harness, so running Codex from a Claude Code shell leaves
  // another session's project dir set. Same rule the hook already applies to session_id.
  // TM_ROOT still wins over everything: it is an explicit operator override.
  const reasons = [];
  const found = [];
  for (const [name, candidate] of [["hook cwd", hint], ["CLAUDE_PROJECT_DIR", process.env.CLAUDE_PROJECT_DIR], ["cwd", process.cwd()]]) {
    // Both the candidate and its canonical root: an installed copy that happens to sit
    // inside a git repo would otherwise canonicalize its way out of the guard.
    if (insidePluginInstall(candidate)) continue;
    const root = canonical(candidate, { why: (m) => reasons.push(m) });
    if (root && !insidePluginInstall(root)) found.push([name, root]);
    // A hook cwd that names a real project settles it; the inherited sources below only
    // disagree with one another when nothing authoritative was said.
    if (name === "hook cwd" && found.length) break;
  }
  if (!found.length) return refuse(reasons[0] || "no repository found");
  // The two inherited sources naming different repos is the stale-environment case: either one
  // is a guess that writes to a repo the caller may not mean.
  if (found.length > 1 && found[0][0] !== "hook cwd" && found[0][1] !== found[1][1]) {
    return refuse(`CLAUDE_PROJECT_DIR (${found[0][1]}) and cwd (${found[1][1]}) are different repositories`);
  }
  return found[0][1];
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
        refusal ||
        "task-management refuses to create a store inside an installed copy of itself — " +
          "/plugin update would wipe it. Run tm from your project, pass --repo <dir>, or set TM_ROOT to it.",
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
    // Sibling of the store. Worktrees live here, not under task-management/, so the
    // store's own .gitignore cannot keep them out of git.
    bytedeskGitignore: join(root, ".bytedesk", ".gitignore"),
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

/**
 * Create the store's directories. Never creates the store itself: every caller that makes
 * directories as a side effect (logging an event, registering an agent, a monitor) would otherwise
 * opt a repo in just by running there. Only `tm init` passes `{ init: true }`. A directory that is
 * already there (a legacy store, or one missing config.json — which `tm doctor` flags) just gets
 * its subdirectories; whether it is *active* is isInitialized's call, made by each entry point.
 */
export function ensureDirs(p = paths(), { init = false } = {}) {
  assertRoot(p);
  if (!init && !existsSync(p.base)) throw new Error(`task-management is not initialized in ${p.root} — run: tm init`);
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

/** Initialized means `tm init` ran — the only writer of config.json. A bare store directory is not opt-in. */
export function isInitialized(p = paths()) {
  return Boolean(p.config) && existsSync(p.config);
}
