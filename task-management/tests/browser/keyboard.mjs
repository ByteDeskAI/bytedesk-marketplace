/**
 * The board's keyboard, driven with real key events in a real browser.
 *
 * tests/unit/keys.test.mjs covers every decision; this covers the wiring those
 * decisions hang off — that the handler is actually attached, that DOM focus follows
 * the cursor so assistive tech goes with it, that the ring is visible, and above all
 * that typing `j` into the search field types a j instead of moving the board.
 *
 * NOT part of ./run-tests.sh: that suite is deliberately dependency-free, and this
 * needs Chrome plus a built dashboard being served. Run it by hand after changing
 * the board's keyboard:
 *
 *   npm --prefix dashboard run build
 *   node tests/browser/keyboard.mjs [url]        # url defaults to the running board
 *
 * ponytail: raw CDP over Node's global WebSocket, no Playwright. One script, one
 * protocol, nothing to keep updated — swap in Playwright if this ever needs more
 * than key events and a DOM read.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Whatever the plugin's own dashboard wrote down, so there is no port to remember. */
function runningBoard() {
  for (const base of [process.env.TM_ROOT, process.cwd()].filter(Boolean)) {
    const file = join(base, ".bytedesk", "task-management", "dashboard.port");
    if (existsSync(file)) return `http://127.0.0.1:${readFileSync(file, "utf8").trim()}/`;
  }
  return "http://127.0.0.1:7910/";
}

const URL_ = process.argv[2] || runningBoard();

const CHROME = ["google-chrome", "chromium", "chromium-browser"].find((bin) => {
  try {
    return spawn(bin, ["--version"], { stdio: "ignore" }) && true;
  } catch {
    return false;
  }
});
if (!CHROME) {
  console.log("skip: no chrome on PATH — this check needs a real browser");
  process.exit(0);
}

try {
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(String(res.status));
} catch {
  console.log(`skip: no board answering at ${URL_} — start one with bin/tm-dashboard`);
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), "keycheck-"));
const PORT = Number(process.env.KEYCHECK_CDP_PORT || 9333);
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-sandbox",
  "--disable-gpu",
  URL_,
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("chrome never came up");
}

const ws = new WebSocket(await target());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let seq = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
};

/** A real key press: rawKeyDown then keyUp, the way a keyboard does it. */
async function press(key, { code, modifiers = 0 } = {}) {
  const text = key.length === 1 ? key : undefined;
  await send("Input.dispatchKeyEvent", {
    type: text ? "keyDown" : "rawKeyDown",
    key,
    code: code || (key.length === 1 ? `Key${key.toUpperCase()}` : key),
    text,
    unmodifiedText: text,
    modifiers,
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: code || key, modifiers });
  await sleep(140);
}

await sleep(2500);
const results = [];
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ pass, name, actual, expected });
  console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${pass ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};

const cursor = () => evaluate("document.activeElement?.getAttribute?.('data-tm-card') ?? null");
const ringed = () =>
  evaluate(
    "Array.from(document.querySelectorAll('[data-tm-card]')).filter(e=>getComputedStyle(e).outlineStyle==='solid').map(e=>e.getAttribute('data-tm-card')).join(',') || null",
  );

check("board rendered", await evaluate("document.querySelectorAll('[data-tm-card]').length > 0"), true);
check("no cursor before any key", await cursor(), null);

await press("j");
const first = await cursor();
check("j puts the cursor on the first card of the first non-empty column", first !== null, true);
check("the focused card is the one with the visible ring", await ringed(), first);

// Whether `j` moves or clamps depends on how many cards that column holds, and this
// check runs against whatever board is up. Assert the actual contract — move when
// there is somewhere to go, stay put at the end — rather than assuming a tall column.
const columnDepth = await evaluate(
  `(() => {
     const el = document.querySelector('[data-tm-card="${first}"]');
     return el ? el.closest('[role=list]').querySelectorAll('[data-tm-card]').length : 0;
   })()`,
);
await press("j");
const second = await cursor();
check(
  columnDepth > 1 ? "j again moves down within the column" : "j clamps at the end of a one-card column",
  columnDepth > 1 ? second !== first : second === first,
  true,
);

await press("l");
const across = await cursor();
check("l crosses to the next non-empty column", across !== second && across !== null, true);

await press("h");
check("h comes back", await cursor(), second);

await press("g");
check("g jumps to the top of the column", await cursor(), first);

// The board's own accessibility surface.
check("columns are lists", await evaluate("document.querySelectorAll('[role=list]').length"), 5);
check(
  "cards are list items with labels",
  await evaluate("Array.from(document.querySelectorAll('[data-tm-card]')).every(e=>e.getAttribute('role')==='listitem' && (e.getAttribute('aria-label')||'').length>10)"),
  true,
);
check(
  "roving tabindex: exactly one card is tabbable",
  await evaluate("Array.from(document.querySelectorAll('[data-tm-card]')).filter(e=>e.getAttribute('tabindex')==='0').length"),
  1,
);
// Read the card's own status out of the label and check it against the column it sits
// in, rather than against a hardcoded list of statuses this board might not contain.
check(
  "the aria-label carries the status the column header shows",
  await evaluate(
    `(() => {
       const el = document.activeElement;
       const label = el.getAttribute('aria-label') || '';
       const heading = el.closest('[role=list]').getAttribute('aria-label') || '';
       const status = heading.split(',')[0].trim();
       return label.includes(status) && label.startsWith(el.getAttribute('data-tm-card'));
     })()`,
  ),
  true,
);

// ? opens the help sheet, Escape closes it.
await press("?", { code: "Slash", modifiers: 8 });
check("? opens the shortcut sheet", await evaluate("!!document.body.textContent.match(/Keyboard shortcuts/)"), true);
await press("Escape");
await sleep(300);
check("Escape closes it", await evaluate("!document.body.textContent.match(/Keyboard shortcuts/)"), true);

// ⌘K / Ctrl-K opens the palette, and it opens from inside a text field too.
await press("k", { modifiers: 2 });
check("Ctrl-K opens the palette", await evaluate("!!document.querySelector('#tm-palette-list')"), true);
await press("Escape");
await sleep(300);
check("Escape closes the palette", await evaluate("!document.querySelector('#tm-palette-list')"), true);

// / focuses search, and then plain letters must go INTO the field, not to the board.
await press("/", { code: "Slash" });
check("/ focuses the search field", await evaluate("document.activeElement.tagName"), "INPUT");
await press("j");
await press("j");
check("letters typed in the field stay in the field", await evaluate("document.activeElement.value"), "jj");
check("and the board did not move its cursor", await cursor(), null);

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
ws.close();
chrome.kill();
process.exit(failed ? 1 : 0);
