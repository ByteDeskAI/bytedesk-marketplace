/**
 * TM-201 — a dispatch branches off a defined base, not off whatever the checkout is showing.
 *
 * The main checkout is shared mutable state: a human parks it on a feature branch and walks
 * away, and every worktree cut from HEAD inherits that branch's commits. On the pool's first
 * live run three workers were each provisioned 12 commits ahead of main, carrying one
 * session's unrelated work into three PR diffs.
 *
 * Real git throughout — a base is a ref resolution, and a mock of git cannot be wrong about it.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, git, tempRepo, writeFile } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, read, seedGitContract, writeConfig } from "../../lib/store.mjs";
import { handoff } from "../../lib/render.mjs";
import { createWorktree, provision, resolveBase } from "../../lib/worktree.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";

const trash = [];
after(() => cleanup(...trash));

/**
 * A store in a real git repo whose checkout is parked on an unrelated feature branch —
 * the exact state that caused TM-201. Returns the default branch's name and the sha of the
 * commit that exists ONLY on the feature branch.
 */
function parkedRepo() {
  const root = tempRepo();
  trash.push(root);
  const p = paths(root);
  ensureDirs(p);
  seedGitContract(p);
  const defaultBranch = git(root, "rev-parse", "--abbrev-ref", "HEAD");
  git(root, "checkout", "-q", "-b", "feat/somebody-elses-work");
  writeFile(root, "their-feature.txt", "not mine\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "another session's work");
  const stray = git(root, "rev-parse", "HEAD");
  return { root, p, defaultBranch, stray };
}

/** Is `sha` an ancestor of (or equal to) `ref`? The only honest way to ask "did this leak in". */
function contains(cwd, ref, sha) {
  try {
    git(cwd, "merge-base", "--is-ancestor", sha, ref);
    return true;
  } catch {
    return false;
  }
}

const fakeBackend = () => ({ name: "fake", available: () => true, spawn: () => ({ ok: true, run: "fake:1" }) });

describe("resolveBase", () => {
  it("prefers the repo's default branch over the parked HEAD", () => {
    const { root, defaultBranch, stray } = parkedRepo();
    const base = resolveBase(root, {});
    assert.equal(base.ref, defaultBranch);
    assert.equal(base.source, "default-branch");
    assert.notEqual(base.sha, stray, "the default branch is not where the stray commit lives");
  });

  it("takes dispatch.base from config ahead of the default branch", () => {
    const { root } = parkedRepo();
    const base = resolveBase(root, { config: { dispatch: { base: "feat/somebody-elses-work" } } });
    assert.equal(base.ref, "feat/somebody-elses-work");
    assert.equal(base.source, "config");
  });

  it("takes an explicit ref ahead of everything, and does not second-guess it", () => {
    const { root } = parkedRepo();
    const base = resolveBase(root, { config: { dispatch: { base: "main" } }, requested: "HEAD~1" });
    assert.equal(base.ref, "HEAD~1");
    assert.equal(base.source, "requested");
  });

  it("falls back to HEAD only when nothing else resolves", () => {
    const root = tempRepo();
    trash.push(root);
    // No remote, and the one branch renamed out of every candidate name.
    git(root, "branch", "-m", "trunk");
    const base = resolveBase(root, {});
    assert.equal(base.ref, "HEAD");
    assert.equal(base.source, "head");
    assert.equal(base.sha, git(root, "rev-parse", "HEAD"));
  });
});

describe("a dispatch off a parked checkout", () => {
  it("cuts the worker branch from the default branch, carrying none of the parked work", async () => {
    const { root, p, defaultBranch, stray } = parkedRepo();
    // The control: without it, a test that finds nothing cannot tell "no leak" from "no fixture".
    assert.equal(contains(root, "HEAD", stray), true, "the main checkout really is parked on the stray commit");

    const t = create("task", { title: "work off a real base" }, "the body", p);
    const res = await dispatch(t.id, { backend: fakeBackend(), session: "s-base", actor: "@bot", p });
    assert.equal(res.ok, true, res.reason);

    assert.equal(contains(res.worktree, "HEAD", stray), false, "the worker branch must carry no commit of the parked branch");
    assert.equal(git(res.worktree, "rev-parse", "HEAD"), git(root, "rev-parse", defaultBranch));

    const after = read(t.id, p);
    assert.equal(after.base.ref, defaultBranch, "the task records the ref it was cut from");
    assert.equal(after.base.sha, git(root, "rev-parse", defaultBranch), "and the sha, which a moving ref cannot invalidate");
    assert.equal(after.dispatched.base.ref, defaultBranch, "the dispatched record names it too");
    assert.equal(after.dispatched.base.sha, after.base.sha);
  });

  it("honours dispatch.base when a repo wants its workers somewhere else", async () => {
    const { root, p } = parkedRepo();
    git(root, "branch", "release/next", "HEAD");
    writeConfig({ dispatch: { base: "release/next" } }, p);

    const t = create("task", { title: "cut from the release line" }, "body", p);
    const res = await dispatch(t.id, { backend: fakeBackend(), session: "s-cfg", p });
    assert.equal(res.ok, true, res.reason);
    assert.equal(read(t.id, p).base.ref, "release/next");
  });
});

describe("the base is stated where it is read", () => {
  it("names it in the handoff and in the PR the handoff tells the worker to open", () => {
    const { p, defaultBranch } = parkedRepo();
    const t = create("task", { title: "say what this is built on", labels: ["ready-for-agent"] }, "body", p);
    provision(t, { session: "s-handoff", p });

    const text = handoff(t.id, p);
    const sha = read(t.id, p).base.sha.slice(0, 12);
    assert.match(text, new RegExp(`^Base: ${defaultBranch} @ ${sha}$`, "m"), "the handoff header names the base");
    assert.match(text, new RegExp(`gh pr create .*Built on ${defaultBranch} @ ${sha}`), "so does the PR it asks for");
  });

  it("leaves a resumed branch's recorded base alone rather than restating its own tip", () => {
    const { p, defaultBranch } = parkedRepo();
    const t = create("task", { title: "resume me" }, "body", p);
    const first = createWorktree(t, { p });
    assert.equal(first.base.ref, defaultBranch);

    // Remove the checkout but keep the branch — what `tm worktree rm` then a re-dispatch does.
    git(p.root, "worktree", "remove", "--force", first.path);
    const again = createWorktree(read(t.id, p), { p });
    assert.equal(again.base, null, "reuse resolves no base");
    assert.equal(read(t.id, p).base.ref, defaultBranch, "and does not overwrite the one already recorded");
  });
});
