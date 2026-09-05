/**
 * lib/planner-ops — the governed operations a planning session may propose.
 *
 * Three properties carry the security of this layer, and each has a test that fails if it breaks:
 * the operation set is an allowlist rather than an interpreter, a preview costs no board state and
 * says the same thing the apply does, and an approval is bound to the exact operations approved.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { OPERATIONS, applyOps, digestOps, previewOps } from "../../lib/planner-ops.mjs";
import { create, list, read, readEvents, state, writeConfig } from "../../lib/store.mjs";

const stores = [];
after(() => cleanup(...stores));
const store = () => {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ requireEpic: false }, p);
  return p;
};

const program = () => [
  { op: "epic.create", args: { ref: "E", title: "Planner agent preflight", body: "why this epic exists" } },
  { op: "epic.activate", args: { epic: "E" } },
  { op: "task.create", args: { ref: "T1", epic: "E", title: "Add a health probe", body: "b", acceptance: ["probe reports", "failure blocks"] } },
  { op: "task.create", args: { ref: "T2", epic: "E", title: "Wire it in", body: "b", acceptance: ["wired"] } },
  { op: "task.depends", args: { task: "T2", on: ["T1"] } },
];

describe("proposing", () => {
  it("says what each operation would do, and costs no board state to ask", () => {
    const p = store();
    const pre = previewOps(program(), p);
    assert.equal(pre.ok, true);
    assert.equal(pre.operations.length, 5);
    assert.match(pre.operations[0].consequence, /independently reviewable epic "Planner agent preflight"/);
    assert.match(pre.operations[2].consequence, /2 acceptance criteria/);
    assert.match(pre.operations[3].consequence, /1 acceptance criterion/, "one criterion is not 'criteria'");
    assert.match(pre.operations[4].consequence, /cannot start until/);

    assert.equal(list("epic", {}, p).length, 0, "a preview writes nothing");
    assert.equal(list("task", {}, p).length, 0);
    assert.ok(!state(p).activeEpic);
  });

  it("refuses anything that is not a governed operation", () => {
    const p = store();
    // The blast radius of a model that has read an untrusted attachment is this list, and no more.
    for (const op of ["task.delete", "task.done", "task.dispatch", "config.write", "shell", "", null]) {
      assert.throws(
        () => previewOps([{ op, args: {} }], p),
        (e) => e.status === 400 && /not a governed planning operation/.test(e.message),
        `${JSON.stringify(op)} must be refused`,
      );
    }
    // And the table itself must not quietly grow the dangerous ones.
    assert.deepEqual(Object.keys(OPERATIONS).sort(), ["epic.activate", "epic.create", "task.create", "task.depends"]);
    assert.throws(() => previewOps([], p), (e) => e.status === 400);
    assert.throws(() => previewOps(Array(101).fill({ op: "epic.create", args: { title: "x" } }), p), (e) => e.status === 400);
  });

  it("gives every operation a verdict, in the store's own words", () => {
    const p = store();
    const pre = previewOps([
      { op: "epic.create", args: { ref: "E", title: "Fine" } },
      { op: "task.create", args: { epic: "E", title: "No criteria", body: "b", acceptance: [] } },
      { op: "task.create", args: { epic: "E", title: "No body", acceptance: ["x"] } },
      { op: "task.depends", args: { task: "GHOST", on: [] } },
    ], p);
    assert.equal(pre.ok, false, "one invalid operation makes the whole proposal unappliable");
    assert.deepEqual(pre.operations.map((o) => o.valid), [true, false, false, false]);
    // Every operation is judged, not just the first — an operator sees the whole set.
    assert.match(pre.operations[1].refusal, /acceptance criteria/);
    assert.match(pre.operations[2].refusal, /body/);
    assert.match(pre.operations[3].refusal, /at least one blocker/);
  });
});

describe("applying", () => {
  it("lands the whole program through the store's own functions", () => {
    const p = store();
    const ops = program();
    const pre = previewOps(ops, p);
    const res = applyOps(ops, { approvedDigest: pre.digest, stamp: { actor: "main" } }, p);

    assert.equal(res.created.length, 3, "one epic and two tasks");
    const epic = list("epic", {}, p)[0];
    assert.equal(state(p).activeEpic, epic.id);
    const t1 = list("task", {}, p).find((t) => t.title === "Add a health probe");
    const t2 = list("task", {}, p).find((t) => t.title === "Wire it in");
    assert.deepEqual(read(t1.id, p).acceptance.map((a) => a.text), ["probe reports", "failure blocks"]);
    assert.equal(read(t1.id, p).epic, epic.id, "a forward ref resolves to the epic this proposal made");
    assert.deepEqual(read(t2.id, p).blockedBy, [t1.id]);
    assert.deepEqual(read(t1.id, p).blocks, [t2.id], "both sides of the edge");
    assert.equal(read(t2.id, p).status, "blocked");
    assert.ok(readEvents(p).some((e) => e.event === "planner_applied" && e.digest === pre.digest));
  });

  it("refuses to apply anything but the operations that were approved", () => {
    const p = store();
    const approved = program();
    const pre = previewOps(approved, p);

    // The failure this closes: approve five operations, apply six. Without the digest check the
    // confirmation names one set, the write performs another, and every record afterwards agrees
    // with the write.
    const sneaked = [...approved, { op: "task.create", args: { epic: "E", title: "Not approved", body: "b", acceptance: ["x"] } }];
    assert.throws(
      () => applyOps(sneaked, { approvedDigest: pre.digest }, p),
      (e) => e.status === 409 && /not the one that was approved/.test(e.message),
    );
    assert.equal(list("task", {}, p).length, 0, "and nothing was applied");

    // Editing an argument is the same failure in a quieter form.
    const edited = JSON.parse(JSON.stringify(approved));
    edited[2].args.title = "Something else entirely";
    assert.throws(() => applyOps(edited, { approvedDigest: pre.digest }, p), (e) => e.status === 409);

    // And an apply with no approval at all is refused outright.
    assert.throws(() => applyOps(approved, {}, p), (e) => e.status === 400);
  });

  it("digests the same proposal identically however its keys are ordered", () => {
    const a = [{ op: "task.create", args: { title: "T", body: "b", acceptance: ["x"] } }];
    const b = [{ op: "task.create", args: { acceptance: ["x"], body: "b", title: "T" } }];
    assert.equal(digestOps(a), digestOps(b), "key order is not a difference in what was approved");
    const c = [{ op: "task.create", args: { title: "T", body: "b", acceptance: ["y"] } }];
    assert.notEqual(digestOps(a), digestOps(c), "a changed value is");
  });

  it("refuses at apply what the board refuses, in the board's own words", () => {
    const p = store();
    const ops = [{ op: "task.create", args: { title: "Gated", body: "b", acceptance: [] } }];
    const pre = previewOps(ops, p);
    assert.equal(pre.ok, false);
    assert.throws(
      () => applyOps(ops, { approvedDigest: pre.digest }, p),
      (e) => e.status === 409 && /acceptance criteria/.test(e.message),
    );
    assert.equal(list("task", {}, p).length, 0);
  });

  it("leaves no partial program when an operation fails halfway", () => {
    const p = store();
    const before = create("epic", { title: "Existing" }, "", p);
    const ops = program();
    const pre = previewOps(ops, p);

    // Fail on the last operation, by which point an epic, two tasks and an active-epic change all
    // exist — exactly the half-landed program this must make impossible.
    //
    // The trigger is board state rather than a call count: the digest and preview passes both read
    // these arguments while the board is still empty, and only the apply pass reads them after the
    // earlier operations have landed. Counting reads would encode how many times each pass happens
    // to look, which is not a property worth pinning.
    const poisoned = JSON.parse(JSON.stringify(ops));
    Object.defineProperty(poisoned[4].args, "task", {
      enumerable: true,
      get() {
        if (list("task", {}, p).length > 0) throw new Error("disk gave out");
        return "T2";
      },
    });
    assert.throws(() => applyOps(poisoned, { approvedDigest: digestOps(poisoned) }, p), /disk gave out/);

    assert.deepEqual(list("task", {}, p), [], "no task from the failed proposal survives");
    assert.deepEqual(list("epic", {}, p).map((e) => e.id), [before.id], "only the pre-existing epic remains");
    assert.ok(!state(p).activeEpic || state(p).activeEpic === null, "the active epic is put back");
    const rolled = readEvents(p).filter((e) => e.event === "planner_apply_rolled_back");
    assert.equal(rolled.length, 1);
    assert.match(rolled[0].why, /disk gave out/);
    assert.ok(!readEvents(p).some((e) => e.event === "planner_applied"), "a rolled-back apply never claims success");

    // The board still works afterwards, rather than needing `tm doctor`.
    const clean = program();
    const ok = applyOps(clean, { approvedDigest: previewOps(clean, p).digest, stamp: { actor: "main" } }, p);
    assert.equal(ok.created.length, 3);
  });

  it("never puts a pre-existing record on the rollback list", () => {
    const p = store();
    const epic = create("epic", { title: "Existing" }, "", p);
    const existing = create("task", { title: "Already here", epic: epic.id, acceptance: [{ text: "x", done: false }] }, "b", p);

    // `task.depends` names a task it does not create. If that id reached the rollback list, a
    // failed proposal would DELETE work nobody proposed changing — the worst outcome this module
    // could have, and silent.
    const ops = [
      { op: "task.create", args: { ref: "NEW", epic: epic.id, title: "New one", body: "b", acceptance: ["a"] } },
      { op: "task.depends", args: { task: existing.id, on: ["NEW"] } },
    ];
    const res = applyOps(ops, { approvedDigest: digestOps(ops), stamp: { actor: "main" } }, p);
    assert.equal(res.created.length, 1, "only the created task counts as created");
    assert.ok(!res.created.includes(existing.id));
    assert.ok(read(existing.id, p), "and the pre-existing task is still on the board");
    assert.deepEqual(read(existing.id, p).blockedBy, res.created);
  });
});

describe("references, checked at preview rather than at apply", () => {
  it("refuses a dependency on something that does not exist", () => {
    const p = store();
    const ops = [
      { op: "task.create", args: { ref: "T", title: "A", body: "b", acceptance: ["x"] } },
      { op: "task.depends", args: { task: "T", on: ["TM-999"] } },
    ];
    const pre = previewOps(ops, p);
    // Before this check the preview said "ok", showed a consequence naming TM-999, and only failed
    // once the write was under way — so the approval was granted against a description the apply
    // could not honour. A preview that disagrees with the apply is worse than none.
    assert.equal(pre.ok, false);
    assert.match(pre.operations[1].refusal, /no such task: TM-999/);
    assert.throws(() => applyOps(ops, { approvedDigest: pre.digest }, p), (e) => e.status === 409);
    assert.equal(list("task", {}, p).length, 0);
  });

  it("refuses an epic reference that names something which is not an epic", () => {
    const p = store();
    const task = create("task", { title: "Not an epic", acceptance: [{ text: "x", done: false }] }, "b", p);
    // An id that EXISTS is not the same as an epic. Without the kind check a task could be parented
    // to another task: the board would accept it and the hierarchy would be quietly wrong.
    const pre = previewOps([{ op: "task.create", args: { epic: task.id, title: "Child", body: "b", acceptance: ["x"] } }], p);
    assert.equal(pre.ok, false);
    assert.match(pre.operations[0].refusal, /is not an epic id/);

    const activate = previewOps([{ op: "epic.activate", args: { epic: task.id } }], p);
    assert.equal(activate.ok, false);
    assert.match(activate.operations[0].refusal, /is not an epic id/);
    assert.match(previewOps([{ op: "epic.activate", args: { epic: "EP-404" } }], p).operations[0].refusal, /no such epic/);
  });

  it("refuses a ref shaped like a board id", () => {
    const p = store();
    // `ref: "EP-001"` would shadow the real EP-001 for the rest of the proposal — every later
    // reference resolves to the newly minted one — so the card reads "under EP-001" and something
    // else happens. Ambiguity is worth refusing rather than resolving cleverly.
    for (const ref of ["EP-001", "TM-042", "ADR-0001"]) {
      assert.throws(
        () => previewOps([{ op: "epic.create", args: { ref, title: "x", body: "b" } }], p),
        (e) => e.status === 400 && /shaped like a board id/.test(e.message),
        ref,
      );
    }
    // A local name that is not an id shape is fine, and still resolves within the proposal.
    const ok = previewOps([
      { op: "epic.create", args: { ref: "E", title: "Fine", body: "b" } },
      { op: "task.create", args: { epic: "E", title: "Under it", body: "b", acceptance: ["x"] } },
    ], p);
    assert.equal(ok.ok, true);
  });
});
