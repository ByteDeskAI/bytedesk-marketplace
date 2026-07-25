/** Shared fixtures for node:test units. Every helper is disposable and self-cleaning. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDirs, paths } from "../../lib/paths.mjs";

export function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** A real git repo with one commit. Real git, because worktree logic tested against mocks is worthless. */
export function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "tm-test-"));
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
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

/** An initialized store in a throwaway dir. Returns the paths object the lib functions take. */
export function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "tm-store-"));
  const p = paths(dir);
  ensureDirs(p);
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
