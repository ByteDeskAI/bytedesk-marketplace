/**
 * The task drawer's layout, measured in a real browser at a short viewport.
 *
 * This exists because the bug it guards was invisible in a diff and invisible in every unit and
 * contract test: the drawer was one `Stack` in a fixed-height panel, so its content simply
 * overflowed with nothing to scroll it. Measured on a task with five acceptance criteria: 1022px
 * of content in an 812px panel, the entire COMMENTS section — every comment and the field to add
 * one — stranded 210px below the fold and unreachable, and a wheel over the drawer scrolling the
 * *board behind it* instead.
 *
 * None of that is expressible against jsdom: it is computed style, real layout and real overflow.
 * So it is checked the same way tests/browser/keyboard.mjs checks the board's keyboard — raw CDP
 * against headless Chrome, no Playwright.
 *
 * NOT part of ./run-tests.sh: that suite is deliberately dependency-free, and this needs Chrome
 * plus a built dashboard being served. Run it by hand after changing the drawer:
 *
 *   npm --prefix dashboard run build
 *   node tests/browser/drawer.mjs [url]      # url defaults to the running board
 *
 * It needs a task with enough content to overflow — several acceptance criteria and a comment or
 * two. On a board of one-line tasks nothing overflows and the check reports that rather than
 * passing vacuously.
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
/** Short on purpose: the defect only shows when the content is taller than the panel. */
const VIEWPORT = { width: 1280, height: 620 };

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

const profile = mkdtempSync(join(tmpdir(), "drawercheck-"));
const PORT = Number(process.env.DRAWERCHECK_CDP_PORT || 9334);
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    "--no-first-run",
    "--no-sandbox",
    "--disable-gpu",
    URL_,
  ],
  { stdio: "ignore" },
);

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

await sleep(2500);
const results = [];
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ pass, name });
  console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${pass ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};

console.log(`drawer layout @ ${VIEWPORT.width}x${VIEWPORT.height}`);

/** A real key press, the way keyboard.mjs does it — the board's own j/o bindings open a card. */
async function press(key) {
  const text = key.length === 1 ? key : undefined;
  await send("Input.dispatchKeyEvent", {
    type: text ? "keyDown" : "rawKeyDown",
    key,
    code: `Key${key.toUpperCase()}`,
    text,
    unmodifiedText: text,
  });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: `Key${key.toUpperCase()}` });
  await sleep(160);
}

// Opened through the board's own keyboard rather than by guessing at a clickable element: `j`
// moves the cursor to the first card, `o` opens it. Deterministic on any board with a task.
let hasCards = false;
for (let i = 0; i < 60 && !hasCards; i++) {
  hasCards = await evaluate("document.querySelectorAll('[data-tm-card]').length > 0");
  if (!hasCards) await sleep(250);
}
if (!hasCards) {
  console.log("skip: the board has no tasks to open");
  process.exit(0);
}
/**
 * The way in has to be a control.
 *
 * The card title was a `div` with `cursor: pointer` and an onClick: clickable with a mouse and
 * nothing else. Tab never reached it, screen readers never announced it, and automation could not
 * find it — which is how it surfaced, when agent-browser could not click a card title at all.
 */
const titleControl = await evaluate(`
  (() => {
    const el = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Open TM-'));
    if (!el) return { found: false };
    return { found: true, tag: el.tagName, tabbable: el.tabIndex >= 0, label: el.getAttribute('aria-label').slice(0, 40) };
  })()`);
check("the card title is a real button", titleControl.found, true);
check("and it is reachable by keyboard", titleControl.tabbable, true);

await press("j");
await press("o");
await sleep(900);

const shape = await evaluate(`
  (() => {
    // The inspector marks itself; its body is the one scrolling region (shell.css).
    const shell = document.querySelector('[data-tm-drawer]');
    if (!shell || getComputedStyle(shell).display !== 'grid') return { found: false };
    const scroller = [...shell.querySelectorAll('*')].find(e => ['auto','scroll'].includes(getComputedStyle(e).overflowY));
    if (!scroller) return { found: true, scroller: false };
    const idEl = [...shell.querySelectorAll('*')].find(e => e.childElementCount === 0 && /^TM-\\d+$/.test(e.textContent.trim()));
    const headerBefore = idEl ? idEl.getBoundingClientRect().top : null;
    const pageBefore = document.documentElement.scrollTop;

    const overflows = scroller.scrollHeight > scroller.clientHeight + 4;
    scroller.scrollTop = scroller.scrollHeight;

    const last = [...shell.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent.trim()).pop();
    const lastRect = last ? last.getBoundingClientRect() : null;
    return {
      found: true,
      scroller: true,
      overflows,
      overscroll: getComputedStyle(scroller).overscrollBehaviorY,
      scrolled: scroller.scrollTop > 0,
      pageMoved: document.documentElement.scrollTop !== pageBefore,
      headerStayed: idEl ? Math.abs(idEl.getBoundingClientRect().top - headerBefore) < 2 : null,
      lastElementReachable: lastRect ? (lastRect.top < window.innerHeight && lastRect.bottom > 0) : null,
    };
  })()`);

check("the inspector ([data-tm-drawer]) is a grid that fills the panel", shape.found, true);
check("its body is the scrolling region", shape.scroller, true);
if (!shape.overflows) {
  console.log("  note: nothing overflowed — open a denser task to exercise this properly");
} else {
  check("the body actually scrolls", shape.scrolled, true);
  check("the last element is reachable once scrolled", shape.lastElementReachable, true);
  check("the header does not move with it", shape.headerStayed, true);
}
// The reported symptom, asserted directly: scrolling the drawer must not scroll the board.
check("the board behind it does not move", shape.pageMoved, false);
check("scroll chaining is contained", shape.overscroll, "contain");

chrome.kill();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
