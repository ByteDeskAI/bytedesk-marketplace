/**
 * `touches`, observed from Edit/Write rather than declared.
 *
 * The rule these guard is attribution: a path recorded against the WRONG task is worse
 * than a missing one. Missing means `tm parallel` is optimistic about one pair. Wrong
 * means it invents a collision that serializes work needlessly *and* hides the real
 * collision on the task that actually owns the file. So most of this file is about the
 * cases where we must decline to guess.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, read, update, writeConfig, writeState } from "../../lib/store.mjs";
import { MAX_TOUCHES, attribute, normalise, observe, record } from "../../lib/touches.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const edit = (file, extra = {}) => ({ tool_name: "Edit", tool_input: { file_path: file }, ...extra });
const running = (p, title, fields = {}) => {
  const t = create("task", { title, touches: [], ...fields }, "", p);
  update(t.id, { status: "in_progress", ...fields }, p);
  return t.id;
};

describe("normalise", () => {
  it("makes a path repo-relative, because an absolute one names one machine's disk", () => {
    const p = store();
    assert.equal(normalise(join(p.root, "src/auth.ts"), p), "src/auth.ts");
  });

  it("resolves a relative path against where the caller is standing", () => {
    const p = store();
    // `tm touches TM-1 src/auth.ts` typed in a subdirectory means THAT src/auth.ts, so
    // the base is the cwd by default and callers elsewhere must say where they are.
    assert.equal(normalise("src/auth.ts", p, { from: p.root }), "src/auth.ts");
    assert.equal(normalise("auth.ts", p, { from: join(p.root, "src") }), "src/auth.ts");
    assert.equal(normalise("src/auth.ts", p, { from: "/somewhere/else" }), null, "not silently relocated");
  });

  it("refuses a path outside the store root", () => {
    const p = store();
    assert.equal(normalise("/etc/passwd", p), null);
    assert.equal(normalise(join(p.root, "../elsewhere/x.ts"), p), null);
  });

  it("ignores the store's own files, which would make every task collide", () => {
    const p = store();
    assert.equal(normalise(join(p.root, ".bytedesk/task-management/tasks/TM-001-x.md"), p), null);
    assert.equal(normalise(join(p.root, ".git/COMMIT_EDITMSG"), p), null);
    assert.equal(normalise(join(p.root, "node_modules/react/index.js"), p), null);
  });

  it("ignores node_modules nested in a monorepo package", () => {
    const p = store();
    assert.equal(normalise(join(p.root, "packages/web/node_modules/x/index.js"), p), null);
  });

  it("is idempotent when re-normalised against the root", () => {
    // observe() normalises, then hands the result to record(), which normalises again.
    // If that second pass used the process cwd instead of the root, every observation
    // would be silently dropped in a worktree or any subdirectory while working fine
    // from the project root — the hardest kind of bug to notice.
    const p = store();
    const once = normalise(join(p.root, "src/deep/auth.ts"), p);
    assert.equal(normalise(once, p, { from: p.root }), once);
  });

  it("refuses the root itself and empty input", () => {
    const p = store();
    assert.equal(normalise(p.root, p), null);
    assert.equal(normalise("", p), null);
    assert.equal(normalise(null, p), null);
  });
});

describe("attribute", () => {
  it("takes the task named by the branch, which needs no discipline", () => {
    const p = store();
    const a = running(p, "first");
    running(p, "second");
    // Two in progress would otherwise be ambiguous; the branch settles it.
    assert.equal(attribute({ branch: `tm/${a}-first` }, p), a);
  });

  it("ignores a branch naming a task that does not exist", () => {
    const p = store();
    const only = running(p, "only one");
    assert.equal(attribute({ branch: "tm/TM-404-ghost" }, p), only, "falls through to the single running task");
  });

  it("takes the only task in progress", () => {
    const p = store();
    const id = running(p, "the only one");
    assert.equal(attribute({}, p), id);
  });

  it("declines to guess between two tasks in one session", () => {
    const p = store();
    running(p, "first thing", { session: "s1" });
    running(p, "second thing", { session: "s1" });

    // This is the whole point: attributing to either would poison the collision data.
    assert.equal(attribute({ session: "s1" }, p), null);
  });

  it("prefers this session's task over another session's", () => {
    const p = store();
    const mine = running(p, "mine", { session: "s1" });
    running(p, "theirs", { session: "s2" });

    assert.equal(attribute({ session: "s1" }, p), mine);
  });

  it("breaks a tie on the claim this session explicitly took", () => {
    const p = store();
    const claimed = running(p, "claimed one", { session: "s1" });
    running(p, "also running", { session: "s1" });
    writeState({ claims: { [claimed]: { session: "s1", ts: new Date().toISOString() } } }, p);

    assert.equal(attribute({ session: "s1" }, p), claimed);
  });

  it("returns null when nothing is in progress", () => {
    const p = store();
    create("task", { title: "not started" }, "", p);
    assert.equal(attribute({}, p), null);
  });
});

describe("record", () => {
  it("adds a path and keeps the list sorted and unique", () => {
    const p = store();
    const id = running(p, "task");

    record(id, ["src/b.ts", "src/a.ts"], p, { from: p.root });
    record(id, ["src/a.ts"], p, { from: p.root });

    assert.deepEqual(read(id, p).touches, ["src/a.ts", "src/b.ts"]);
  });

  it("reports nothing added when the path is already known", () => {
    const p = store();
    const id = running(p, "task");
    record(id, ["src/a.ts"], p, { from: p.root });

    assert.deepEqual(record(id, ["src/a.ts"], p, { from: p.root }).added, []);
  });

  it("caps the list, because frontmatter is one line per key", () => {
    const p = store();
    const id = running(p, "sprawling task");
    const many = Array.from({ length: MAX_TOUCHES + 10 }, (_, i) => `src/file-${String(i).padStart(3, "0")}.ts`);

    const res = record(id, many, p, { from: p.root });

    assert.equal(res.capped, true);
    assert.equal(read(id, p).touches.length, MAX_TOUCHES);
  });

  it("is a no-op on a task that does not exist", () => {
    assert.deepEqual(record("TM-404", ["src/a.ts"], store()).added, []);
  });

  it("drops paths it cannot normalise without dropping the good ones", () => {
    const p = store();
    const id = running(p, "task");

    record(id, ["/etc/passwd", "src/real.ts", join(p.root, ".git/HEAD")], p, { from: p.root });

    assert.deepEqual(read(id, p).touches, ["src/real.ts"]);
  });
});

describe("observe — the PostToolUse path", () => {
  it("records the edited file against the running task", () => {
    const p = store();
    const id = running(p, "the work");

    const res = observe(edit(join(p.root, "src/auth.ts")), { p });

    assert.equal(res.id, id);
    assert.deepEqual(read(id, p).touches, ["src/auth.ts"]);
  });

  it("reads NotebookEdit's notebook_path too", () => {
    const p = store();
    const id = running(p, "the work");

    observe({ tool_name: "NotebookEdit", tool_input: { notebook_path: join(p.root, "analysis.ipynb") } }, { p });

    assert.deepEqual(read(id, p).touches, ["analysis.ipynb"]);
  });

  it("says nothing and writes nothing when it cannot tell whose edit it is", () => {
    const p = store();
    const a = running(p, "first thing", { session: "s1" });
    const b = running(p, "second thing", { session: "s1" });

    const res = observe(edit(join(p.root, "src/shared.ts")), { p, session: "s1" });

    assert.ok(res.skipped, "an ambiguous edit must be dropped, not assigned");
    assert.deepEqual(read(a, p).touches, []);
    assert.deepEqual(read(b, p).touches, []);
  });

  it("ignores an edit to the store's own files", () => {
    const p = store();
    const id = running(p, "the work");

    observe(edit(join(p.root, ".bytedesk/task-management/state.json")), { p });

    assert.deepEqual(read(id, p).touches, []);
  });

  it("ignores a failed edit — it says nothing about what the task owns", () => {
    const p = store();
    const id = running(p, "the work");

    observe(edit(join(p.root, "src/a.ts"), { tool_response: { success: false } }), { p });

    assert.deepEqual(read(id, p).touches, []);
  });

  it("ignores a payload with no path at all", () => {
    const p = store();
    const id = running(p, "the work");
    assert.ok(observe({ tool_name: "Edit", tool_input: {} }, { p }).skipped);
    assert.deepEqual(read(id, p).touches, []);
  });

  it("can be switched off", () => {
    const p = store();
    writeConfig({ trackTouches: false }, p);
    const id = running(p, "the work");

    assert.equal(observe(edit(join(p.root, "src/a.ts")), { p }).skipped, "disabled");
    assert.deepEqual(read(id, p).touches, []);
  });

  it("attributes to the branch's task even when another is also running", () => {
    const p = store();
    const branchTask = running(p, "branch work");
    const other = running(p, "other work");

    observe(edit(join(p.root, "src/a.ts")), { p, branch: `tm/${branchTask}-branch-work` });

    assert.deepEqual(read(branchTask, p).touches, ["src/a.ts"]);
    assert.deepEqual(read(other, p).touches, []);
  });

  it("records a worktree edit as the same path as the main checkout's", () => {
    const p = store();
    const id = running(p, "the work");
    // Worktrees live at <root>/.bytedesk/worktrees/TM-014-…. Anchored on the store root
    // that path is under .bytedesk/ — which the ignore list drops — and would never
    // match the main checkout's `src/auth.ts` even if it survived. Since worktrees are
    // where parallel work happens, that would blind `tm parallel` exactly where it is
    // supposed to help.
    const worktree = join(p.root, ".bytedesk", "worktrees", `${id}-the-work`);

    observe(edit(join(worktree, "src/auth.ts")), { p, base: worktree });

    assert.deepEqual(read(id, p).touches, ["src/auth.ts"], "not .bytedesk/worktrees/…/src/auth.ts, and not dropped");
  });

  it("still ignores the store's files when anchored on a worktree", () => {
    const p = store();
    const id = running(p, "the work");
    const worktree = join(p.root, ".bytedesk", "worktrees", `${id}-the-work`);

    observe(edit(join(worktree, ".git", "HEAD")), { p, base: worktree });

    assert.deepEqual(read(id, p).touches, []);
  });

  it("accumulates across many edits, which is how a real session fills it in", () => {
    const p = store();
    const id = running(p, "the work");

    for (const f of ["src/a.ts", "src/b.ts", "src/a.ts", "README.md"]) {
      observe(edit(join(p.root, f)), { p });
    }

    assert.deepEqual(read(id, p).touches, ["README.md", "src/a.ts", "src/b.ts"]);
  });
});
