/**
 * TM-382 / ADR-0041: a task can wait on a task in another repo's store.
 *
 * The danger this guards: dependenciesMet reads a blockedBy id this store cannot find as RESOLVED,
 * so a foreign id in blockedBy would unblock its task the moment it was written. Foreign blockers
 * live in foreignBlockers[] and are unmet until `tm upstream-resolved` records their landing sha.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, dependenciesMet, nextTasks, read, readEvents, unblockDependents, update, writeState } from "../../lib/store.mjs";
import { why } from "../../lib/graph.mjs";
import { dependencies, resolveForeign } from "../../lib/issue.mjs";
import { agentReadiness } from "../../lib/completeness.mjs";
import { diagnose } from "../../lib/doctor.mjs";

const TM = fileURLToPath(new URL("../../bin/tm", import.meta.url));
const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const task = (p, title, fields = {}) => create("task", { title, blockedBy: [], blocks: [], ...fields }, "", p).id;
const tm = (p, ...args) => spawnSync(process.execPath, [TM, ...args], { env: { ...process.env, TM_ROOT: p.root, TM_ALLOW_DUP: "1" }, encoding: "utf8" });
const REF = "Acme/Upstream#TM-7";
const KEY = "acme/upstream#TM-7";
const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("tm dep with a foreign ref", () => {
  it("stores it in foreignBlockers, never blockedBy, and blocks the task", () => {
    const p = store();
    const a = task(p, "waits upstream");
    dependencies(a, { add: [REF] }, p);
    const t = read(a, p);
    assert.deepEqual(t.blockedBy, []);
    assert.equal(t.foreignBlockers.length, 1);
    assert.equal(t.foreignBlockers[0].ref, KEY);
    assert.equal(t.foreignBlockers[0].resolved, null);
    assert.ok(Date.parse(t.foreignBlockers[0].added));
    assert.equal(t.status, "blocked");
  });

  it("an unresolved foreign blocker is unmet: done on a local sibling does not unblock", () => {
    const p = store();
    const a = task(p, "waits on both");
    const b = task(p, "local blocker");
    dependencies(a, { add: [b, REF] }, p);
    update(b, { status: "done" }, p);
    assert.deepEqual(unblockDependents(b, p), []);
    assert.equal(read(a, p).status, "blocked");
    assert.equal(nextTasks(p).some((t) => t.id === a), false, "tm next must not offer it");
  });

  it("a missing or unreadable foreign blocker entry does not unblock", () => {
    const p = store();
    // Entries that still name the ref reach dependenciesMet through the unblock pass.
    for (const bad of [[{ ref: KEY }], [{ ref: KEY, resolved: {} }], [{ ref: KEY, resolved: true }]]) {
      const a = task(p, `bad ${JSON.stringify(bad)}`, { status: "blocked", foreignBlockers: bad });
      assert.deepEqual(unblockDependents(KEY, p), [], JSON.stringify(bad));
      assert.equal(read(a, p).status, "blocked", JSON.stringify(bad));
    }
    // Every malformed shape, including ones the unblock pass cannot match by ref, is unmet to the
    // predicate itself and to tm next, which evaluates it for every dependency-blocked task.
    for (const bad of [[{ ref: KEY }], [null], ["acme/upstream#TM-7"], [{ ref: KEY, resolved: {} }], [{ ref: KEY, resolved: true }]]) {
      assert.equal(dependenciesMet({ foreignBlockers: bad }, new Map()), false, JSON.stringify(bad));
      const a = task(p, `next ${JSON.stringify(bad)}`, { status: "blocked", foreignBlockers: bad });
      assert.equal(nextTasks(p).some((t) => t.id === a), false, JSON.stringify(bad));
    }
  });

  it("tm why names each unresolved foreign blocker and does not call the task startable", () => {
    const p = store();
    const a = task(p, "waits upstream");
    dependencies(a, { add: [REF, "other/repo#TM-9"] }, p);
    const w = why(a, p);
    assert.equal(w.startable, false);
    assert.deepEqual(w.reasons.filter((r) => r.kind === "foreign").map((r) => r.ref), [KEY, "other/repo#TM-9"]);
    resolveForeign(REF, { landed: SHA }, p);
    assert.deepEqual(why(a, p).reasons.filter((r) => r.kind === "foreign").map((r) => r.ref), ["other/repo#TM-9"]);
  });

  it("normalises the ref: case and zero padding name one blocker in dep, upstream-resolved and unblock", () => {
    const p = store();
    const a = task(p, "waits upstream");
    dependencies(a, { add: ["A/B#TM-01", "a/b#TM-1", "a/b#TM-001"] }, p);
    assert.deepEqual(read(a, p).foreignBlockers.map((f) => f.ref), ["a/b#TM-1"]);
    const res = resolveForeign("a/B#TM-0001", { landed: SHA }, p);
    assert.deepEqual(res.resolved, [a]);
    assert.deepEqual(res.freed, [a]);
    assert.equal(read(a, p).status, "open");

    // A padded ref stored before normalisation still matches, and still removes.
    const b = task(p, "legacy padded", { status: "blocked", foreignBlockers: [{ ref: "a/b#TM-02", added: "x", resolved: null }] });
    assert.deepEqual(resolveForeign("a/b#TM-2", { landed: SHA }, p).freed, [b]);
    const c = task(p, "legacy remove", { foreignBlockers: [{ ref: "a/b#TM-03", added: "x", resolved: null }] });
    dependencies(c, { remove: ["a/b#TM-3"] }, p);
    assert.equal(read(c, p).foreignBlockers, undefined);
  });

  it("doctor does not call a task held by an unresolved foreign blocker stuck", () => {
    const p = store();
    const a = task(p, "waits upstream");
    dependencies(a, { add: [REF] }, p);
    assert.equal(diagnose(p).some((f) => f.code === "stuck-blocked" && f.id === a), false);
  });

  it("a leading - removes it; local deps are untouched", () => {
    const p = store();
    const a = task(p, "a");
    const b = task(p, "b");
    dependencies(a, { add: [b, REF] }, p);
    dependencies(a, { remove: [REF] }, p);
    assert.equal(read(a, p).foreignBlockers, undefined);
    assert.deepEqual(read(a, p).blockedBy, [b]);
  });

  it("the CLI refuses an unknown flag instead of treating it as a removal", () => {
    const p = store();
    const a = task(p, "a");
    const res = tm(p, "dep", a, "--frobnicate");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /unknown option --frobnicate/);
    const ok = tm(p, "dep", a, REF);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /acme\/upstream#TM-7 \(unresolved\)/);
  });
});

describe("tm upstream-resolved", () => {
  it("marks every holder, and reopens only tasks whose every blocker is met, emitting unblocked", () => {
    const p = store();
    const free = task(p, "only upstream");
    const still = task(p, "upstream and local");
    const local = task(p, "local blocker");
    dependencies(free, { add: [REF] }, p);
    dependencies(still, { add: [REF, local] }, p);

    const res = tm(p, "upstream-resolved", REF, "--landed", SHA, "--json");
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.deepEqual(out.resolved.sort(), [free, still].sort());
    assert.deepEqual(out.freed, [free]);

    assert.equal(read(free, p).status, "open");
    assert.equal(read(free, p).foreignBlockers[0].resolved.sha, SHA);
    assert.ok(Date.parse(read(free, p).foreignBlockers[0].resolved.at));
    assert.equal(read(still, p).status, "blocked", "the local blocker is still open");
    const ev = readEvents(p).filter((e) => e.event === "unblocked");
    assert.deepEqual(ev.map((e) => [e.id, e.by]), [[free, KEY]]);

    // The local blocker closing through the ordinary path now frees the other one.
    update(local, { status: "done" }, p);
    assert.deepEqual(unblockDependents(local, p), [still]);
  });

  it("refuses a missing or non-sha --landed, a non-foreign ref and an unknown flag", () => {
    const p = store();
    const a = task(p, "a");
    dependencies(a, { add: [REF] }, p);
    for (const args of [[REF], [REF, "--landed"], [REF, "--landed", "not-a-sha"], ["TM-001", "--landed", SHA], [REF, "--landed", SHA, "--force"]]) {
      const res = tm(p, "upstream-resolved", ...args);
      assert.notEqual(res.status, 0, args.join(" "));
    }
    assert.throws(() => resolveForeign(REF, {}, p), /--landed/);
    assert.equal(read(a, p).foreignBlockers[0].resolved, null, "nothing was marked");
    assert.equal(read(a, p).status, "blocked");
  });
});

describe("tm task new --filed-by", () => {
  it("writes filedBy and decision:intake, and the task is not ready-for-agent", () => {
    const p = store();
    const epic = create("epic", { title: "intake" }, "", p);
    writeState({ activeEpic: epic.id }, p);
    const res = tm(p, "task", "new", "filed from downstream", "--body", "why", "--ac", "it works", "--filed-by", "Acme/Consumer/lead-1/TM-42");
    assert.equal(res.status, 0, res.stderr);
    const t = read(res.stdout.split(" ")[0], p);
    assert.equal(t.title, "filed from downstream");
    assert.deepEqual(t.filedBy, { board: "acme/consumer", agent: "lead-1", task: "TM-42" });
    assert.ok(t.labels.includes("decision:intake"));
    assert.equal(t.labels.includes("ready-for-agent"), false);
    assert.equal(agentReadiness(t, { requireOnStart: ["body", "acceptance"] }).ready, false);
  });

  it("refuses a malformed --filed-by rather than baking it into the title", () => {
    const p = store();
    const res = tm(p, "task", "new", "x", "--body", "why", "--ac", "ok", "--filed-by", "nope");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /--filed-by needs/);
  });
});
