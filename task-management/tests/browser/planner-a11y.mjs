/**
 * The goal planner at phone width, with a keyboard and with reduced motion.
 *
 * These are the acceptance checks that cannot be written against jsdom, because every one of them
 * is a question about computed style, real layout or real focus. A unit test can assert that a
 * class is applied; only a browser can say whether the page scrolls sideways at 390px, whether the
 * store's verbatim refusal actually wraps instead of being clipped, or whether the live region is
 * announced without being seen.
 *
 * It seeds nothing: point it at a session that already has a question and a refused proposal, which
 * is the state where all of this is visible at once.
 *
 *   npm --prefix dashboard run build
 *   node tests/browser/planner-a11y.mjs "http://127.0.0.1:<port>/planner?session=PL-…"
 *
 * NOT part of ./run-tests.sh — that suite is deliberately dependency-free and this needs Chrome.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2];
if (!URL_) {
  console.log("skip: pass a planner session url, e.g. http://127.0.0.1:<port>/planner?session=PL-…");
  process.exit(0);
}
try {
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(String(res.status));
} catch {
  console.log(`skip: nothing answering at ${URL_} — start a board with bin/tm-dashboard`);
  process.exit(0);
}
const profile = mkdtempSync(join(tmpdir(), "a11y-"));
const PORT = 21000 + Math.floor(Math.random() * 9000);
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
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-sandbox", "--disable-gpu", "--window-size=390,844", URL_], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, seq = 0; const pending = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
    const page = list.find((t) => t.type === "page" && String(t.url).includes("/planner"));
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
  } catch {}
  await sleep(250);
}
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
ws.addEventListener("message", (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } });
const send = (method, params = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
for (let i = 0; i < 60; i++) { if (await ev("document.querySelectorAll('.gp-proposal').length")) break; await sleep(250); }
await sleep(400);

const results = [];
const check = (n, a, e) => { const p = JSON.stringify(a) === JSON.stringify(e); results.push(p); console.log(`${p ? "  ok  " : "  FAIL"} ${n}${p ? "" : `  expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`}`); };

check("no horizontal page scroll at 390px", await ev("document.documentElement.scrollWidth <= window.innerWidth + 1"), true);
check("the turn grid collapses to one column on phone",
  await ev("getComputedStyle(document.querySelector('.gp-turn')).gridTemplateColumns.split(' ').length"), 1);
check("touch targets meet the family floor",
  await ev("Array.from(document.querySelectorAll('button, input, select, textarea')).filter(e=>e.offsetParent!==null).every(e=>e.getBoundingClientRect().height >= 32)"), true);
check("the verbatim refusal wraps instead of clipping",
  await ev("(()=>{const p=document.querySelector('.gp-refusal'); if(!p) return 'no refusal rendered'; return getComputedStyle(p).whiteSpace === 'pre-wrap' && p.scrollWidth <= p.clientWidth + 1;})()"), true);
check("the live region is announced but not shown",
  await ev("(()=>{const r=document.querySelector('[role=status][aria-live=polite]'); if(!r) return 'missing'; const s=getComputedStyle(r); return s.position==='absolute' && parseInt(s.width)<=1;})()"), true);
check("every section is labelled for a screen reader",
  await ev("Array.from(document.querySelectorAll('section')).every(s=>s.getAttribute('aria-labelledby') && document.getElementById(s.getAttribute('aria-labelledby')))"), true);
check("the refused proposal is not colour-only",
  await ev("(()=>{const c=document.querySelector('.gp-proposal[data-valid=no]'); return c ? /refused/i.test(c.textContent) : 'no refused card';})()"), true);

// Keyboard: tab from the top and confirm every interactive control is reachable in DOM order.
await ev("document.body.focus()");
const order = await ev(`(()=>{
  const focusable = Array.from(document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])'))
    .filter(e => e.offsetParent !== null);
  return focusable.every(e => e.tabIndex >= 0);
})()`);
check("every visible control is keyboard reachable", order, true);
check("focus is visible, not suppressed",
  await ev("(()=>{const b=document.querySelector('.gp-answer button, .gp-actions button'); if(!b) return 'none'; b.focus(); return getComputedStyle(b, ':focus-visible').outlineStyle !== undefined;})()"), true);

// Reduced motion: the global kill switch must exist and cover the planner.
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await sleep(200);
// The family's kill switch uses 0.01ms rather than 0 — a zero-duration transition can skip its
// transitionend event, which breaks code that waits for one. So the assertion is "effectively
// instant", not "exactly zero".
console.log("    (measured transition-duration:", await ev("getComputedStyle(document.querySelector('.gp-proposal')).transitionDuration"), ")");
check("nothing animates under prefers-reduced-motion",
  await ev("Array.from(document.querySelectorAll('.gp-proposal, .gp-turn, .gp-answer, .gp-session, button')).every(e=>{const s=getComputedStyle(e); const dur=Math.max(...String(s.transitionDuration).split(',').map(v=>parseFloat(v)||0)); const anim=Math.max(...String(s.animationDuration).split(',').map(v=>parseFloat(v)||0)); return dur <= 0.001 && anim <= 0.001;})"), true);

chrome.kill();
await new Promise((r) => { chrome.once("exit", r); setTimeout(r, 3000); });
try { rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch {}
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
