/** lib/goal-import — the import `tm goal import` and `/api/goal/import` share. */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { importGoalDoc, importManifest } from "../../lib/goal-import.mjs";
import { read, readEvents, state, writeConfig } from "../../lib/store.mjs";

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
  it("throws 400 on a missing or malformed manifest", () => {
    const p = store();
    assert.throws(() => importManifest(join(p.root, "nope.json"), {}, p), (e) => e.status === 400);
    writeFileSync(join(p.root, "bad.json"), "{}");
    assert.throws(() => importManifest(join(p.root, "bad.json"), {}, p), (e) => e.status === 400);
  });
});
