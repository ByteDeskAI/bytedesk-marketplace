/**
 * The board's keyboard contract.
 *
 * Every decision lives in pure functions precisely so it can be tested without a
 * DOM: the ways keyboard support breaks are all logic, not rendering — a shortcut
 * that fires while you are typing, a chord that swallows ⌘R, focus that strands you
 * in an empty column, a cursor that keeps pointing at a row after the card moved.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNS,
  KEYMAP,
  filterCommands,
  focusedId,
  isTypingTarget,
  keymapByGroup,
  locate,
  move,
  resolve,
} from "../../dashboard/src/lib/keys.mjs";

const ev = (key, mods = {}) => ({ key, metaKey: false, ctrlKey: false, altKey: false, ...mods });

describe("resolve", () => {
  it("maps the movement keys and their arrow aliases to the same intent", () => {
    for (const [key, action] of [
      ["j", "down"],
      ["ArrowDown", "down"],
      ["k", "up"],
      ["ArrowUp", "up"],
      ["h", "left"],
      ["ArrowLeft", "left"],
      ["l", "right"],
      ["ArrowRight", "right"],
    ]) {
      assert.equal(resolve(ev(key))?.action, action, `${key} → ${action}`);
    }
  });

  it("turns a digit into the column at that position, so 1 is always the leftmost", () => {
    assert.deepEqual(resolve(ev("1")), { action: "status", status: "backlog" });
    assert.deepEqual(resolve(ev("2")), { action: "status", status: "open" }, "column 2 is todo — the status is still `open`");
    assert.deepEqual(resolve(ev("6")), { action: "status", status: COLUMNS[5] });
  });

  it("ignores a digit past the last column instead of moving to undefined", () => {
    assert.equal(resolve(ev("7")), null);
    assert.equal(resolve(ev("9")), null);
  });

  it("stays silent while the caret is in a field — `c` must not file a task mid-title", () => {
    assert.equal(resolve(ev("c"), { typing: true }), null);
    assert.equal(resolve(ev("1"), { typing: true }), null);
    assert.equal(resolve(ev("/"), { typing: true }), null, "slash must reach the field it is typed into");
  });

  it("blurs on Escape from a field rather than clearing the board behind it", () => {
    assert.deepEqual(resolve(ev("Escape"), { typing: true }), { action: "blur" });
    assert.deepEqual(resolve(ev("Escape")), { action: "escape" });
  });

  it("hands the keyboard to an open dialog", () => {
    for (const key of ["j", "1", "c", "Escape", "?"]) {
      assert.equal(resolve(ev(key), { modal: true }), null, `${key} belongs to the dialog`);
    }
  });

  it("opens the palette from anywhere, including a field and a dialog", () => {
    assert.deepEqual(resolve(ev("k", { metaKey: true })), { action: "palette" });
    assert.deepEqual(resolve(ev("k", { ctrlKey: true })), { action: "palette" });
    assert.deepEqual(resolve(ev("K", { metaKey: true })), { action: "palette" }, "shift-held ⌘K still counts");
    assert.deepEqual(resolve(ev("k", { metaKey: true }), { typing: true }), { action: "palette" });
    assert.deepEqual(resolve(ev("k", { metaKey: true }), { modal: true }), { action: "palette" });
  });

  it("leaves every other modifier chord to the browser", () => {
    // Swallowing ⌘R or Ctrl-L would be worse than having no shortcuts at all.
    for (const mods of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }]) {
      assert.equal(resolve(ev("r", mods)), null);
      assert.equal(resolve(ev("l", mods)), null);
      assert.equal(resolve(ev("1", mods)), null);
    }
  });

  it("returns null for a key nobody bound", () => {
    assert.equal(resolve(ev("q")), null);
    assert.equal(resolve(ev("F5")), null);
  });
});

describe("move", () => {
  const columns = [["a1", "a2", "a3"], [], ["c1", "c2"], [], ["e1"]];

  it("starts at the first column that has cards", () => {
    assert.deepEqual(move(null, "down", columns), { column: 0, row: 0 });
    assert.deepEqual(move(null, "down", [[], [], ["c1"]]), { column: 2, row: 0 });
  });

  it("returns null when the whole board is empty", () => {
    assert.equal(move(null, "down", [[], []]), null);
  });

  it("clamps at the ends instead of wrapping — wrapping reads as nothing happening", () => {
    assert.deepEqual(move({ column: 0, row: 2 }, "down", columns), { column: 0, row: 2 });
    assert.deepEqual(move({ column: 0, row: 0 }, "up", columns), { column: 0, row: 0 });
  });

  it("skips empty columns horizontally rather than stranding the cursor in one", () => {
    assert.deepEqual(move({ column: 0, row: 0 }, "right", columns), { column: 2, row: 0 });
    assert.deepEqual(move({ column: 2, row: 0 }, "right", columns), { column: 4, row: 0 });
    assert.deepEqual(move({ column: 4, row: 0 }, "left", columns), { column: 2, row: 0 });
  });

  it("stays put at the far edge", () => {
    assert.deepEqual(move({ column: 4, row: 0 }, "right", columns), { column: 4, row: 0 });
    assert.deepEqual(move({ column: 0, row: 1 }, "left", columns), { column: 0, row: 1 });
  });

  it("keeps the row where it fits when crossing to a shorter column", () => {
    assert.deepEqual(move({ column: 0, row: 2 }, "right", columns), { column: 2, row: 1 }, "clamped to c2");
    assert.deepEqual(move({ column: 0, row: 1 }, "right", columns), { column: 2, row: 1 }, "kept at row 1");
  });

  it("jumps to the ends of a column with g and G", () => {
    assert.deepEqual(move({ column: 0, row: 1 }, "last", columns), { column: 0, row: 2 });
    assert.deepEqual(move({ column: 0, row: 2 }, "first", columns), { column: 0, row: 0 });
  });

  it("survives a focus left pointing past a column that shrank", () => {
    // The board reloads every 15s and over SSE; a stale index must not throw.
    assert.deepEqual(move({ column: 9, row: 9 }, "down", columns), { column: 4, row: 0 });
  });
});

describe("focusedId / locate", () => {
  const columns = [["a1", "a2"], ["b1"]];

  it("reads the id under the cursor", () => {
    assert.equal(focusedId({ column: 0, row: 1 }, columns), "a2");
    assert.equal(focusedId({ column: 1, row: 0 }, columns), "b1");
  });

  it("returns null rather than guessing when the cursor is nowhere", () => {
    assert.equal(focusedId(null, columns), null);
    assert.equal(focusedId({ column: 5, row: 0 }, columns), null);
    assert.equal(focusedId({ column: 0, row: 7 }, columns), null);
  });

  it("finds a card that moved column, so focus follows the task not the slot", () => {
    // This is the whole point: press 3 on a card and it leaves the column. Without
    // locate, the cursor stays on that row — now a different task — and the next
    // keystroke acts on the wrong card.
    assert.deepEqual(locate("b1", columns), { column: 1, row: 0 });
    assert.deepEqual(locate("a1", [["x"], ["a1"]]), { column: 1, row: 0 });
    assert.equal(locate("gone", columns), null);
  });
});

describe("filterCommands", () => {
  const rows = [
    { key: "1", id: "TM-001", label: "rotate the credential", hint: "open" },
    { key: "2", id: "TM-014", label: "add cursor pagination", hint: "done" },
    { key: "3", label: "Create task", hint: "c" },
    { key: "4", label: "Clear all filters" },
  ];

  it("returns everything for an empty query", () => {
    assert.equal(filterCommands("", rows).length, 4);
    assert.equal(filterCommands("   ", rows).length, 4);
  });

  it("requires every token to appear, so two words narrow instead of widening", () => {
    assert.deepEqual(filterCommands("cursor pagination", rows).map((r) => r.key), ["2"]);
    assert.deepEqual(filterCommands("rotate pagination", rows), []);
  });

  it("matches on id as well as label", () => {
    assert.deepEqual(filterCommands("tm-014", rows).map((r) => r.key), ["2"]);
  });

  it("ranks an exact id first", () => {
    const hits = filterCommands("tm-001", rows);
    assert.equal(hits[0].id, "TM-001");
  });

  it("ranks a label prefix above a mid-string hit", () => {
    const hits = filterCommands("c", rows);
    assert.ok(["3", "4"].includes(hits[0].key), `expected a Create/Clear row first, got ${hits[0].key}`);
  });

  it("is case-insensitive", () => {
    assert.equal(filterCommands("ROTATE", rows).length, 1);
  });

  it("matches the hint, so a status is searchable", () => {
    assert.deepEqual(filterCommands("done", rows).map((r) => r.key), ["2"]);
  });
});

describe("KEYMAP", () => {
  it("documents every action it binds — the help sheet renders from this array", () => {
    for (const row of KEYMAP) {
      assert.ok(row.keys.length, `${row.action} has no keys`);
      assert.ok(row.label, `${row.action} has no label`);
      assert.ok(row.group, `${row.action} has no group`);
    }
  });

  it("binds no key twice, or the second binding is dead code", () => {
    const seen = new Map();
    for (const row of KEYMAP) {
      for (const key of row.keys) {
        assert.equal(seen.get(key), undefined, `${key} is bound to both ${seen.get(key)} and ${row.action}`);
        seen.set(key, row.action);
      }
    }
  });

  it("groups without losing a row", () => {
    assert.equal(
      keymapByGroup().reduce((n, g) => n + g.rows.length, 0),
      KEYMAP.length,
    );
  });

  it("has a column key for every column and no more", () => {
    const digits = KEYMAP.find((k) => k.action === "status").keys;
    assert.equal(digits.length, COLUMNS.length);
  });
});

describe("isTypingTarget", () => {
  it("recognises the elements that own their own keystrokes", () => {
    assert.equal(isTypingTarget({ tagName: "INPUT" }), true);
    assert.equal(isTypingTarget({ tagName: "TEXTAREA" }), true);
    assert.equal(isTypingTarget({ tagName: "SELECT" }), true);
    assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  });

  it("leaves the board's own elements alone", () => {
    assert.equal(isTypingTarget({ tagName: "DIV" }), false);
    assert.equal(isTypingTarget({ tagName: "BUTTON" }), false);
    assert.equal(isTypingTarget(null), false);
  });
});
