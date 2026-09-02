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
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanup, git, tempRepo, tempStore } from "./helpers.mjs";
import { create, read, seedGitContract, state, update, writeConfig, writeState } from "../../lib/store.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { diagnose, render, repair, repairAll } from "../../lib/doctor.mjs";
import { launcherDir, pluginBin, writeLaunchers } from "../../lib/launcher.mjs";

const stores = [];
const originalHome = process.env.HOME;
const isolatedGlobalHome = mkdtempSync(join(tmpdir(), "tm-doctor-global-"));
const isolatedBinDir = join(isolatedGlobalHome, ".local", "bin");
stores.push(isolatedGlobalHome);
process.env.HOME = isolatedGlobalHome;
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  cleanup(...stores);
});

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
    // "clean" now includes complete: a task with no body or criteria is itself a finding.
    create("task", { title: "fine", epic: e.id, acceptance: [{ text: "verified", done: false }], evidence: [], blockedBy: [], blocks: [] }, "details\n", p);

    assert.deepEqual(diagnose(p), []);
    assert.equal(render(diagnose(p)), "no problems found");
  });
});

describe("dependency edges", () => {
  it("catches a blockedBy pointing at a task that does not exist", () => {
    const p = store();
    const t = create("task", { title: "orphaned", blockedBy: ["TM-999"], acceptance: [{ text: "verified", done: false }] }, "details\n", p);

    const f = find(p, "dangling-dep");
    assert.equal(f.level, "error", "a read against this graph gives a wrong answer");
    assert.ok(f.fixable);

    assert.deepEqual(heal(p), []);
    assert.deepEqual(read(t.id, p).blockedBy, [], "the broken reference is gone, not just unreported");
  });

  it("catches half an edge and writes the other end", () => {
    const p = store();
    const blocker = create("task", { title: "blocker", blocks: [], acceptance: [{ text: "verified", done: false }] }, "details\n", p);
    const dependent = create("task", { title: "dependent", blockedBy: [blocker.id], acceptance: [{ text: "verified", done: false }] }, "details\n", p);

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

  it("still calls a dependency on a non-task dangling", () => {
    const p = store();
    const adr = create("adr", { title: "a decision", status: "proposed" }, "", p);
    const t = create("task", { title: "waiting on a decision", blockedBy: [adr.id] }, "", p);

    // The mirror image of the link case, and the reason the two need separate maps: a task cannot
    // be blocked by a decision record. Nothing about an ADR can satisfy `blockedBy`, so `tm next`
    // would hold this task back forever.
    const f = diagnose(p).find((x) => x.code === "dangling-dep" && x.id === t.id);
    assert.ok(f, "widening the link audit must not stop this being an error");
    assert.match(f.message, new RegExp(adr.id));
  });

  it("still calls a parent that is not a task an orphan", () => {
    const p = store();
    const adr = create("adr", { title: "a decision", status: "proposed" }, "", p);
    const t = create("task", { title: "child of a decision", parent: adr.id }, "", p);

    assert.ok(diagnose(p).some((x) => x.code === "orphan-parent" && x.id === t.id));
  });

  it("does not call a link to an ADR dangling — the CLI accepts those", () => {
    const p = store();
    const a = create("task", { title: "a" }, "", p);
    const adr = create("adr", { title: "a decision", status: "proposed" }, "", p);
    update(a.id, { links: [{ type: "relates to", id: adr.id }] }, p);

    // A store that accepts a link and then reports it as broken is worse than one that refuses it.
    assert.equal(
      diagnose(p).some((f) => f.code === "dangling-link"),
      false,
      "tm link resolves any kind; the audit has to look at the same set",
    );
  });

  it("drops a link to a task that does not exist", () => {
    const p = store();
    const a = create("task", { title: "a", acceptance: [{ text: "verified", done: false }] }, "details\n", p);
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

  it("clears a sprint reference that points at nothing", () => {
    const p = store();
    const t = create("task", { title: "orphaned sprint", sprint: "SP-404" }, "", p);

    const f = find(p, "dangling-sprint");
    assert.equal(f.level, "error");
    assert.ok(f.fixable);
    heal(p);
    assert.equal(read(t.id, p).sprint, undefined, "the broken reference is gone, not just unreported");
  });

  it("leaves a real sprint commitment alone", () => {
    const p = store();
    const s = create("sprint", { title: "Sprint 12", status: "open" }, "", p);
    create("task", { title: "committed", sprint: s.id }, "", p);
    assert.equal(codes(p).includes("dangling-sprint"), false);
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
    // Complete on every requireOnDone field, so only the claim is left to report.
    const t = create(
      "task",
      { title: "shipped", acceptance: [{ text: "verified", done: true }], evidence: ["https://example.com/proof.log"], actor: "test@example.com" },
      "details\n",
      p,
    );
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
    const t = create("task", { title: "proven", evidence: [url], acceptance: [{ text: "verified", done: false }] }, "details\n", p);

    assert.deepEqual(codes(p), [], "nothing on disk answers to a url, so there is nothing to report");
    heal(p);
    assert.deepEqual(read(t.id, p).evidence, [url], "the most probative ref there is must survive a repair");
  });

  it("leaves an opaque handle alone", () => {
    const p = store();
    // Recorded by hand against a real task in this project: an agent-browser session, which
    // is not a file anywhere and is still the only pointer at what was verified.
    const ref = "browser:019fb067-1c42-79bc-9e8c-1ab8a2b9ddf8";
    const t = create("task", { title: "verified in a browser", evidence: [ref], acceptance: [{ text: "verified", done: false }] }, "details\n", p);

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
    const t = create("task", { title: "absolute", evidence: [outside], acceptance: [{ text: "verified", done: false }] }, "details\n", p);

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

  it("reports a store an ancestor .gitignore keeps out of git", () => {
    const p = store();
    execFileSync("git", ["init", "-q", p.root]);
    assert.equal(codes(p).includes("store-ignored"), false, "a committable store is not a finding");

    // The shape that hides a whole board: a blanket rule in the repo root. Nothing complains,
    // because an ignored file makes no noise — `git status` is clean and the tasks never ship.
    writeFileSync(join(p.root, ".gitignore"), ".bytedesk/\n");

    const f = find(p, "store-ignored");
    assert.ok(f, "a store that cannot reach git is the whole plugin failing silently");
    assert.equal(f.level, "error");
    assert.match(f.message, /\.gitignore:1:\.bytedesk\//, "the finding must name the rule to edit");
  });

  it("tops up a store written before the lock rules existed", () => {
    const p = store();
    // Exactly the shape every store created before 0.11 is in.
    const shipped = readFileSync(p.gitignore, "utf8");
    writeFileSync(p.gitignore, shipped.replace(/^state\.lock(\.break)?$/gm, ""));

    const f = find(p, "stale-git-contract");
    assert.ok(f, "a contract that exists is not a contract that is current");
    assert.match(f.message, /state\.lock/);

    heal(p);
    const after = readFileSync(p.gitignore, "utf8");
    assert.match(after, /^state\.lock$/m);
    assert.match(after, /^state\.lock\.break$/m);
  });

  it("reports a contract that predates a rule this version ships, and tops it up", () => {
    const p = store();
    // The shape every pre-0.5.0 store is in: a contract that exists, so the old check called it
    // fine, but written before `port.assigned` was a rule — plus a rule of the operator's own.
    const shipped = readFileSync(p.gitignore, "utf8");
    writeFileSync(p.gitignore, `${shipped.replace(/^port\.assigned$/m, "")}\n# mine\nscratch/\n`);

    const f = find(p, "stale-git-contract");
    assert.ok(f, "a file that exists is not a file that is current");
    assert.match(f.message, /port\.assigned/, "the finding must name the rule that is missing");

    heal(p);

    const after = readFileSync(p.gitignore, "utf8");
    assert.match(after, /^port\.assigned$/m, "the missing rule is added");
    assert.match(after, /^scratch\/$/m, "a hand-added rule is never lost — appending, not rewriting");
    assert.equal(codes(p).includes("stale-git-contract"), false);
  });

  it("does not report a contract that is already current", () => {
    const p = store();
    assert.equal(codes(p).includes("stale-git-contract"), false, "a fresh store is current by construction");
    heal(p);
    // Idempotent: topping up twice must not stack duplicate rules.
    const once = readFileSync(p.gitignore, "utf8");
    heal(p);
    assert.equal(readFileSync(p.gitignore, "utf8"), once);
  });

  it("ignores exactly the files that are per-machine, and nothing else", () => {
    const p = store();
    heal(p);
    const rules = readFileSync(p.gitignore, "utf8");

    // The markdown, config.json and evidence/ are the shared record — ignoring any of
    // them would quietly stop the board being committed at all, which is the point of the store.
    for (const keep of ["tasks/", "epics/", "config.json", "evidence"]) {
      assert.equal(rules.includes(`\n${keep}`), false, `${keep} is the shared record and must stay in git`);
    }
    for (const drop of [
      "index.json",
      "state.json",
      "events.json",
      "events.jsonl",
      "events.*.jsonl",
      "bin",
      "dashboard.*",
      "dashboard.pid",
      "dashboard.port",
      "port.assigned",
      ".tm-tmp-*",
      "state.lock",
      "state.lock.break",
    ]) {
      assert.match(rules, new RegExp(`^${drop.replace(/[.*]/g, (c) => `\\${c}`)}$`, "m"), `${drop} is per-machine`);
    }
  });

  it("gitignores generated runtime files and keeps the board committable", () => {
    const repo = tempRepo();
    stores.push(repo);
    const p = paths(repo);
    ensureDirs(p);
    seedGitContract(p);
    writeFileSync(join(p.base, "dashboard.pid"), "1\n");
    writeFileSync(join(p.base, "dashboard.port"), "45001\n");
    writeFileSync(join(p.base, "dashboard.assigned-port"), "45001\n");
    writeFileSync(join(p.base, "port.assigned"), "45001\n");
    writeFileSync(join(p.base, "state.lock"), "{}\n");
    writeFileSync(join(p.base, "index.json"), "{}\n");
    writeFileSync(join(p.base, "state.json"), "{}\n");
    writeFileSync(p.events, "{}\n");
    mkdirSync(join(p.worktrees, "TM-001-x"), { recursive: true });
    writeFileSync(join(p.worktrees, "TM-001-x", "x"), "x");
    mkdirSync(join(p.base, "bin"), { recursive: true });
    writeFileSync(join(p.base, "bin", "tm"), "#!/bin/sh\n");
    writeFileSync(join(p.tasks, "keep.md"), "keep\n");
    writeFileSync(p.config, "{}\n");

    const ignored = (rel) => {
      try {
        execFileSync("git", ["check-ignore", "-q", "--", rel], { cwd: repo, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };

    for (const rel of [
      ".bytedesk/task-management/dashboard.pid",
      ".bytedesk/task-management/dashboard.port",
      ".bytedesk/task-management/dashboard.assigned-port",
      ".bytedesk/task-management/port.assigned",
      ".bytedesk/task-management/state.lock",
      ".bytedesk/task-management/index.json",
      ".bytedesk/task-management/state.json",
      ".bytedesk/task-management/events.jsonl",
      ".bytedesk/task-management/bin/tm",
      ".bytedesk/worktrees/TM-001-x/x",
    ]) {
      assert.equal(ignored(rel), true, `${rel} is generated and must stay out of git`);
    }
    for (const rel of [
      ".bytedesk/task-management/tasks/keep.md",
      ".bytedesk/task-management/config.json",
    ]) {
      assert.equal(ignored(rel), false, `${rel} is the shared record and must stay committable`);
    }
  });

  it("untracks a host file git is still carrying, and leaves it on disk", () => {
    const repo = tempRepo();
    stores.push(repo);
    const p = paths(repo);
    ensureDirs(p);
    seedGitContract(p);
    // The pre-0.13 shape: events.jsonl was the shared record, so adopters committed it.
    writeFileSync(p.events, '{"ts":"1","event":"init"}\n');
    git(repo, "add", "-f", p.events);
    git(repo, "commit", "-qm", "track events");

    const f = find(p, "tracked-cache");
    assert.ok(f, "a committed events.jsonl is the upgrade shape");
    assert.equal(f.fixable, true);
    assert.match(f.message, /events\.jsonl/);

    heal(p);
    assert.equal(codes(p).includes("tracked-cache"), false);
    assert.equal(existsSync(p.events), true, "untrack is not delete");
    assert.equal(git(repo, "ls-files", "--", p.events), "", "the next commit will drop it");
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
    create("task", { title: "real", acceptance: [{ text: "verified", done: false }] }, "details\n", p);
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

describe("project launcher migration", () => {
  it("regenerates missing canonical launchers", () => {
    const p = store();
    rmSync(join(launcherDir(p.root), "tm-hook"));

    const f = find(p, "project-launchers");
    assert.ok(f);
    assert.equal(f.fixable, true);
    assert.match(f.message, /\.bytedesk\/task-management\/bin/);

    heal(p);
    assert.equal(existsSync(join(launcherDir(p.root), "tm-hook")), true);
    assert.equal(codes(p).includes("project-launchers"), false);
  });

  it("reports but never overwrites a foreign canonical launcher", () => {
    const p = store();
    const file = join(launcherDir(p.root), "tm");
    writeFileSync(file, "#!/bin/sh\n# user-owned\n");

    const f = find(p, "project-launcher-conflict");
    assert.ok(f);
    assert.equal(f.fixable, false);
    heal(p);
    assert.equal(readFileSync(file, "utf8"), "#!/bin/sh\n# user-owned\n");
  });

  it("removes generated old-path launchers and preserves foreign siblings", () => {
    const p = store();
    const old = join(p.root, ".bytedesk", "bin");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "tm"), "#!/bin/sh\n# Generated by tm init. Project-local\n");
    writeFileSync(join(old, "tm-hook"), "#!/bin/sh\n# user-owned\n");

    assert.ok(find(p, "legacy-project-launchers"));
    const conflict = find(p, "legacy-project-launcher-conflict");
    assert.ok(conflict);
    assert.equal(conflict.fixable, false);
    heal(p);
    assert.equal(existsSync(join(old, "tm")), false);
    assert.equal(readFileSync(join(old, "tm-hook"), "utf8"), "#!/bin/sh\n# user-owned\n");
  });

  it("removes only provably owned global links during an explicit repair", () => {
    const p = store();
    const global = join(p.root, ".local", "bin");
    mkdirSync(global, { recursive: true });
    const owned = join(global, "tm");
    const foreign = join(global, "tm-hook");
    symlinkSync(pluginBin("tm"), owned);
    writeFileSync(foreign, "#!/bin/sh\n# user-owned\n");
    writeFileSync(p.config, `${JSON.stringify({ plugin: { autolink: true } }, null, 2)}\n`);
    const previous = process.env.HOME;
    process.env.HOME = p.root;
    try {
      const f = find(p, "legacy-global-links");
      assert.ok(f);
      assert.equal(f.fixable, true);
      assert.equal(lstatSync(owned).isSymbolicLink(), true, "the stale owned link is present before repair");
      repairAll(p);
      assert.throws(() => lstatSync(owned), /ENOENT/);
      assert.equal(existsSync(foreign), true);
      assert.equal(codes(p).includes("legacy-global-links"), false);
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
    }
  });

  it("removes plugin.autolink without disturbing sibling plugin configuration", () => {
    const p = store();
    const cfg = { plugin: { autolink: false, keep: "yes" } };
    writeFileSync(p.config, `${JSON.stringify(cfg, null, 2)}\n`);

    assert.ok(find(p, "legacy-autolink-config"));
    heal(p);
    const repaired = JSON.parse(readFileSync(p.config, "utf8"));
    assert.equal(Object.hasOwn(repaired.plugin, "autolink"), false);
    assert.equal(repaired.plugin.keep, "yes");
  });

  it("rewrites recognized Codex hook commands while preserving unrelated hooks", () => {
    const p = store();
    const file = join(p.root, ".codex", "hooks.json");
    mkdirSync(join(p.root, ".codex"), { recursive: true });
    writeFileSync(file, JSON.stringify({ hooks: [
      { command: "tm-hook pre-task-create" },
      { command: ".bytedesk/bin/tm-hook post-task" },
      { command: "my-hook --keep" },
    ] }, null, 2));

    const f = find(p, "legacy-codex-hooks");
    assert.ok(f);
    assert.equal(f.fixable, true);
    heal(p);
    const body = readFileSync(file, "utf8");
    assert.equal((body.match(/\.bytedesk\/task-management\/bin\/tm-hook/g) || []).length, 2);
    assert.match(body, /my-hook --keep/);
    assert.equal(codes(p).includes("legacy-codex-hooks"), false);
  });
});

describe("repairAll", () => {
  it("keeps going when one repair uncovers the next", () => {
    const p = store();
    // Dropping the dangling blocker leaves TM-001 blocked by nothing — a different
    // finding that does not exist until the first one is fixed. A single pass would
    // print its repairs and then a fresh [fixable] warning, which reads as failure.
    const t = create("task", { title: "waiting", blockedBy: ["TM-999"], acceptance: [{ text: "verified", done: false }] }, "details\n", p);
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

describe("plans (BDM-72)", () => {
  it("reports a dangling epic.plan and does not delete the pointer on --fix", () => {
    const p = store();
    const e = create("epic", { title: "ghost plan", plan: ".bytedesk/task-management/plans/gone.md" }, "", p);

    const f = find(p, "dangling-plan");
    assert.ok(f);
    assert.equal(f.level, "warning");
    assert.equal(f.fixable, false, "report-only — the pointer is a decision, not a typo");
    assert.equal(f.id, e.id);

    heal(p);
    assert.equal(read(e.id, p).plan, ".bytedesk/task-management/plans/gone.md");
    assert.ok(find(p, "dangling-plan"));
  });

  it("reports an unreferenced plans/*.md and does not delete the file", () => {
    const p = store();
    mkdirSync(p.plans, { recursive: true });
    const dest = join(p.plans, "loose.md");
    writeFileSync(dest, "# Loose\n");

    const f = find(p, "unreferenced-plan");
    assert.ok(f);
    assert.equal(f.fixable, false, "no silent delete");
    assert.match(f.message, /loose\.md/);

    heal(p);
    assert.equal(existsSync(dest), true);
    assert.ok(find(p, "unreferenced-plan"));
  });

  it("is quiet when the plan file exists and is linked", () => {
    const p = store();
    mkdirSync(p.plans, { recursive: true });
    writeFileSync(join(p.plans, "ok.md"), "# Ok\n");
    create("epic", { title: "linked", plan: ".bytedesk/task-management/plans/ok.md" }, "", p);
    assert.equal(codes(p).includes("dangling-plan"), false);
    assert.equal(codes(p).includes("unreferenced-plan"), false);
  });
});

describe("completeness findings (TM-079)", () => {
  /**
   * gateStart/gateDone refuse a task missing its required fields, but harness-mirror
   * transitions bypass the gates by design. Doctor is the audit net under them — warning
   * level and report-only, exactly like done-unmet: an error would flip doctor's exit code
   * over history nobody can rewrite, and a fix would be inventing the record.
   */
  it("audits a done task that closed without its required fields — the harness-mirror hole", () => {
    const p = store();
    const t = create("task", { title: "mirror-closed" }, "", p);
    update(t.id, { status: "done" }, p);

    const f = find(p, "incomplete-done");
    assert.ok(f, "gateDone never saw this close: a mirror bypasses it, so the audit must catch it");
    assert.equal(f.level, "warning");
    assert.equal(f.fixable, false, "doctor knows the fields are absent, not what belongs in them");
    assert.equal(f.id, t.id);
    assert.match(f.message, /done/, "the finding names the status");
    for (const field of ["body", "acceptance", "evidence", "actor"]) {
      assert.match(f.message, new RegExp(field), `the finding names the missing ${field}`);
    }
    for (const hint of ["tm edit", "tm ac", "tm evidence", "tm assign"]) {
      assert.match(f.message, new RegExp(hint), `the finding names the remedy: ${hint}`);
    }

    heal(p);
    assert.ok(find(p, "incomplete-done"), "nothing here is doctor's to invent, so --fix leaves it");
  });

  it("audits an open task carrying no body and no criteria", () => {
    const p = store();
    const t = create("task", { title: "bare" }, "", p);

    const f = find(p, "incomplete-open");
    assert.ok(f);
    assert.equal(f.level, "warning");
    assert.equal(f.fixable, false);
    assert.equal(f.id, t.id);
    assert.match(f.message, /open/, "the finding names the status");
    assert.match(f.message, /body/);
    assert.match(f.message, /acceptance/);
    assert.doesNotMatch(f.message, /evidence/, "evidence and attribution are asked for at done, not at start");
    assert.doesNotMatch(f.message, /actor/);
  });

  it("audits an in_progress task the same way", () => {
    const p = store();
    const t = create("task", { title: "running bare" }, "", p);
    update(t.id, { status: "in_progress" }, p);

    const f = find(p, "incomplete-open");
    assert.ok(f);
    assert.match(f.message, /in_progress/);
  });

  it("leaves a blocked task alone — the requirement is asked when the work actually starts", () => {
    const p = store();
    const t = create("task", { title: "waiting" }, "", p);
    update(t.id, { status: "blocked", blockedReason: "waiting on counsel" }, p);

    assert.equal(find(p, "incomplete-open"), undefined);
  });

  it("says nothing about a task that carries what its status requires", () => {
    const p = store();
    create("task", { title: "open and complete", acceptance: [{ text: "verified", done: false }] }, "details\n", p);
    const d = create(
      "task",
      { title: "done and complete", acceptance: [{ text: "verified", done: true }], evidence: ["https://example.com/proof.log"], actor: "test@example.com" },
      "details\n",
      p,
    );
    update(d.id, { status: "done" }, p);

    assert.deepEqual(diagnose(p), []);
  });

  it("stays quiet for a project that has turned the requirements off", () => {
    const p = store();
    const t = create("task", { title: "bare" }, "", p);
    update(t.id, { status: "done" }, p);
    assert.ok(find(p, "incomplete-done"), "on by default");

    writeConfig({ requireOnStart: [], requireOnDone: [] }, p);
    assert.equal(find(p, "incomplete-done"), undefined, "tm config requireOnDone '[]' is the project's escape hatch");
  });

  it("never reports these at error level — the exit code gates on stores that lie, not on untidy ones", () => {
    const p = store();
    const t = create("task", { title: "mirror-closed" }, "", p);
    update(t.id, { status: "done" }, p);
    create("task", { title: "bare" }, "", p);

    const findings = diagnose(p);
    assert.ok(findings.some((f) => f.code === "incomplete-done"));
    assert.ok(findings.some((f) => f.code === "incomplete-open"));
    // bin/tm exits 1 only when a finding is error-level, so this is the whole contract:
    // the same warnings must never put an error into the list.
    assert.equal(findings.some((f) => f.level === "error"), false);
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
