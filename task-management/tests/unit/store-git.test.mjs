/**
 * uncommittedEntities() decides whether a store record exists only on this
 * machine. Both of its answers are expensive to get wrong:
 *
 *   false negative -> a record is lost with the laptop, which is what the
 *                     store being git-tracked exists to prevent
 *   false positive -> the warning fires when nothing is wrong, gets ignored,
 *                     and is then ignored the one time it is right
 *
 * The false positive is the one that actually happened (2026-10-08: 18 safe
 * records reported, nine of them committed an hour earlier), so the stale-ref
 * cases below are the point of this file rather than an afterthought.
 *
 * Real git repositories in a temp dir, not mocks: the behaviour under test IS
 * git's, and the bug came from a ref being stale rather than from any logic a
 * mock would reproduce.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fingerprint, uncommittedEntities } from "../../lib/store-git.mjs";

const STORE = join(".bytedesk", "task-management");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

/** A bare "remote" plus a clone of it, with a store holding one committed task. */
function world() {
  const dir = mkdtempSync(join(tmpdir(), "tm-store-git-"));
  const remote = join(dir, "remote.git");
  const work = join(dir, "work");

  git(dir, "init", "--bare", "--initial-branch=main", remote);
  git(dir, "clone", "--quiet", remote, work);
  git(work, "config", "user.email", "t@example.com");
  git(work, "config", "user.name", "Test");

  mkdirSync(join(work, STORE, "tasks"), { recursive: true });
  mkdirSync(join(work, STORE, "evidence"), { recursive: true });
  writeFileSync(join(work, STORE, "tasks", "TM-001-first.md"), "# first\n");
  git(work, "add", "-A");
  git(work, "commit", "--quiet", "-m", "seed");
  git(work, "push", "--quiet", "-u", "origin", "main");

  const p = { root: work, base: join(work, STORE) };
  return { dir, remote, work, p, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A second clone, used to push a commit the first clone has not fetched. */
function secondClone(w, name = "other") {
  const other = join(w.dir, name);
  git(w.dir, "clone", "--quiet", w.remote, other);
  git(other, "config", "user.email", "t@example.com");
  git(other, "config", "user.name", "Test");
  return other;
}

test("a clean store reports nothing", (t) => {
  const w = world();
  t.after(w.cleanup);

  const res = uncommittedEntities(w.p);
  assert.deepEqual(res.files, []);
  assert.equal(res.reason, "");
});

test("a genuinely new record is reported", (t) => {
  const w = world();
  t.after(w.cleanup);
  writeFileSync(join(w.work, STORE, "tasks", "TM-002-new.md"), "# new\n");

  const res = uncommittedEntities(w.p);
  assert.equal(res.files.length, 1);
  assert.match(res.files[0], /TM-002-new\.md$/);
});

test("a modified committed record is reported", (t) => {
  const w = world();
  t.after(w.cleanup);
  writeFileSync(join(w.work, STORE, "tasks", "TM-001-first.md"), "# first, edited\n");

  const res = uncommittedEntities(w.p);
  assert.equal(res.files.length, 1);
  assert.match(res.files[0], /TM-001-first\.md$/);
});

test("evidence logs count as records", (t) => {
  const w = world();
  t.after(w.cleanup);
  writeFileSync(join(w.work, STORE, "evidence", "TM-002-proof.log"), "ok\n");

  const res = uncommittedEntities(w.p);
  assert.equal(res.files.length, 1);
  assert.match(res.files[0], /TM-002-proof\.log$/);
});

test("non-entity files under the store are ignored", (t) => {
  const w = world();
  t.after(w.cleanup);
  // index.json, state.json and events.jsonl are per-machine, not records.
  writeFileSync(join(w.work, STORE, "index.json"), "{}\n");
  writeFileSync(join(w.work, STORE, "state.json"), "{}\n");

  assert.deepEqual(uncommittedEntities(w.p).files, []);
});

/* ─── the stale-ref cases: the bug this module exists for ─────────────────── */

test("a record committed and PUSHED elsewhere is not reported, after the fetch", (t) => {
  const w = world();
  t.after(w.cleanup);

  // Another clone commits a record and pushes it.
  const other = secondClone(w);
  mkdirSync(join(other, STORE, "tasks"), { recursive: true });
  writeFileSync(join(other, STORE, "tasks", "TM-003-elsewhere.md"), "# elsewhere\n");
  git(other, "add", "-A");
  git(other, "commit", "--quiet", "-m", "TM-003");
  git(other, "push", "--quiet", "origin", "main");

  // Our clone has the same file on disk but has NOT fetched: git status calls it
  // untracked and origin/main does not have it yet. This is exactly the 2026-10-08
  // false positive.
  writeFileSync(join(w.work, STORE, "tasks", "TM-003-elsewhere.md"), "# elsewhere\n");

  const stale = uncommittedEntities(w.p, { allowFetch: false });
  assert.equal(stale.files.length, 1, "without a fetch it cannot know, and says so");

  const fresh = uncommittedEntities(w.p);
  assert.deepEqual(fresh.files, [], "after fetching, the record is on the remote");
  assert.equal(fresh.fetched, true);
});

test("the fetch does not hide a record that differs from the remote's copy", (t) => {
  const w = world();
  t.after(w.cleanup);

  const other = secondClone(w);
  mkdirSync(join(other, STORE, "tasks"), { recursive: true });
  writeFileSync(join(other, STORE, "tasks", "TM-004-same-name.md"), "# THEIR version\n");
  git(other, "add", "-A");
  git(other, "commit", "--quiet", "-m", "TM-004");
  git(other, "push", "--quiet", "origin", "main");

  // Same path, different content. Pushing it would be a real change.
  writeFileSync(join(w.work, STORE, "tasks", "TM-004-same-name.md"), "# MY version\n");

  const res = uncommittedEntities(w.p);
  assert.equal(res.files.length, 1, "same name is not the same record");
  assert.match(res.files[0], /TM-004-same-name\.md$/);
});

test("no fetch happens when nothing looks uncommitted", (t) => {
  const w = world();
  t.after(w.cleanup);

  const res = uncommittedEntities(w.p);
  assert.deepEqual(res.files, []);
  assert.equal(res.fetched, false, "the common case must cost no network call");
});

test("a record committed here but never pushed is reported", (t) => {
  const w = world();
  t.after(w.cleanup);

  // git status is CLEAN for this file, so a check that starts from status alone
  // misses it — yet it is exactly as lost as an uncommitted one if the laptop
  // dies. Found by the end-to-end hook test, not by reading the code.
  writeFileSync(join(w.work, STORE, "tasks", "TM-007-local-only.md"), "# local only\n");
  git(w.work, "add", "-A");
  git(w.work, "commit", "--quiet", "-m", "TM-007");

  assert.equal(git(w.work, "status", "--porcelain").trim(), "", "precondition: the tree is clean");

  const res = uncommittedEntities(w.p);
  assert.equal(res.files.length, 1);
  assert.match(res.files[0], /TM-007-local-only\.md$/);
});

test("pushing that record makes it stop being reported", (t) => {
  const w = world();
  t.after(w.cleanup);
  writeFileSync(join(w.work, STORE, "tasks", "TM-008-pushed.md"), "# pushed\n");
  git(w.work, "add", "-A");
  git(w.work, "commit", "--quiet", "-m", "TM-008");
  git(w.work, "push", "--quiet", "origin", "main");

  assert.deepEqual(uncommittedEntities(w.p).files, []);
});

/* ─── degenerate inputs: silence must never be mistaken for success ───────── */

test("no upstream is reported as such, not as all-clear", (t) => {
  const w = world();
  t.after(w.cleanup);
  git(w.work, "remote", "remove", "origin");
  writeFileSync(join(w.work, STORE, "tasks", "TM-005-orphan.md"), "# orphan\n");

  const res = uncommittedEntities(w.p);
  assert.equal(res.files.length, 1);
  assert.equal(res.reason, "no upstream branch", "the caller must be able to soften the wording");
});

test("a store outside any git repo returns a reason, not a clean bill", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "tm-store-nogit-"));
  try {
    mkdirSync(join(dir, STORE, "tasks"), { recursive: true });
    writeFileSync(join(dir, STORE, "tasks", "TM-006.md"), "# x\n");

    const res = uncommittedEntities({ root: dir, base: join(dir, STORE) });
    assert.deepEqual(res.files, []);
    assert.equal(res.reason, "not a git repo");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing store is a reason, not a crash", () => {
  const res = uncommittedEntities({ root: null, base: null });
  assert.deepEqual(res.files, []);
  assert.equal(res.reason, "no store");
});

/* ─── the fingerprint, which is what stops the warning repeating ──────────── */

test("fingerprint is stable, order-independent, and changes when the set does", () => {
  const a = fingerprint(["tasks/TM-001.md", "tasks/TM-002.md"]);
  const b = fingerprint(["tasks/TM-002.md", "tasks/TM-001.md"]);
  assert.equal(a, b, "the same set in a different order is the same set");

  const grown = fingerprint(["tasks/TM-001.md", "tasks/TM-002.md", "tasks/TM-003.md"]);
  assert.notEqual(a, grown, "a record joining the set must warn again");

  const shrunk = fingerprint(["tasks/TM-001.md"]);
  assert.notEqual(a, shrunk);
  assert.notEqual(fingerprint([]), a);
});

/* ─── TM-530: every git call goes through safe-git ────────────────────────── */

test("a planted core.fsmonitor and clean filter never run during the Stop check, fetch included", (t) => {
  const w = world();
  t.after(w.cleanup);
  const marker = join(w.dir, "planted-ran");
  const script = join(w.dir, "planted.sh");
  writeFileSync(script, `#!/bin/sh\necho ran >> ${marker}\ncat\n`, { mode: 0o755 });
  // Unpushed AND dirty, so the check runs status, diff, hash-object and the fetch.
  writeFileSync(join(w.work, STORE, "tasks", "TM-010-a.md"), "# a\n");
  git(w.work, "add", "-A");
  git(w.work, "commit", "--quiet", "-m", "TM-010");
  writeFileSync(join(w.work, STORE, "tasks", "TM-011-b.md"), "# b\n");
  git(w.work, "config", "core.fsmonitor", script);
  git(w.work, "config", "filter.p.clean", script);
  writeFileSync(join(w.work, ".git", "info", "attributes"), "* filter=p\n");

  const res = uncommittedEntities(w.p);
  assert.equal(res.files.length, 2, "the check ran and found both records");
  assert.equal(res.fetched, true, "the fetch ran too");
  assert.equal(existsSync(marker), false, "the planted program must not run");

  // Control: PATH git in the same repo does run it, so the assertion above can fail.
  git(w.work, "status", "--porcelain");
  assert.equal(existsSync(marker), true, "control: plain git runs the planted fsmonitor");
});

test("a failed fetch is reported in fetchError, not thrown", (t) => {
  const w = world();
  t.after(w.cleanup);
  git(w.work, "remote", "set-url", "origin", join(w.dir, "gone.git"));
  writeFileSync(join(w.work, STORE, "tasks", "TM-012-c.md"), "# c\n");

  const res = uncommittedEntities(w.p);
  assert.equal(res.files.length, 1);
  assert.equal(res.fetched, false);
  assert.match(res.fetchError, /\S/, "the caller must be able to say the ref may be stale");
});
