/**
 * A write that dies between writeFileSync and renameSync must leave nothing that can pass
 * for an entity.
 *
 * Before this, `writeAtomic` named its temp `${file}.${pid}.tmp` and `fileFor` matched any
 * directory entry starting with `${id}-`. So a crashed create left a PHANTOM: `tm show TM-002`
 * rendered it, `tm board` never listed it (list() filters `.md`), `tm doctor` reported
 * "no problems found", `nextId` counted it so the id was burned, and you could add acceptance
 * criteria to it, comment on it and `tm start` it — leaving a task in_progress that even the
 * Stop gate could not see, because gateStop lists `.md` too.
 *
 * Reproduced end to end before the fix; every assertion here failed.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, fileFor, list, nextId, read, update } from "../../lib/store.mjs";
import { diagnose } from "../../lib/doctor.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

/** What a process killed between the write and the rename used to leave behind. */
const legacyOrphan = (p, id, slug) =>
  writeFileSync(
    join(p.tasks, `${id}-${slug}.md.99999.tmp`),
    `---\nid: "${id}"\ntitle: "phantom"\nstatus: "open"\n---\n\nbody\n`,
  );

describe("a temp file cannot pass for an entity", () => {
  it("fileFor never resolves an id to a non-.md file", () => {
    const p = store();
    legacyOrphan(p, "TM-002", "phantom-from-a-crashed-create");
    assert.equal(fileFor("TM-002", p), null);
  });

  it("read() finds nothing, so show/start/comment all refuse", () => {
    const p = store();
    legacyOrphan(p, "TM-002", "phantom");
    assert.equal(read("TM-002", p), null);
    // update() is what let you work on a phantom: it read through fileFor and wrote back
    // through doc.file, persisting criteria and comments into a file nothing lists.
    assert.throws(() => update("TM-002", { status: "in_progress" }, p), /not found/);
  });

  it("keeps resolving the real file when a temp for the same id sits beside it", () => {
    const p = store();
    const t = create("task", { title: "the real task" }, "", p);
    legacyOrphan(p, t.id, "the-real-task");

    assert.match(fileFor(t.id, p), /\.md$/);
    assert.equal(read(t.id, p).title, "the real task");
  });

  it("the new temp name does not begin with the id at all", () => {
    const p = store();
    // Belt and braces: fileFor requiring .md is one guard, a temp name that cannot match
    // `${id}-` is the other. This one failed silently once already.
    const t = create("task", { title: "a task" }, "", p);
    const names = readdirSync(p.tasks);
    assert.ok(names.every((f) => !f.endsWith(".tmp") || !f.startsWith(t.id)), `saw ${names.join(", ")}`);
  });

  it("does not burn the id — the phantom never counted as an entity", () => {
    const p = store();
    create("task", { title: "first" }, "", p);
    legacyOrphan(p, "TM-002", "phantom");
    // nextId reads the directory, so a temp named `TM-002-…` used to reserve 002 and push
    // the next real task to 003 while nothing occupied 002.
    assert.equal(nextId("task", p), "TM-002");
  });

  it("stays out of every listing, as it always did", () => {
    const p = store();
    legacyOrphan(p, "TM-002", "phantom");
    assert.deepEqual(list("task", {}, p), []);
  });
});

describe("doctor reports the residue", () => {
  it("names a stray temp file rather than calling the store clean", () => {
    const p = store();
    create("task", { title: "a real one" }, "", p);
    legacyOrphan(p, "TM-002", "phantom");

    const f = diagnose(p).find((x) => x.code === "stray-temp");
    assert.ok(f, "a killed mid-write is worth saying out loud");
    assert.match(f.message, /interrupted write/);
  });

  it("refuses to delete it — the temp may be the only copy of that write", () => {
    const p = store();
    legacyOrphan(p, "TM-002", "phantom");
    assert.equal(diagnose(p).find((x) => x.code === "stray-temp").fixable, false);
  });

  it("recognises the current temp shape too", () => {
    const p = store();
    writeFileSync(join(p.tasks, ".tm-tmp-4242-TM-003-something.md"), "partial");
    assert.ok(diagnose(p).some((x) => x.code === "stray-temp"));
  });

  it("says nothing on a store with no temps", () => {
    const p = store();
    create("task", { title: "a real one" }, "", p);
    assert.ok(!diagnose(p).some((x) => x.code === "stray-temp"));
  });
});
