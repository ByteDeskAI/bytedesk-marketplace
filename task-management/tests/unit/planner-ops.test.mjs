/**
 * lib/planner-ops — the governed operations a planning session may propose.
 *
 * Three properties carry the security of this layer, and each has a test that fails if it breaks:
 * the operation set is an allowlist rather than an interpreter, a preview costs no board state and
 * says the same thing the apply does, and an approval is bound to the exact operations approved.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { OPERATIONS, applyOps, digestOps, previewOps , journalPath, recoverInterruptedApply } from "../../lib/planner-ops.mjs";
import { create, list, read, readEvents, state, update, writeConfig, writeState } from "../../lib/store.mjs";
import { setOverride } from "../../lib/enforce.mjs";

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

describe("rollback restores what it modified, not only what it created", () => {
  it("puts a pre-existing task back when a later operation fails", () => {
    const p = store();
    const existing = create("task", { title: "Pre-existing", acceptance: [{ text: "x", done: false }], blockedBy: [], blocks: [] }, "b", p);
    const before = read(existing.id, p);

    // Valid at preview; the third operation fails once the earlier writes have landed. That is the
    // shape that mattered: `task.depends` writes BOTH sides of an edge, so a failure after it left
    // a pre-existing task pointing at a task that had just been deleted. Removing what was created
    // while leaving edits to what already existed is the half-undo that makes a board look fine
    // and be wrong.
    const ops = [
      { op: "task.create", args: { ref: "NEW", title: "New one", body: "b", acceptance: ["x"] } },
      { op: "task.depends", args: { task: existing.id, on: ["NEW"] } },
      { op: "task.depends", args: { task: existing.id, on: ["NEW"] } },
    ];
    Object.defineProperty(ops[2].args, "task", {
      enumerable: true,
      get() {
        if (list("task", {}, p).length > 1 && read(existing.id, p).blockedBy?.length) throw new Error("disk gave out");
        return existing.id;
      },
    });

    assert.throws(() => applyOps(ops, { approvedDigest: digestOps(ops), stamp: { actor: "m" } }, p), /disk gave out/);

    assert.deepEqual(list("task", {}, p).map((t) => t.id), [existing.id], "the created task is gone");
    const after = read(existing.id, p);
    assert.deepEqual(after.blockedBy, [], "and the pre-existing task is not left blocked on it");
    assert.deepEqual(after.blocks, before.blocks ?? []);
    // Everything but the write timestamp is exactly as it was.
    const fields = (doc) => { const { updated, file, ...rest } = doc; return rest; };
    assert.deepEqual(fields(after), fields(before));

    const rolled = readEvents(p).filter((e) => e.event === "planner_apply_rolled_back").at(-1);
    assert.deepEqual(rolled.restored, [existing.id], "the event names what it put back, not only what it removed");
  });
});

describe("the gates and the destination are the board's, not the planner's", () => {
  it("honours every store refusal except the one about needing an active epic", () => {
    const p = store();
    const epic = create("epic", { title: "Active" }, "", p);
    writeState({ activeEpic: epic.id }, p);
    writeConfig({ requireEpic: true, wipLimit: 1 }, p);
    const busy = create("task", { title: "In flight", epic: epic.id, acceptance: [{ text: "x", done: false }] }, "b", p);
    update(busy.id, { status: "in_progress" }, p);

    // The refusal used to be discarded whenever an epic existed, so the planner walked past the
    // WIP limit and the required-field checks: the board refused, the card said "validated", and
    // the task was created anyway. A governed surface that ignores the gates the CLI obeys is not
    // governed.
    const pre = previewOps([{ op: "task.create", args: { epic: epic.id, title: "Extra", body: "b", acceptance: ["x"] } }], p);
    assert.equal(pre.ok, false);
    assert.match(pre.operations[0].refusal, /WIP limit reached/);
    assert.throws(() => applyOps(pre.resolved, { approvedDigest: pre.digest }, p), (e) => e.status === 409);
    assert.equal(list("task", {}, p).length, 1, "and nothing was created");

    // A proposal that creates its own epic is not the situation the active-epic rule is about.
    const fresh = store();
    writeConfig({ requireEpic: true }, fresh);
    const own = previewOps([
      { op: "epic.create", args: { ref: "E", title: "New program", body: "b" } },
      { op: "task.create", args: { epic: "E", title: "Under it", body: "b", acceptance: ["x"] } },
    ], fresh);
    assert.equal(own.ok, true);
  });

  it("binds the destination it showed, so a moving active epic cannot redirect an approval", () => {
    const p = store();
    writeConfig({ requireEpic: false }, p);
    const a = create("epic", { title: "Epic A" }, "", p);
    const b = create("epic", { title: "Epic B" }, "", p);
    writeState({ activeEpic: a.id }, p);

    const pre = previewOps([{ op: "task.create", args: { title: "Where does this land?", body: "b", acceptance: ["x"] } }], p);
    // The card has to NAME the destination, or the operator is approving a placement they were
    // never shown.
    assert.match(pre.operations[0].consequence, new RegExp(`under ${a.id}`));
    assert.equal(pre.resolved[0].args.epic, a.id, "the implicit destination is made explicit before digesting");

    // Move it. Nothing about the approved proposal has changed, so it must still land where the
    // card said — previously it followed the active epic and landed elsewhere.
    writeState({ activeEpic: b.id }, p);
    applyOps(pre.resolved, { approvedDigest: pre.digest, stamp: { actor: "m" } }, p);
    assert.equal(read(list("task", {}, p)[0].id, p).epic, a.id);
  });
});

describe("a proposal cannot land a dependency loop", () => {
  it("refuses a cycle at preview, across the board and within the proposal", () => {
    const p = store();
    writeConfig({ requireEpic: false }, p);
    const a = create("task", { title: "A", acceptance: [{ text: "x", done: false }], blockedBy: [], blocks: [] }, "b", p);
    const b = create("task", { title: "B", acceptance: [{ text: "x", done: false }], blockedBy: [], blocks: [] }, "b", p);

    // Board edge first: B waits on A.
    applyOps([{ op: "task.depends", args: { task: b.id, on: [a.id] } }], { approvedDigest: digestOps([{ op: "task.depends", args: { task: b.id, on: [a.id] } }]), stamp: { actor: "m" } }, p);

    // Now close the loop. The store's own `dependencies()` refuses this, and `tm doctor` will not
    // repair a cycle once one exists — so the preview has to say no, not the apply.
    const closing = previewOps([{ op: "task.depends", args: { task: a.id, on: [b.id] } }], p);
    assert.equal(closing.ok, false);
    assert.match(closing.operations[0].refusal, /cycle/i);

    // And a loop drawn entirely inside one proposal, between two tasks it is creating, is the same
    // refusal — nothing about it is on the board yet.
    const inside = previewOps([
      { op: "task.create", args: { ref: "X", title: "X", body: "b", acceptance: ["x"] } },
      { op: "task.create", args: { ref: "Y", title: "Y", body: "b", acceptance: ["x"] } },
      { op: "task.depends", args: { task: "Y", on: ["X"] } },
      { op: "task.depends", args: { task: "X", on: ["Y"] } },
    ], p);
    assert.equal(inside.ok, false);
    assert.match(inside.operations[3].refusal, /cycle/i);
  });
});

describe("a preview costs the operator nothing", () => {
  it("does not spend the one-shot override, and the apply spends it exactly once", () => {
    const p = store();
    writeConfig({ requireEpic: true, wipLimit: 1 }, p);
    const epic = create("epic", { title: "Active" }, "", p);
    writeState({ activeEpic: epic.id }, p);
    const busy = create("task", { title: "In flight", epic: epic.id, acceptance: [{ text: "x", done: false }] }, "b", p);
    update(busy.id, { status: "in_progress" }, p);
    setOverride("operator: one-shot bypass", p);

    // `gateTaskCreate` SPENDS the override at each refusal point, and `check` called it — so
    // merely previewing wrote board state and logged `override_used` from the read-only planner
    // profile. It also broke the proposal it was previewing: the token was gone by the time the
    // apply re-checked, so an approved, "validated" set refused or rolled back. And the page
    // re-proposes on every load, so a refresh burnt it.
    const pre = previewOps([{ op: "task.create", args: { epic: epic.id, title: "Hotfix", body: "b", acceptance: ["x"] } }], p);
    assert.equal(pre.ok, true, "the override is what makes this proposal valid");
    assert.ok(state(p).override, "and previewing must not have spent it");
    assert.equal(readEvents(p).filter((e) => e.event === "override_used").length, 0);

    // The write is where it gets paid for.
    const res = applyOps(pre.resolved, { approvedDigest: pre.digest, stamp: { actor: "m" } }, p);
    assert.equal(res.created.length, 1);
    assert.equal(list("task", {}, p).length, 2, "the approved set landed rather than rolling back");
    assert.equal(state(p).override, null, "spent");
    assert.equal(readEvents(p).filter((e) => e.event === "override_used").length, 1, "once, not twice");
    assert.equal(readEvents(p).filter((e) => e.event === "planner_apply_rolled_back").length, 0);

    // Previewing twice is what a page refresh does, and it must still cost nothing.
    const again = previewOps([{ op: "task.create", args: { epic: epic.id, title: "Another", body: "b", acceptance: ["x"] } }], p);
    assert.equal(again.ok, false, "with the token gone the board's real answer shows through");
    assert.match(again.operations[0].refusal, /WIP limit reached/);
  });

  it("binds a destination even when there is no active epic to inherit", () => {
    const p = store();
    writeConfig({ requireEpic: false }, p);
    // The earlier fix only made the destination explicit when an active epic existed AT PREVIEW.
    // With none, apply still read live state — and an `epic.activate` inside the very same
    // approved set moved it, so the card said "with no epic" and the write said EP-001.
    const pre = previewOps([
      { op: "epic.create", args: { ref: "E", title: "New program", body: "b" } },
      { op: "epic.activate", args: { epic: "E" } },
      { op: "task.create", args: { title: "Where does this land?", body: "b", acceptance: ["x"] } },
    ], p);
    assert.match(pre.operations[2].consequence, /with no epic/);
    applyOps(pre.resolved, { approvedDigest: pre.digest, stamp: { actor: "m" } }, p);
    assert.equal(read(list("task", {}, p)[0].id, p).epic, null, "the write says what the card said");
  });

  it("refuses an epic reference that this proposal creates as a task", () => {
    const p = store();
    writeConfig({ requireEpic: false }, p);
    // `pending` was a bare set of ref names, so a ref declared by `task.create` satisfied a field
    // that requires an epic. Preview said "…under parent."; the apply threw in the lock once the
    // id was minted and rolled back — safe, but the operator had approved a set the server had
    // already called valid.
    const pre = previewOps([
      { op: "task.create", args: { ref: "parent", title: "Parent", body: "b", acceptance: ["x"] } },
      { op: "task.create", args: { epic: "parent", title: "Child", body: "b", acceptance: ["x"] } },
    ], p);
    assert.equal(pre.ok, false);
    assert.match(pre.operations[1].refusal, /as a task, not an epic/);
    assert.equal(list("task", {}, p).length, 0, "and nothing was written finding that out");
  });
});

describe("a landing that is killed rather than thrown out of", () => {
  it("leaves a journal that undoes exactly what it had done", () => {
    const p = store();
    writeConfig({ requireEpic: false }, p);
    const before = create("task", { title: "Already here", acceptance: [{ text: "x", done: false }], blockedBy: [], blocks: [] }, "b", p);

    // Simulate the wreckage a SIGKILL leaves: records written, active epic moved, an existing
    // record edited, and a journal naming all of it — but no exception, so no `catch` ever ran.
    // Before the journal, that state was permanent and silent: half an approved proposal on the
    // board, nothing in the log, and a session stuck on "applying" that could not say what landed.
    const epic = create("epic", { title: "Half-landed" }, "", p);
    const task = create("task", { title: "Half-landed too", epic: epic.id, acceptance: [{ text: "x", done: false }] }, "b", p);
    const snapshot = read(before.id, p);
    update(before.id, { blockedBy: [task.id], status: "blocked" }, p);
    writeState({ activeEpic: epic.id }, p);
    mkdirSync(dirname(journalPath(p)), { recursive: true });
    writeFileSync(journalPath(p), JSON.stringify({
      session: "PL-abcdef012345", digest: "d", started: epic.created,
      created: [epic.id, task.id], touched: [snapshot], previousActiveEpic: null,
    }));

    const rec = recoverInterruptedApply(p);
    assert.equal(rec.removed, 2);
    assert.equal(list("epic", {}, p).length, 0, "what it created is gone");
    assert.equal(list("task", {}, p).length, 1, "and only what was already there remains");
    assert.deepEqual(read(before.id, p).blockedBy, [], "the record it edited is back as it was");
    assert.equal(read(before.id, p).status, "open");
    assert.equal(state(p).activeEpic, null, "and the active epic is back");
    assert.equal(existsSync(journalPath(p)), false, "the journal is spent");
    assert.ok(readEvents(p).some((e) => e.event === "planner_apply_recovered"));

    // Running it again is a no-op, not a second undo.
    assert.equal(recoverInterruptedApply(p), null);
  });

  it("never removes a record it did not write down, however old the journal is", () => {
    const p = store();
    writeConfig({ requireEpic: false }, p);
    // The wreckage of a landing killed a week ago: a journal naming ONE record it created.
    const mine = create("task", { title: "Half-landed", acceptance: [{ text: "x", done: false }] }, "b", p);
    mkdirSync(dirname(journalPath(p)), { recursive: true });
    writeFileSync(journalPath(p), JSON.stringify({
      session: "PL-aaaaaaaaaaaa", digest: "d", started: new Date(Date.now() - 7 * 864e5).toISOString(),
      created: [mine.id], touched: [], previousActiveEpic: null,
    }));

    // A week of ordinary work by everyone else: `tm task new`, `tm epic new`, a harness mirror.
    const theirs = [
      create("task", { title: "Someone else's Tuesday", acceptance: [{ text: "x", done: false }] }, "b", p),
      create("task", { title: "And their Wednesday", acceptance: [{ text: "x", done: false }] }, "b", p),
      create("epic", { title: "A programme started on Thursday" }, "", p),
    ];

    // An earlier version of this swept every record stamped after the journal was opened, on the
    // reasoning that the landing held the store lock so nothing else could have created anything.
    // The lock dies with the process; the journal does not. That version deleted the week.
    const rec = recoverInterruptedApply(p);
    assert.deepEqual(rec.ids, [mine.id], "exactly what the journal named, and nothing else");
    assert.equal(read(mine.id, p), null, "its own record is undone");
    for (const t of theirs) assert.ok(read(t.id, p), `${t.id} belongs to someone else and must survive`);
  });

});

describe("an undo that cannot finish says so", () => {
  it("marks the error, so a caller cannot hand the same approval back", () => {
    const p = store();
    writeConfig({ requireEpic: false }, p);
    const existing = create("task", { title: "Already here", acceptance: [{ text: "x", done: false }], blockedBy: [], blocks: [] }, "b", p);
    const dir = dirname(read(existing.id, p).file);

    // `task.depends` args pass through `resolveDestinations` unchanged, so a getter on them
    // survives into the apply — which is where the failure has to happen for anything to be
    // created first.
    const ops = [
      { op: "task.create", args: { ref: "NEW", title: "Created then stuck", body: "b", acceptance: ["x"] } },
      { op: "task.depends", args: { task: existing.id, on: ["NEW"] } },
      { op: "task.depends", args: { task: existing.id, on: ["NEW"] } },
    ];
    Object.defineProperty(ops[2].args, "task", {
      enumerable: true,
      get() {
        // Once the new record exists, make its directory unwritable and fail: the undo will not be
        // able to unlink what this proposal created.
        if (list("task", {}, p).length > 1) {
          chmodSync(dir, 0o500);
          throw new Error("disk gave out");
        }
        return existing.id;
      },
    });

    let thrown = null;
    try {
      applyOps(ops, { approvedDigest: digestOps(ops), stamp: { actor: "m" } }, p);
    } catch (e) {
      thrown = e;
    } finally {
      chmodSync(dir, 0o700);
    }
    // Every step of the undo is best effort by design, and staying silent about a failed one was
    // itself the defect: the route treats a throw as "nothing landed" and re-arms the proposal, so
    // a partial undo invited the operator to create the leftovers a second time.
    assert.ok(thrown, "the landing failed");
    // Both halves of the undo are named: the record it could not remove, and the pre-existing one
    // it could not put back — the directory is unwritable for either.
    assert.ok(thrown.rollbackIncomplete?.length >= 1, "and it named what it could not undo");
    assert.ok(thrown.rollbackIncomplete.includes(existing.id), "including the record left edited");
    assert.equal(list("task", {}, p).length, 2, "the created record really is still there");
    assert.ok(readEvents(p).some((e) => e.event === "planner_apply_rolled_back" && e.stuck?.length));
  });
});
