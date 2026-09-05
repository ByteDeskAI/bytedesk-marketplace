/** lib/goal-import — the import `tm goal import` and `/api/goal/import` share. */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { applyManifestPlan, importGoalDoc, importManifest, planManifest } from "../../lib/goal-import.mjs";
import { create, list, read, readEvents, state, writeConfig, writeState } from "../../lib/store.mjs";

const stores = [];
after(() => cleanup(...stores));
const store = () => {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ requireEpic: false }, p);
  return p;
};
const doc = "# Goal: Ship it (BDP-1)\n\n**Validate:** `make test`\n\n## Success criteria\n\n- tests pass\n- docs updated\n";

describe("importGoalDoc", () => {
  it("makes a task gated on the doc's criteria and keeps the validate command in the body", () => {
    const p = store();
    const { task, parsed } = importGoalDoc(doc, { source: join(p.root, "docs/goals/ship.md"), stamp: { actor: "main" } }, p);
    assert.equal(task.title, "Ship it");
    assert.equal(task.goalDoc, "docs/goals/ship.md", "repo-relative when inside the root");
    assert.equal(parsed.criteria.length, 2);
    assert.match(read(task.id, p).body, /make test/);
  });
  it("refuses with a status the HTTP layer can pass through", () => {
    const p = store();
    assert.throws(() => importGoalDoc("# Goal: empty\n", { source: "empty.md" }, p), (e) => e.status === 409);
    assert.throws(() => importGoalDoc("just prose\n", { source: "prose.md" }, p), (e) => e.status === 400);
    writeConfig({ requireEpic: true }, p);
    assert.throws(() => importGoalDoc(doc, { source: "gated.md" }, p), (e) => e.status === 409 && /no active epic/.test(e.message));
  });
});

describe("importManifest", () => {
  it("creates the epic, activates it, wires dependsOn after every task exists, and names skips", () => {
    const p = store();
    const dir = join(p.root, "docs", "goals");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.md"), doc);
    writeFileSync(join(dir, "b.md"), doc);
    writeFileSync(join(dir, "bad.md"), "# Goal: no gate\n");
    const manifest = join(dir, "p.plan.json");
    writeFileSync(manifest, JSON.stringify({
      epic: { title: "Program", definitionOfDone: "all green" },
      integration: { gate: "make check" },
      goals: [
        { id: "B", doc: "docs/goals/b.md", dependsOn: ["A", "GHOST"] },
        { id: "A", doc: "docs/goals/a.md", touches: ["src/a"], mode: "auto" },
        { id: "C", doc: "docs/goals/bad.md" },
        { id: "D", doc: "docs/goals/missing.md" },
      ],
    }));
    const res = importManifest(manifest, { stamp: { actor: "main" } }, p);
    assert.equal(state(p).activeEpic, res.epic.id);
    assert.match(read(res.epic.id, p).body, /make check/);
    assert.equal(res.tasks.length, 2);
    assert.equal(res.skipped.length, 2);
    assert.equal(res.edges, 1);
    assert.deepEqual(res.danglingDeps, [{ id: "B", task: res.made.get("B"), on: ["GHOST"] }]);
    const b = read(res.made.get("B"), p);
    assert.deepEqual(b.blockedBy, [res.made.get("A")]);
    assert.equal(b.status, "blocked");
    assert.deepEqual(read(res.made.get("A"), p).touches, ["src/a"]);
    assert.ok(readEvents(p).some((e) => e.event === "goal_imported" && e.id === res.epic.id));
  });
  it("plans the whole import without writing anything, so a preview costs no board state", () => {
    const p = store();
    const dir = join(p.root, "docs", "goals");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.md"), doc);
    writeFileSync(join(dir, "b.md"), doc);
    writeFileSync(join(dir, "bad.md"), "# Goal: no gate\n");
    const manifest = join(dir, "p.plan.json");
    writeFileSync(manifest, JSON.stringify({
      epic: { title: "Program", definitionOfDone: "all green" },
      goals: [
        { id: "B", doc: "docs/goals/b.md", dependsOn: ["A", "GHOST"] },
        { id: "A", doc: "docs/goals/a.md", touches: ["src/a"] },
        { id: "C", doc: "docs/goals/bad.md" },
      ],
    }));
    const plan = planManifest(manifest, p);
    assert.equal(plan.epic.title, "Program");
    assert.equal(plan.goals.length, 2, "the two goals with parseable criteria");
    assert.equal(plan.skipped.length, 1);
    assert.equal(plan.edges, 1, "B depends on A; GHOST is not landing");
    assert.deepEqual(plan.danglingDeps, [{ id: "B", on: ["GHOST"] }]);
    assert.deepEqual(plan.goals.find((g) => g.goalId === "A").touches, ["src/a"]);

    // The whole point: planning is a read. Nothing may appear on the board, and the active epic
    // must be untouched — a preview that costs board state is not a preview.
    assert.ok(!state(p).activeEpic, "no epic was activated by planning");
    assert.equal(list("epic", {}, p).length, 0, "no epic was created by planning");
    assert.equal(list("task", {}, p).length, 0, "no task was created by planning");
  });

  it("leaves no partial program behind when a write fails halfway", () => {
    const p = store();
    const dir = join(p.root, "docs", "goals");
    mkdirSync(dir, { recursive: true });
    for (const n of ["a", "b", "c"]) writeFileSync(join(dir, `${n}.md`), doc);
    const manifest = join(dir, "p.plan.json");
    writeFileSync(manifest, JSON.stringify({
      epic: { title: "Program" },
      goals: [
        { id: "A", doc: "docs/goals/a.md" },
        { id: "B", doc: "docs/goals/b.md", dependsOn: ["A"] },
        { id: "C", doc: "docs/goals/c.md", dependsOn: ["B"] },
      ],
    }));

    // Something already on the board, and an active epic that must survive the failure untouched.
    const before = create("epic", { title: "Existing" }, "", p);
    writeState({ activeEpic: before.id }, p);

    // Fail on the third task, which is deep enough to have created an epic, activated it, and
    // written two tasks — exactly the half-landed program this is supposed to make impossible.
    const plan = planManifest(manifest, p);
    let calls = 0;
    Object.defineProperty(plan.goals[2], "title", {
      get() {
        if (++calls > 0) throw new Error("disk gave out");
        return "C";
      },
    });

    assert.throws(() => applyManifestPlan(plan, { stamp: { actor: "main" } }, p), /disk gave out/);

    assert.deepEqual(list("task", {}, p).map((t) => t.id), [], "no task from the failed import survives");
    assert.deepEqual(list("epic", {}, p).map((e) => e.id), [before.id], "only the pre-existing epic remains");
    assert.equal(state(p).activeEpic, before.id, "the active epic is put back, not left pointing at a removed epic");

    // The log is append-only and is not rewound — a concurrent writer may have appended since, and
    // truncating would delete somebody else's history. The compensation is recorded instead.
    const rolled = readEvents(p).filter((e) => e.event === "goal_import_rolled_back");
    assert.equal(rolled.length, 1);
    assert.equal(rolled[0].removed, 3, "one epic and two tasks were created and then removed");
    assert.match(rolled[0].why, /disk gave out/);
    assert.ok(!readEvents(p).some((e) => e.event === "goal_imported"), "a rolled-back import never claims success");

    // And the board is still usable afterwards, rather than needing `tm doctor`.
    const after = importManifest(manifest, { stamp: { actor: "main" } }, p);
    assert.equal(after.tasks.length, 3);
    assert.equal(after.edges, 2);
  });

  it("throws 400 on a missing or malformed manifest", () => {
    const p = store();
    assert.throws(() => importManifest(join(p.root, "nope.json"), {}, p), (e) => e.status === 400);
    writeFileSync(join(p.root, "bad.json"), "{}");
    assert.throws(() => importManifest(join(p.root, "bad.json"), {}, p), (e) => e.status === 400);
  });
});
