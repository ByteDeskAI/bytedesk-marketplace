/**
 * The store must not read its own staging files.
 *
 * `writeAtomic` stages at `.tm-tmp-<pid>-<name>` — built from the target's basename, so it ENDS IN
 * `.md`. Every reader globbed `.endsWith(".md")`, so one process could see another's staging file in
 * `readdirSync`, the rename would move it, and the `readFileSync` that followed opened a path that
 * no longer existed:
 *
 *   tm task: ENOENT: no such file or directory, open '…/tasks/.tm-tmp-3705640-TM-003-….md'
 *
 * That was the create that never wrote a file — eight concurrent creates producing seven files,
 * seven ids and seven index rows. It needed a second process writing at the instant a first was
 * listing, so it only ever appeared with several suites running at once, never alone.
 *
 * The comment above `writeAtomic` claimed the leading dot meant it "never matches". The dot was
 * never consulted; the filter asked about the extension.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, list, read } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

describe("staging files are not entities", () => {
  it("does not list another process's half-written file", () => {
    const p = store();
    const real = create("task", { title: "a real task" }, "", p);
    // Exactly what writeAtomic leaves in the directory mid-write, from another pid.
    writeFileSync(join(p.tasks, ".tm-tmp-999999-TM-002-being-written.md"), '---\nid: "TM-002"\n---\n');

    assert.deepEqual(list("task", {}, p).map((t) => t.id), [real.id], "a file being written is not on the board yet");
  });

  it("does not resolve an id to a staging file", () => {
    const p = store();
    writeFileSync(join(p.tasks, ".tm-tmp-999999-TM-004-being-written.md"), '---\nid: "TM-004"\n---\n');
    // A guard rather than a regression: `fileFor` matches `TM-004-…`, and the staging name starts
    // with the dot prefix, so this held before too. It is here so a future rename of the staging
    // scheme cannot quietly make a half-written file addressable.
    assert.equal(read("TM-004", p), null, "an id that only exists mid-write is not readable");
  });

  it("survives a listed name that cannot be opened", () => {
    const p = store();
    create("task", { title: "stays" }, "", p);

    /**
     * The race made deterministic. A dangling symlink is listed by `readdirSync` and gives ENOENT
     * on `readFileSync` — which is exactly the shape of a file renamed away between the two calls,
     * without needing to win a race to observe it.
     */
    symlinkSync(join(p.tasks, "gone.md"), join(p.tasks, "TM-999-dangling.md"));

    // This used to throw and take the whole read with it. The caller asked what is on the board,
    // and something that cannot be opened is not on it.
    assert.deepEqual(list("task", {}, p).map((t) => t.title), ["stays"]);
  });
});
