import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { canonicalRepoId, repositoryConsumer, repoKey, stateRoot } from "../../topology/lib/repoid.mjs";
import { run } from "../../topology/lib/util.mjs";

const scratch = () => mkdtemp(join(tmpdir(), "ao-repoid-"));

async function gitInit(dir) {
  await run("git", ["init", "-q", dir]);
  await run("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "init"], {
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
}

test("linked worktrees share one canonical identity; a plain directory is its own", async (t) => {
  const root = await scratch();
  t.after(() => rm(root, { recursive: true, force: true }));

  const main = join(root, "main");
  await gitInit(main);
  await run("git", ["-C", main, "worktree", "add", "-q", join(root, "linked"), "-b", "linked-branch"]);
  await mkdir(join(root, "linked", "subdirectory"));

  const a = await canonicalRepoId(main);
  const b = await canonicalRepoId(join(root, "linked"));
  assert.equal(a.kind, "git-common-dir");
  assert.equal(a.id, b.id, "a worktree and its main checkout are ONE repository");
  assert.equal(await repositoryConsumer(join(root, "linked", "subdirectory")), main,
    "repository-scoped services normalize linked and nested consumers to the main checkout");

  const plain = join(root, "plain");
  await mkdir(plain);
  const c = await canonicalRepoId(plain);
  assert.equal(c.kind, "path");
  assert.notEqual(c.id, a.id, "an unrelated directory is a different identity");

  // Symlinked reach-arounds resolve to the same identity as the direct path.
  const alias = join(root, "alias");
  await symlink(main, alias);
  const d = await canonicalRepoId(alias);
  assert.equal(d.id, a.id, "a symlinked path into the repo is still the same repository");
});

test("repoKey is filename-safe, stable, and one-way", () => {
  const one = repoKey("/some/repo/.git");
  assert.match(one, /^[0-9a-f]{16}$/);
  assert.equal(one, repoKey("/some/repo/.git"));
  assert.notEqual(one, repoKey("/some/other/.git"));
});

test("stateRoot honours the override, then XDG, then the default home", () => {
  assert.equal(stateRoot({ AGENT_ORCHESTRATION_STATE_HOME: "/custom" }, "/home/x"), "/custom");
  assert.equal(stateRoot({ XDG_STATE_HOME: "/xdg" }, "/home/x"), join("/xdg", "bytedesk", "agent-orchestration"));
  assert.equal(stateRoot({}, "/home/x"), join("/home/x", ".local", "state", "bytedesk", "agent-orchestration"));
});
