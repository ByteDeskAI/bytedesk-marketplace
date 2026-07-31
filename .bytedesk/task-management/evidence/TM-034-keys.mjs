/**
 * The keyboard as data.
 *
 * The board was mouse-only: cards moved by HTML5 drag, and TaskCard says so in its
 * own comment — "Swap in pragmatic-drag-and-drop if the board ever needs keyboard
 * reordering." A board with no keyboard path is unusable for anyone who cannot drag,
 * and slow for anyone who can type.
 *
 * Everything here is a pure function so the whole keyboard contract is unit-tested
 * without a DOM: `resolve` maps an event to an intent, `move` maps an intent to the
 * next focus position, `filterCommands` ranks the palette. The hook that consumes
 * them (useBoardKeys) holds no logic worth testing.
 *
 * ponytail: plain .mjs like metrics.mjs and pwa/queue.mjs, for exactly that reason.
 * No keybinding library — a lookup in a 14-row table is not a dependency.
 */

/** Column order on screen. Digit keys index into this, so 1 is always "in progress". */
/**
 * Left to right, the life of a card: backlog → todo → in progress → blocked → parked → done.
 * Mirrors lib/render.mjs COLUMNS, and the position IS the keyboard shortcut, so reordering here
 * reorders the digits.
 */
export const COLUMNS = ["backlog", "open", "in_progress", "blocked", "parked", "done"];
/** `open` reads as "todo" everywhere a human sees it — same state, honest name. */
export const LABEL = { backlog: "backlog", open: "todo", in_progress: "in progress", blocked: "blocked", parked: "parked", done: "done" };
export const label = (status) => LABEL[status] || String(status).replace("_", " ");

/**
 * One row per binding, and the help sheet renders from the same array the handler
 * reads — a shortcut that works but is undocumented, or documented but dead, is the
 * usual way keyboard support rots.
 */
export const KEYMAP = [
  { keys: ["j", "ArrowDown"], action: "down", label: "next card", group: "Move" },
  { keys: ["k", "ArrowUp"], action: "up", label: "previous card", group: "Move" },
  { keys: ["h", "ArrowLeft"], action: "left", label: "column left", group: "Move" },
  { keys: ["l", "ArrowRight"], action: "right", label: "column right", group: "Move" },
  { keys: ["g"], action: "first", label: "first card in the column", group: "Move" },
  { keys: ["G"], action: "last", label: "last card in the column", group: "Move" },
  { keys: ["Enter", "o"], action: "open", label: "open the card", group: "Card" },
  { keys: ["1", "2", "3", "4", "5", "6"], action: "status", label: "move to column 1–6", group: "Card" },
  { keys: ["["], action: "rankUp", label: "rank above the card before it", group: "Card" },
  { keys: ["]"], action: "rankDown", label: "rank below the card after it", group: "Card" },
  { keys: ["x"], action: "select", label: "select / deselect (for the bulk bar)", group: "Card" },
  { keys: ["w"], action: "watch", label: "watch — notify me if this is blocked or taken", group: "Card" },
  { keys: ["c"], action: "create", label: "new task", group: "Board" },
  { keys: ["/"], action: "search", label: "search", group: "Board" },
  { keys: ["?"], action: "help", label: "this list", group: "Board" },
];

/** Rendered in the hint bar and the help sheet. Cmd on a Mac, Ctrl everywhere else. */
export const PALETTE_HINT = "⌘K / Ctrl-K";

/** A keystroke aimed at a field is the field's, not the board's. */
export function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * One event → one intent, or null to let the browser have it.
 *
 * Order matters: the palette opens from anywhere including inside a text field, a
 * dialog owns every other key while it is up, and a modifier chord that isn't ours
 * is left alone rather than swallowed — stealing Ctrl-L or ⌘R would be worse than
 * having no shortcuts at all.
 */
export function resolve(event, { typing = false, modal = false } = {}) {
  const key = event.key;
  if ((event.metaKey || event.ctrlKey) && String(key).toLowerCase() === "k") return { action: "palette" };
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (modal) return null;
  if (typing) return key === "Escape" ? { action: "blur" } : null;
  if (key === "Escape") return { action: "escape" };

  const hit = KEYMAP.find((k) => k.keys.includes(key));
  if (!hit) return null;
  if (hit.action === "status") {
    const index = Number(key) - 1;
    return index < COLUMNS.length ? { action: "status", status: COLUMNS[index] } : null;
  }
  return { action: hit.action };
}

/**
 * Where focus lands next. `columns` is an array of id arrays in screen order.
 *
 * Empty columns are skipped on horizontal moves — landing on a column with nothing
 * in it strands you, and pressing `l` again to escape is a worse board than one that
 * just goes to the next column that has cards. Vertical moves clamp instead of
 * wrapping: wrapping from the last card to the first reads as "nothing happened".
 */
export function move(focus, action, columns) {
  const filled = columns.map((c, i) => (c.length ? i : -1)).filter((i) => i >= 0);
  if (!filled.length) return null;
  if (!focus) return { column: filled[0], row: 0 };

  const column = Math.min(focus.column, columns.length - 1);
  const rows = columns[column]?.length ?? 0;
  const clamp = (r) => Math.max(0, Math.min(r, Math.max(0, rows - 1)));

  switch (action) {
    case "down":
      return { column, row: clamp(focus.row + 1) };
    case "up":
      return { column, row: clamp(focus.row - 1) };
    case "first":
      return { column, row: 0 };
    case "last":
      return { column, row: clamp(rows - 1) };
    case "left":
    case "right": {
      const step = action === "right" ? 1 : -1;
      const next = filled.filter((i) => (step > 0 ? i > column : i < column));
      const target = step > 0 ? next[0] : next.at(-1);
      if (target === undefined) return { column, row: clamp(focus.row) };
      // Keep the vertical position where it fits, rather than snapping to the top.
      return { column: target, row: Math.min(focus.row, columns[target].length - 1) };
    }
    default:
      return focus;
  }
}

/** The id under the cursor, or null. */
export function focusedId(focus, columns) {
  if (!focus) return null;
  return columns[focus.column]?.[focus.row] ?? null;
}

/**
 * Put focus back on the same card after the board changes under it.
 *
 * Moving a card to another column is the common case, and without this the focus
 * index still points at a row that is now a different task — so the next keystroke
 * acts on the wrong one.
 */
export function locate(id, columns) {
  for (const [column, ids] of columns.entries()) {
    const row = ids.indexOf(id);
    if (row >= 0) return { column, row };
  }
  return null;
}

/**
 * Palette matching. Every token in the query must appear somewhere in the row, so
 * "done cred" finds "move to done" on the credential task; exact id and prefix hits
 * outrank the rest.
 *
 * ponytail: token-containment, not a fuzzy-match library. It is a command list of
 * tens of rows, not a codebase index.
 */
export function filterCommands(query, rows) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return rows;
  const tokens = q.split(/\s+/);
  return rows
    .map((row) => {
      const hay = `${row.id ?? ""} ${row.label} ${row.hint ?? ""}`.toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) return null;
      const id = String(row.id ?? "").toLowerCase();
      const score = id === q ? 0 : id.startsWith(q) ? 1 : row.label.toLowerCase().startsWith(q) ? 2 : 3;
      return { row, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score)
    .map((m) => m.row);
}

/** Grouped for the help sheet, in KEYMAP order. */
export function keymapByGroup() {
  const groups = new Map();
  for (const row of KEYMAP) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  return [...groups].map(([group, rows]) => ({ group, rows }));
}
