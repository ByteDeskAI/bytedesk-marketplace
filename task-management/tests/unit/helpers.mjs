/** Shared fixtures for node:test units. Every helper is disposable and self-cleaning. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { SESSION_ENV } from "../../lib/harness/sessions.mjs";
import { seedGitContract } from "../../lib/store.mjs";
import { writeLaunchers } from "../../lib/launcher.mjs";

/**
 * Runs `fn` with the session environment under the test's control.
 *
 * This suite runs inside a real agent session, so the harness's own session
 * variable is already exported. Setting one name and trusting it does not work:
 * `sessionId()` walks SESSION_ENV in precedence order, so a test that set
 * `CLAUDE_SESSION_ID` was silently outranked by the runner's ambient
 * `CLAUDE_CODE_SESSION_ID` and read the live session id instead of its fixture.
 * The test then passed in CI and in a bare shell, and failed only for whoever
 * ran it from inside Claude Code — which is where it is most often run.
 *
 * The list is derived from SESSION_ENV rather than written out, so adding a
 * harness to `lib/harness/sessions.mjs` cannot quietly reintroduce the leak.
 */
export function withSessionEnv(vars, fn) {
  const saved = new Map();
  for (const key of [...SESSION_ENV, ...Object.keys(vars)]) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A real git repo with one commit. Real git, because worktree logic tested against mocks is worthless. */
export function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "tm-test-"));
  TEMP_DIRS.add(dir);
  execFileSync("git", ["init", "-q", dir]);
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "# fixture\n");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
  return dir;
}

export function addWorktree(repo, name = "wt", branch = "feat/wt") {
  const path = join(repo, "..", `${name}-${Math.abs(hash(repo + name))}`);
  git(repo, "worktree", "add", "-q", path, "-b", branch);
  return path;
}

export function cleanup(...dirs) {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
    TEMP_DIRS.delete(d);
  }
}

/** An initialized store in a throwaway dir. Returns the paths object the lib functions take. */
/**
 * A store shaped like one `tm init` made, including its git contract — otherwise every doctor test
 * inherits a `no-git-contract` finding that has nothing to do with what it is testing.
 */
/**
 * Every throwaway directory this module has handed out, removed when the process ends.
 *
 * `cleanup()` in an `after()` hook covers the happy path and nothing else: a file that forgets the
 * hook leaks, and so does every interrupted run — a killed soak, a crash, a `--test-name-pattern`
 * that never reaches the hook. Four days of that left 11,034 directories and 1.1 GB in the system
 * temp dir. `exit` fires on a normal end AND on an uncaught throw, which is where the leaks came
 * from; a SIGKILL still leaks, and nothing in a test process can help that.
 */
const TEMP_DIRS = new Set();
process.once("exit", () => {
  for (const d of TEMP_DIRS) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* best effort at exit: a directory we cannot remove is not worth a failed test run */
    }
  }
});

export function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "tm-store-"));
  TEMP_DIRS.add(dir);
  const p = paths(dir);
  ensureDirs(p);
  seedGitContract(p);
  writeLaunchers(p.root);
  return p;
}

export function writeFile(dir, rel, contents = "x") {
  const target = join(dir, rel);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
