/**
 * TM-007/TM-008 — worktree naming and shared artifacts.
 * The shares are the interesting half: a symlinked node_modules saves the disk and the
 * install, but only if it can never be committed, never clobber real work, and never
 * turn a missing file in the main checkout into an error.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addWorktree, cleanup, git, tempRepo, writeFile } from "./helpers.mjs";
import { paths } from "../../lib/paths.mjs";
import { applyShares, branchName, unlinkShares, worktreePath } from "../../lib/worktree.mjs";

const trash = [];
after(() => cleanup(...trash));

/** A main checkout plus one worktree of it, both real git. */
function repoPair() {
  const repo = tempRepo();
  const wt = addWorktree(repo, `wt${trash.length}`, `feat/wt${trash.length}`);
  trash.push(repo, wt);
  return { repo, wt, p: paths(repo) };
}

const shares = (...list) => ({ worktreeShare: list });

describe("naming", () => {
  it("puts a worktree under the store's worktrees dir, named by id and slug", () => {
    const p = paths("/tmp/proj");
    assert.equal(worktreePath("TM-007", "Add worktree support", p), join(p.worktrees, "TM-007-add-worktree-support"));
  });

  it("prefixes branches with tm/ unless config says otherwise", () => {
    assert.equal(branchName("TM-007", "Add worktree support", {}), "tm/TM-007-add-worktree-support");
    assert.equal(branchName("TM-007", "Add worktree support", { branchPrefix: "wip/" }), "wip/TM-007-add-worktree-support");
    assert.equal(branchName("TM-007", "Add it", { branchPrefix: "" }), "TM-007-add-it", "an empty prefix is a choice, not a missing value");
  });
});

describe("applyShares", () => {
  it("symlinks node_modules at the main checkout, so nothing is re-downloaded", () => {
    const { repo, wt, p } = repoPair();
    writeFile(repo, "node_modules/marker.txt", "shared");

    const applied = applyShares(wt, { p, config: shares({ path: "node_modules", mode: "symlink" }) });

    const link = join(wt, "node_modules");
    assert.equal(lstatSync(link).isSymbolicLink(), true);
    assert.equal(readlinkSync(link), join(repo, "node_modules"));
    assert.equal(readFileSync(join(link, "marker.txt"), "utf8"), "shared");
    assert.deepEqual(applied, [{ path: "node_modules", mode: "symlink", ok: true }]);
  });

  it("copies .env so per-worktree edits stay local", () => {
    const { repo, wt, p } = repoPair();
    writeFile(repo, ".env", "TOKEN=main\n");

    applyShares(wt, { p, config: shares({ path: ".env", mode: "copy" }) });
    writeFileSync(join(wt, ".env"), "TOKEN=worktree\n");

    assert.equal(lstatSync(join(wt, ".env")).isSymbolicLink(), false);
    assert.equal(readFileSync(join(repo, ".env"), "utf8"), "TOKEN=main\n");
  });

  it("hardlinks a tree without copying its bytes", () => {
    const { repo, wt, p } = repoPair();
    writeFile(repo, "cache/blob.bin", "payload");

    applyShares(wt, { p, config: shares({ path: "cache", mode: "hardlink" }) });

    const [a, b] = [join(repo, "cache/blob.bin"), join(wt, "cache/blob.bin")];
    assert.equal(readFileSync(b, "utf8"), "payload");
    assert.equal(lstatSync(a).ino, lstatSync(b).ino, "a hardlink shares the inode");
  });

  it("refuses to share a git-tracked path — a symlink over one is a committable type change", () => {
    const { repo, wt, p } = repoPair();
    writeFile(repo, "config/settings.json", "{}");
    git(repo, "add", "config/settings.json");
    git(repo, "commit", "-qm", "track settings");
    git(wt, "merge", "--ff-only", "-q", git(repo, "rev-parse", "HEAD")); // the worktree must have the file to be clobbered

    const [entry] = applyShares(wt, { p, config: shares({ path: "config/settings.json", mode: "symlink" }) });

    assert.equal(entry.ok, false);
    assert.match(entry.reason, /tracked by git/);
    assert.equal(lstatSync(join(wt, "config/settings.json")).isSymbolicLink(), false, "the tracked file must be untouched");
  });

  it("refuses to clobber a path that already exists in the worktree", () => {
    const { repo, wt, p } = repoPair();
    writeFile(repo, "node_modules/marker.txt", "main");
    writeFile(wt, "node_modules/marker.txt", "theirs");

    const [entry] = applyShares(wt, { p, config: shares({ path: "node_modules", mode: "symlink" }) });

    assert.equal(entry.ok, false);
    assert.match(entry.reason, /already exists/);
    assert.equal(readFileSync(join(wt, "node_modules/marker.txt"), "utf8"), "theirs");
  });

  it("skips a missing source quietly — not every repo has a .env", () => {
    const { wt, p } = repoPair();

    const applied = applyShares(wt, { p, config: shares({ path: ".env", mode: "copy" }) });

    assert.deepEqual(applied, [], "a missing source is nothing to report");
    assert.equal(existsSync(join(wt, ".env")), false);
  });

  it("expands **/node_modules to every workspace package, never recursing into a match", () => {
    const { repo, wt, p } = repoPair();
    writeFile(repo, "node_modules/marker.txt", "root");
    writeFile(repo, "node_modules/.pnpm/dep/node_modules/nested.txt", "must not be shared on its own");
    writeFile(repo, "packages/api/node_modules/marker.txt", "api");
    writeFile(repo, ".git/node_modules/marker.txt", "never");
    mkdirSync(join(wt, "packages/api"), { recursive: true });

    const applied = applyShares(wt, { p, config: shares({ path: "**/node_modules", mode: "symlink" }) });

    assert.deepEqual(
      applied.map((e) => e.path).sort(),
      ["node_modules", "packages/api/node_modules"],
      "one share per package, and nothing from inside a match or .git",
    );
    assert.equal(readFileSync(join(wt, "packages/api/node_modules/marker.txt"), "utf8"), "api");
  });
});

describe("unlinkShares", () => {
  it("removes the shares and leaves the main checkout whole", () => {
    const { repo, wt, p } = repoPair();
    writeFile(repo, "node_modules/marker.txt", "shared");
    writeFile(repo, ".env", "TOKEN=main\n");
    applyShares(wt, {
      p,
      config: shares({ path: "node_modules", mode: "symlink" }, { path: ".env", mode: "copy" }),
    });

    const removed = unlinkShares(wt, { p });

    assert.deepEqual(removed.sort(), [".env", "node_modules"]);
    assert.equal(existsSync(join(wt, "node_modules")), false);
    assert.equal(existsSync(join(wt, ".env")), false);
    assert.equal(readFileSync(join(repo, "node_modules/marker.txt"), "utf8"), "shared", "unlinking a share must never reach through it");
  });

  it("is a no-op on a worktree that was never shared", () => {
    const { wt, p } = repoPair();
    assert.deepEqual(unlinkShares(wt, { p }), []);
  });
});
