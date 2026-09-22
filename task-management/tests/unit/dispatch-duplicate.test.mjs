/**
 * The duplicate guard: work that landed outside the dispatch system.
 *
 * Real git, because the whole point of this guard is that it reads the
 * repository — the store cannot answer the question it asks, so a mock would
 * only test the mock.
 *
 * The incident it exists for: TM-310 was dispatched at 21:49 and the same work
 * landed on develop as f30b4bc9 at 22:19. Claims, touches and readiness all saw
 * a healthy in-flight task, because none of them look at commits.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cleanup, tempRepo } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, read, readEvents, seedGitContract, update, writeConfig } from "../../lib/store.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";
import { duplicateCommits } from "../../lib/dispatch/duplicate.mjs";

const trash = [];
after(() => cleanup(...trash));

function repoStore() {
  const root = tempRepo();
  const p = paths(root);
  ensureDirs(p);
  seedGitContract(p);
  trash.push(root);
  return p;
}

const git = (root, ...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/** A commit on the current branch whose message says whatever we need it to. */
function commit(root, message, file = `f-${Math.random().toString(36).slice(2)}.txt`) {
  execFileSync("bash", ["-c", `cd ${JSON.stringify(root)} && echo x > ${file} && git add ${file} && git commit -q -m ${JSON.stringify(message)}`]);
  return git(root, "rev-parse", "--short", "HEAD");
}

function fakeBackend() {
  return { name: "fake", available: () => true, spawn: () => ({ ok: true, run: "fake:run-1" }) };
}

describe("duplicateCommits — what counts", () => {
  it("ignores task-id prefixes, dependency mentions, and uncertain preparation", () => {
    const p = repoStore();
    const t = create("task", { title: "exact match only" }, "body", p);
    commit(p.root, `${t.id}0: unrelated task`);
    commit(p.root, `prep for ${t.id}`);
    commit(p.root, `dependency for implementation (${t.id})`);
    commit(p.root, `TM-999: depends on ${t.id}`);
    assert.deepEqual(duplicateCommits(read(t.id, p), p), []);
  });

  it("requires integration-branch ancestry, not an unmerged branch mention", () => {
    const p = repoStore();
    const t = create("task", { title: "integration evidence" }, "body", p);
    const target = git(p.root, "symbolic-ref", "--short", "HEAD");
    writeConfig({ dispatch: { integrationBranch: target } }, p);
    git(p.root, "checkout", "-qb", "unmerged");
    commit(p.root, `${t.id}: implementation`);
    assert.deepEqual(duplicateCommits(read(t.id, p), p), []);
    git(p.root, "checkout", "-q", target);
    git(p.root, "merge", "--ff-only", "unmerged");
    assert.equal(duplicateCommits(read(t.id, p), p).length, 1);
  });

  it("finds a commit naming the task", () => {
    const p = repoStore();
    const t = create("task", { title: "remove the thing" }, "body", p);
    const sha = commit(p.root, `refactor: drop the thing (${t.id})`);

    const found = duplicateCommits(read(t.id, p), p);
    assert.equal(found.length, 1, "the commit naming the task is a duplicate");
    assert.equal(found[0].sha, sha);
  });

  it("ignores the task's own branch", () => {
    const p = repoStore();
    const t = create("task", { title: "mine" }, "body", p);
    const branch = "tm/own-branch";
    git(p.root, "checkout", "-q", "-b", branch);
    commit(p.root, `wip on ${t.id}`);
    git(p.root, "checkout", "-q", "-");
    update(t.id, { branch }, p);

    assert.deepEqual(duplicateCommits(read(t.id, p), p), [], "a worker's own commits are not duplicates of itself");
  });

  it("ignores merge commits, so a task does not report itself once merged", () => {
    const p = repoStore();
    const t = create("task", { title: "merged" }, "body", p);
    const branch = "tm/merge-me";
    git(p.root, "checkout", "-q", "-b", branch);
    commit(p.root, `work for ${t.id}`);
    git(p.root, "checkout", "-q", "-");
    // The merge commit names the task and is NOT reachable from the branch.
    execFileSync("git", ["-C", p.root, "merge", "--no-ff", "-q", "-m", `Merge pull request: ${t.id}`, branch]);
    update(t.id, { branch }, p);

    assert.deepEqual(duplicateCommits(read(t.id, p), p), [], "the task's own merge is not a duplicate of it");
  });

  it("says nothing when it cannot see", () => {
    const p = repoStore();
    const t = create("task", { title: "quiet" }, "body", p);
    assert.deepEqual(duplicateCommits(read(t.id, p), { root: "/nonexistent-repo-path" }), []);
    assert.deepEqual(duplicateCommits(null, p), [], "no task is not an accusation");
  });
});

describe("dispatch — the duplicate gate", () => {
  it("refuses a task whose work already landed, and leaves the board alone", async () => {
    const p = repoStore();
    const t = create("task", { title: "already done" }, "body", p);
    commit(p.root, `${t.id}: completed the implementation`);

    const res = await dispatch(t.id, { backend: fakeBackend(), session: "s1", p });

    assert.equal(res.ok, false);
    assert.match(res.reason, /looks already done/);
    assert.equal(res.duplicates.length, 1, "the refusal names what it found");

    const after = read(t.id, p);
    assert.notEqual(after.status, "in_progress", "a refused dispatch does not start the task");
    assert.ok(!after.dispatched, "and records no worker");
  });

  it("--steal dispatches anyway", async () => {
    const p = repoStore();
    const t = create("task", { title: "override me" }, "body", p);
    commit(p.root, `${t.id}: completed the implementation`);

    const res = await dispatch(t.id, { backend: fakeBackend(), session: "s2", steal: true, p });
    assert.equal(res.ok, true, "a deliberate override is not blocked");
  });

  it("dispatchGuard false turns it off", async () => {
    const p = repoStore();
    writeConfig({ dispatch: { duplicateGuard: false } }, p);
    const t = create("task", { title: "guard off" }, "body", p);
    commit(p.root, `${t.id}: completed the implementation`);

    const res = await dispatch(t.id, { backend: fakeBackend(), session: "s3", p });
    assert.equal(res.ok, true);
  });

  it("does not refuse an unrelated repository", async () => {
    const p = repoStore();
    const t = create("task", { title: "clean" }, "body", p);
    commit(p.root, "chore: nothing to do with any task");

    const res = await dispatch(t.id, { backend: fakeBackend(), session: "s4", p });
    assert.equal(res.ok, true, "a repo with no matching commit dispatches normally");
  });
});

describe("the pool tick — a duplicate that lands mid-flight", () => {
  it("reports it without killing the worker", async () => {
    const p = repoStore();
    const t = create("task", { title: "in flight" }, "body", p);
    const ok = await dispatch(t.id, { backend: fakeBackend(), session: "s5", p });
    assert.equal(ok.ok, true, "precondition: the worker is running");

    // The duplicate lands while the worker works. Its own branch is excluded, so
    // this has to be somewhere else — the default branch the dispatch came from.
    const dupe = commit(p.root, `${t.id}: landed on the base branch`);

    const { poolTick } = await import("../../lib/dispatch/pool.mjs");
    const res = await poolTick({ p, dryRun: true });

    const flagged = (res.duplicates || []).find((d) => d.id === t.id);
    assert.ok(flagged, "the tick reports the duplicate");
    assert.equal(flagged.commits[0].sha, dupe);

    const after = read(t.id, p);
    assert.equal(after.status, "in_progress", "the worker is not killed");
    assert.ok(after.dispatched, "and keeps its dispatch record");

    const logged = readEvents(p).filter((e) => e.event === "dispatch.duplicate" && e.id === t.id);
    assert.equal(logged.length, 1, "and it is on the event log for a person to find");
  });
});
