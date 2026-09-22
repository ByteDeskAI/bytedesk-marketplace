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
import { applyShares, branchName, createWorktree, provision, removeWorktree, preserveWorkflowEvidence, unlinkShares, worktreePath } from "../../lib/worktree.mjs";
import { create, read, seedGitContract, update, writeConfig } from "../../lib/store.mjs";
import { ensureDirs } from "../../lib/paths.mjs";
import { PROMPT_FILE } from "../../lib/dispatch/tmux.mjs";

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

describe("recorded task placement and evidence retention", () => {
  function taskStore() {
    const repo = tempRepo(); trash.push(repo);
    const p = paths(repo); ensureDirs(p); seedGitContract(p);
    return p;
  }

  it("reuses the recorded custom branch and checkout after title changes, preserving existing work", () => {
    const p = taskStore(), wt = addWorktree(p.root, "recorded-custom", "feature/kept"); trash.push(wt);
    const t = create("task", { title: "renamed task", worktree: wt, branch: "feature/kept" }, "scope", p);
    writeFileSync(join(wt, "implementation.txt"), "existing implementation");
    const result = provision(t, { session: "worker", p });
    assert.equal(result.reused, true); assert.equal(result.path, wt); assert.equal(result.branch, "feature/kept");
    assert.equal(readFileSync(join(wt, "implementation.txt"), "utf8"), "existing implementation");
  });

  it("rejects wrong repository, branch mismatch and another active task writer", () => {
    const p = taskStore(), foreign = tempRepo(); trash.push(foreign);
    const t = create("task", { title: "mismatch", worktree: foreign, branch: git(foreign, "symbolic-ref", "--short", "HEAD") }, "scope", p);
    assert.throws(() => provision(t, { session: "worker", p }), /not a registered checkout/);
    const wt = addWorktree(p.root, "matched-repo", "feature/expected"); trash.push(wt);
    update(t.id, { worktree: wt, branch: "feature/wrong" }, p);
    assert.throws(() => provision(read(t.id, p), { session: "worker", p }), /branch does not match/);
    update(t.id, { branch: "feature/expected" }, p);
    create("task", { title: "active owner", status: "in_progress", worktree: wt, branch: "feature/expected" }, "scope", p);
    assert.throws(() => provision(read(t.id, p), { session: "worker", p }), /another writer/);
  });

  it("creates a fresh branch from configured integration state, not the caller's HEAD", () => {
    const p = taskStore(), main = git(p.root, "symbolic-ref", "--short", "HEAD");
    git(p.root, "checkout", "-qb", "develop");
    writeFileSync(join(p.root, "integration.txt"), "integration branch");
    git(p.root, "add", "integration.txt"); git(p.root, "commit", "-qm", "integration change");
    const target = git(p.root, "rev-parse", "HEAD"); git(p.root, "checkout", "-q", main);
    writeConfig({ dispatch: { integrationBranch: "develop" } }, p);
    const t = create("task", { title: "new task" }, "scope", p), result = provision(t, { session: "worker", p });
    assert.equal(git(result.path, "rev-parse", "HEAD"), target);
  });

  it("never removes workflow evidence before producer preservation is verified, even with force", () => {
    const p = taskStore(), t = create("task", { title: "evidence" }, "scope", p);
    const placed = provision(t, { session: "worker", p });
    writeFileSync(join(placed.path, "evidence.txt"), "keep");
    const result = removeWorktree(read(t.id, p), { force: true, p, preserve: () => ({ ok: false }) });
    assert.equal(result.removed, false); assert.ok(existsSync(join(placed.path, "evidence.txt")));
    assert.throws(() => preserveWorkflowEvidence({ ...t, dispatched: { backend: "topology" } }, placed.path, { p, caps: { backends: { topology: { available: false } } } }), /preserved before cleanup/);
    let argv;
    const kept = preserveWorkflowEvidence({ ...t, dispatched: { backend: "topology" } }, placed.path, {
      p, caps: { backends: { topology: { available: true, path: "/fake/ao-topology" } } },
      exec: (_bin, args) => { argv = args; return JSON.stringify({ ok: true, records: [{ preserved: true, verified: true }], rejected: [] }); },
    });
    assert.equal(kept.ok, true);
    assert.deepEqual(argv, ["console", "preserve", "--consumer", p.root, "--worktree", placed.path, "--json"]);
  });
});

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

/**
 * TM-098 — a task worktree must be a CLEAN checkout by the time a backend looks at it.
 *
 * agent-orchestration resolves a `write` dispatch's consumer with requireClean, which
 * asserts `git status --porcelain --untracked-files=all` is empty and otherwise refuses
 * with AO_CONSUMER_DIRTY. Every artifact tm itself puts in the worktree therefore has to
 * be excluded before anything can observe it — at CREATION, not opportunistically.
 */
describe("tm's own worktree artifacts never dirty the checkout", () => {
  it("excludes the dispatch prompt at creation, even with sharing off", () => {
    const repo = tempRepo();
    trash.push(repo);
    const res = createWorktree({ id: "TM-900", title: "dispatch me" }, { p: paths(repo), share: false, config: {} });

    writeFileSync(join(res.path, PROMPT_FILE), "# Handoff — TM-900\n");
    assert.equal(
      git(res.path, "status", "--porcelain", "--untracked-files=all"),
      "",
      "a write dispatch refuses a dirty consumer (AO_CONSUMER_DIRTY); the prompt must already be excluded",
    );
  });

  it("excludes a share the worktree already had, which applyShares does not place", () => {
    const { repo, wt, p } = repoPair();
    writeFile(repo, "node_modules/marker.txt", "shared");
    // The worktree grew its own node_modules — an `npm install` in a checkout that was
    // provisioned with share:false, or a re-provision. applyShares refuses to clobber
    // it, and used to `continue` past the exclude with it: untracked, and dirty.
    writeFile(wt, "node_modules/other.txt", "local");

    const applied = applyShares(wt, { p, config: shares({ path: "node_modules", mode: "symlink" }) });

    assert.match(applied[0].reason, /already exists/);
    assert.equal(applied[0].ok, false);
    assert.equal(git(wt, "status", "--porcelain", "--untracked-files=all"), "", "not placed, but still excluded");
  });
});
