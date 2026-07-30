/**
 * `tm doctor` — the store is markdown in git, so it drifts.
 *
 * Each test breaks the store the way a hand edit or a merge actually breaks it, then
 * asserts that doctor names it, and that --fix leaves a store with nothing left to
 * report. The second half is what makes a repair trustworthy: a fix that silences the
 * finding without correcting the data is worse than no fix.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, read, state, update, writeState } from "../../lib/store.mjs";
import { diagnose, render, repair, repairAll } from "../../lib/doctor.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const codes = (p) => diagnose(p).map((f) => f.code);
const find = (p, code) => diagnose(p).find((f) => f.code === code);

/** Fix everything fixable, then report what is left. */
function heal(p) {
  repairAll(p);
  return diagnose(p);
}

describe("a clean store", () => {
  it("reports nothing", () => {
    const p = store();
    const e = create("epic", { title: "epic" }, "", p);
    create("task", { title: "fine", epic: e.id, acceptance: [], evidence: [], blockedBy: [], blocks: [] }, "", p);

    assert.deepEqual(diagnose(p), []);
    assert.equal(render(diagnose(p)), "no problems found");
  });
});

describe("dependency edges", () => {
  it("catches a blockedBy pointing at a task that does not exist", () => {
    const p = store();
    const t = create("task", { title: "orphaned", blockedBy: ["TM-999"] }, "", p);

    const f = find(p, "dangling-dep");
    assert.equal(f.level, "error", "a read against this graph gives a wrong answer");
    assert.ok(f.fixable);

    assert.deepEqual(heal(p), []);
    assert.deepEqual(read(t.id, p).blockedBy, [], "the broken reference is gone, not just unreported");
  });

  it("catches half an edge and writes the other end", () => {
    const p = store();
    const blocker = create("task", { title: "blocker", blocks: [] }, "", p);
    const dependent = create("task", { title: "dependent", blockedBy: [blocker.id] }, "", p);

    assert.ok(codes(p).includes("one-sided-dep"));
    assert.deepEqual(heal(p), []);
    assert.deepEqual(read(blocker.id, p).blocks, [dependent.id]);
  });

  it("mirrors the other direction too", () => {
    const p = store();
    const a = create("task", { title: "a", blocks: [] }, "", p);
    const b = create("task", { title: "b", blockedBy: [] }, "", p);
    update(a.id, { blocks: [b.id] }, p);

    assert.ok(codes(p).includes("one-sided-dep"));
    heal(p);
    assert.deepEqual(read(b.id, p).blockedBy, [a.id]);
  });

  it("finds a cycle that is not down the first edge", () => {
    const p = store();
    const a = create("task", { title: "a", blockedBy: [] }, "", p);
    const b = create("task", { title: "b", blockedBy: [] }, "", p);
    const c = create("task", { title: "c", blockedBy: [] }, "", p);
    // a waits on b and c; c waits on a. Following only blockedBy[0] would miss it.
    update(a.id, { blockedBy: [b.id, c.id] }, p);
    update(c.id, { blockedBy: [a.id] }, p);

    const f = find(p, "dep-cycle");
    assert.ok(f, "a cycle down the second edge is still a cycle");
    assert.equal(f.level, "error");
    assert.equal(f.fixable, false, "which of the edges to cut is a decision, not a typo");
  });

  it("reports a cycle once, not once per member", () => {
    const p = store();
    const a = create("task", { title: "a", blockedBy: [] }, "", p);
    const b = create("task", { title: "b", blockedBy: [a.id] }, "", p);
    update(a.id, { blockedBy: [b.id] }, p);

    assert.equal(diagnose(p).filter((f) => f.code === "dep-cycle").length, 1);
  });

  it("reopens a task left blocked with no reason once its blockers are finished", () => {
    const p = store();
    const blocker = create("task", { title: "blocker", blocks: [] }, "", p);
    const dependent = create("task", { title: "dependent", blockedBy: [blocker.id] }, "", p);
    update(blocker.id, { blocks: [dependent.id] }, p);
    update(dependent.id, { status: "blocked" }, p);
    // Closed by hand, so unblockDependents never ran.
    writeFileSync(read(blocker.id, p).file, read(blocker.id, p).file && "");
    update(blocker.id, { status: "done" }, p);

    assert.ok(codes(p).includes("stuck-blocked"));
    heal(p);
    assert.equal(read(dependent.id, p).status, "open");
  });

  it("leaves a hand-written block alone — a reason is a decision", () => {
    const p = store();
    const blocker = create("task", { title: "blocker", blocks: [] }, "", p);
    const dependent = create("task", { title: "dependent", blockedBy: [blocker.id] }, "", p);
    update(blocker.id, { blocks: [dependent.id], status: "done" }, p);
    update(dependent.id, { status: "blocked", blockedReason: "waiting on counsel" }, p);

    assert.ok(!codes(p).includes("stuck-blocked"));
    assert.equal(read(dependent.id, p).status, "blocked");
  });
});

describe("links, epics and parents", () => {
  it("writes the missing half of a Jira-shaped link", () => {
    const p = store();
    const a = create("task", { title: "a" }, "", p);
    const b = create("task", { title: "b" }, "", p);
    update(a.id, { links: [{ type: "duplicates", id: b.id }] }, p);

    assert.ok(codes(p).includes("one-sided-link"));
    heal(p);
    assert.deepEqual(read(b.id, p).links, [{ type: "duplicated by", id: a.id }]);
  });

  it("drops a link to a task that does not exist", () => {
    const p = store();
    const a = create("task", { title: "a" }, "", p);
    update(a.id, { links: [{ type: "relates to", id: "TM-404" }] }, p);

    assert.equal(find(p, "dangling-link").level, "error");
    assert.deepEqual(heal(p), []);
    assert.deepEqual(read(a.id, p).links, []);
  });

  it("names a link type the store does not know, without inventing a mirror", () => {
    const p = store();
    const a = create("task", { title: "a" }, "", p);
    const b = create("task", { title: "b" }, "", p);
    update(a.id, { links: [{ type: "supersedes", id: b.id }] }, p);

    const f = find(p, "unknown-link-type");
    assert.ok(f);
    assert.equal(f.fixable, false);
  });

  it("clears an epic reference that points at nothing", () => {
    const p = store();
    const t = create("task", { title: "orphan", epic: "EP-404" }, "", p);

    assert.equal(find(p, "orphan-epic").level, "error");
    heal(p);
    assert.equal(read(t.id, p).epic, null);
  });

  it("detaches a subtask whose parent is gone", () => {
    const p = store();
    const t = create("task", { title: "child", parent: "TM-404" }, "", p);

    assert.ok(codes(p).includes("orphan-parent"));
    heal(p);
    assert.equal(read(t.id, p).parent, undefined);
  });

  it("finds a parent chain that loops", () => {
    const p = store();
    const a = create("task", { title: "a" }, "", p);
    const b = create("task", { title: "b", parent: a.id }, "", p);
    update(a.id, { parent: b.id }, p);

    assert.ok(codes(p).includes("subtask-cycle"));
  });
});

describe("claims", () => {
  it("releases a claim on a task that no longer exists", () => {
    const p = store();
    writeState({ claims: { "TM-404": { session: "s", ts: new Date().toISOString() } } }, p);

    assert.equal(find(p, "claim-orphan").level, "error");
    heal(p);
    assert.deepEqual(state(p).claims, {});
  });

  it("releases a claim left behind on parked work", () => {
    const p = store();
    const t = create("task", { title: "paused" }, "", p);
    update(t.id, { status: "parked" }, p);
    writeState({ claims: { [t.id]: { session: "s", ts: new Date().toISOString() } } }, p);

    assert.ok(codes(p).includes("claim-stale-status"));
    heal(p);
    assert.deepEqual(state(p).claims, {});
  });

  it("releases a claim on finished work", () => {
    const p = store();
    const t = create("task", { title: "shipped" }, "", p);
    update(t.id, { status: "done" }, p);
    writeState({ claims: { [t.id]: { session: "s", ts: new Date().toISOString() } } }, p);

    assert.ok(codes(p).includes("claim-on-closed"));
    assert.deepEqual(heal(p), []);
  });

  it("reports in_progress work that nobody claimed, and does not guess a fix", () => {
    const p = store();
    const t = create("task", { title: "running" }, "", p);
    update(t.id, { status: "in_progress" }, p);

    const f = find(p, "unclaimed-wip");
    assert.ok(f);
    assert.equal(f.fixable, false, "inventing a claim would be worse than saying so");
  });
});

describe("evidence, natives and the cache", () => {
  it("drops an evidence reference whose file is gone", () => {
    const p = store();
    const t = create("task", { title: "proof", evidence: ["evidence/TM-001-gone.log"] }, "", p);

    assert.ok(codes(p).includes("missing-evidence"));
    heal(p);
    assert.deepEqual(read(t.id, p).evidence, []);
  });

  /**
   * `--fix` deletes what this finding reports, so a false positive here is not noise, it is
   * data loss. Every ref below was flagged and dropped, because the check resolved each one
   * as `join(root, ref)` and then asked the filesystem about the result.
   */
  it("leaves a url alone instead of dropping the PR that proves the task", () => {
    const p = store();
    const url = "https://github.com/ByteDeskAI/bytedesk-marketplace/pull/69";
    const t = create("task", { title: "proven", evidence: [url] }, "", p);

    assert.deepEqual(codes(p), [], "nothing on disk answers to a url, so there is nothing to report");
    heal(p);
    assert.deepEqual(read(t.id, p).evidence, [url], "the most probative ref there is must survive a repair");
  });

  it("leaves an opaque handle alone", () => {
    const p = store();
    // Recorded by hand against a real task in this project: an agent-browser session, which
    // is not a file anywhere and is still the only pointer at what was verified.
    const ref = "browser:019fb067-1c42-79bc-9e8c-1ab8a2b9ddf8";
    const t = create("task", { title: "verified in a browser", evidence: [ref] }, "", p);

    assert.deepEqual(codes(p), []);
    heal(p);
    assert.deepEqual(read(t.id, p).evidence, [ref]);
  });

  it("checks an absolute ref where it points, not underneath the store", () => {
    const p = store();
    // join(root, "/etc/hostname") is <root>/etc/hostname — absent, so a file that is right
    // there on disk read as gone.
    const outside = join(p.root, "outside.log");
    writeFileSync(outside, "build output\n");
    const t = create("task", { title: "absolute", evidence: [outside] }, "", p);

    assert.deepEqual(codes(p), [], "the file exists at the path the ref names");
    heal(p);
    assert.deepEqual(read(t.id, p).evidence, [outside]);
  });

  it("still drops an absolute ref that really is gone", () => {
    const p = store();
    const t = create("task", { title: "absolute and absent", evidence: [join(p.root, "never-written.log")] }, "", p);

    assert.ok(codes(p).includes("missing-evidence"), "resolving it correctly must not mean never checking it");
    heal(p);
    assert.deepEqual(read(t.id, p).evidence, []);
  });

  it("treats a windows drive letter as a path, not a scheme", () => {
    const p = store();
    // RFC 3986 permits a one-letter scheme, so `C:` parses as one — and skipping it would
    // mean never checking a ref that can be checked.
    const t = create("task", { title: "windows", evidence: ["C:\\logs\\build.log"] }, "", p);

    assert.ok(codes(p).includes("missing-evidence"));
    heal(p);
    assert.deepEqual(read(t.id, p).evidence, []);
  });

  it("reports a store with no git contract, and writes one", () => {
    const p = store();
    // Every board created before this shipped has no contract; that is the shape being repaired.
    rmSync(p.gitignore);
    rmSync(p.gitattributes);
    assert.ok(codes(p).includes("no-git-contract"));

    heal(p);

    assert.equal(existsSync(p.gitignore), true);
    assert.equal(existsSync(p.gitattributes), true);
    assert.equal(codes(p).includes("no-git-contract"), false, "a repair that leaves the finding is not a repair");
  });

  it("ignores exactly the files that are per-machine, and nothing else", () => {
    const p = store();
    heal(p);
    const rules = readFileSync(p.gitignore, "utf8");

    // The markdown, events.jsonl, config.json and evidence/ are the shared record — ignoring any of
    // them would quietly stop the board being committed at all, which is the point of the store.
    for (const keep of ["tasks/", "epics/", "events.jsonl", "config.json", "evidence"]) {
      assert.equal(rules.includes(`\n${keep}`), false, `${keep} is the shared record and must stay in git`);
    }
    for (const drop of ["index.json", "state.json", "dashboard.*", ".tm-tmp-*"]) {
      assert.match(rules, new RegExp(`^${drop.replace(/[.*]/g, (c) => `\\${c}`)}$`, "m"), `${drop} is per-machine`);
    }
  });

  it("gives events.jsonl a union merge, because appending on two branches is never a real conflict", () => {
    const p = store();
    heal(p);
    assert.match(readFileSync(p.gitattributes, "utf8"), /^events\.jsonl merge=union$/m);
  });

  it("does not overwrite a contract someone has edited", () => {
    const p = store();
    writeFileSync(p.gitignore, "# mine\nnothing.json\n");
    heal(p);
    assert.match(readFileSync(p.gitignore, "utf8"), /# mine/, "tm init runs on existing stores; it must not clobber");
  });

  it("catches two files claiming one id, and refuses to pick a winner", () => {
    const p = store();
    const t = create("task", { title: "the reachable one" }, "", p);
    // What concurrent creates produced before writes were serialized. `fileFor` resolves
    // an id to the first matching entry, so the second file is unreachable forever —
    // and doctor used to see only index-drift, which `--fix` reindexed into silence.
    writeFileSync(join(p.tasks, `${t.id}-the-shadow-one.md`), '---\nid: "TM-001"\ntitle: "the shadow one"\n---\n');

    const f = find(p, "duplicate-id");

    assert.ok(f, "the worst state the store can reach must not read as clean");
    assert.equal(f.level, "error");
    assert.equal(f.fixable, false, "renaming a file changes an id commits already point at");
    assert.match(f.message, /the-shadow-one/, "it must name the file you cannot otherwise find");
  });

  it("does not cry duplicate for ids that merely share a prefix", () => {
    const p = store();
    // TM-001 and TM-0011 both start with "TM-001"; a prefix match would pair them.
    create("task", { title: "first" }, "", p);
    writeFileSync(join(p.tasks, "TM-0011-later-one.md"), '---\nid: "TM-0011"\ntitle: "later one"\n---\n');

    assert.ok(!codes(p).includes("duplicate-id"));
  });

  it("catches two tasks mirroring one native task", () => {
    const p = store();
    create("task", { title: "first", nativeId: "abc" }, "", p);
    create("task", { title: "second copy", nativeId: "abc" }, "", p);

    const f = find(p, "duplicate-native");
    assert.equal(f.level, "error", "every TaskUpdate would land on whichever is found first");
    assert.equal(f.fixable, false);
  });

  it("notices index.json disagreeing with the files, and rebuilds it", () => {
    const p = store();
    create("task", { title: "real" }, "", p);
    writeFileSync(p.index, JSON.stringify({ generated: "x", epics: [], tasks: [], adrs: [] }));

    assert.ok(codes(p).includes("index-drift"));
    assert.deepEqual(heal(p), []);
  });

  it("calls a missing index drift rather than crashing", () => {
    const p = store();
    create("task", { title: "real" }, "", p);
    writeFileSync(p.index, "{ not json");

    assert.ok(codes(p).includes("index-drift"));
  });
});

describe("repairAll", () => {
  it("keeps going when one repair uncovers the next", () => {
    const p = store();
    // Dropping the dangling blocker leaves TM-001 blocked by nothing — a different
    // finding that does not exist until the first one is fixed. A single pass would
    // print its repairs and then a fresh [fixable] warning, which reads as failure.
    const t = create("task", { title: "waiting", blockedBy: ["TM-999"] }, "", p);
    update(t.id, { status: "blocked" }, p);

    const applied = repairAll(p);

    assert.ok(applied.length >= 2, `expected at least two rounds of repair, got ${applied.length}`);
    assert.deepEqual(diagnose(p), [], "and it converges on a clean store");
    assert.equal(read(t.id, p).status, "open");
  });

  it("stops rather than spinning, even if the store never settles", () => {
    const p = store();
    create("task", { title: "orphaned", blockedBy: ["TM-999"] }, "", p);

    // The bound is what stops a hang; assert it is honoured rather than ignored.
    assert.equal(repairAll(p, { passes: 1 }).length, 1);
  });

  it("does nothing on a clean store", () => {
    const p = store();
    create("task", { title: "fine" }, "", p);
    assert.deepEqual(repairAll(p), []);
  });
});

describe("render", () => {
  it("groups by level and offers the repair when there is one", () => {
    const p = store();
    create("task", { title: "orphaned", blockedBy: ["TM-999"] }, "", p);

    const text = render(diagnose(p));
    assert.match(text, /## error/);
    assert.match(text, /dangling-dep/);
    assert.match(text, /\[fixable\]/);
    assert.match(text, /tm doctor --fix/);
  });

  it("reports what it did after a repair", () => {
    const p = store();
    create("task", { title: "orphaned", blockedBy: ["TM-999"] }, "", p);
    const fixed = repair(diagnose(p), p);

    const text = render(diagnose(p), { fixed });
    assert.match(text, /## fixed \(1\)/);
    assert.match(text, /dropped TM-999/);
  });
});
