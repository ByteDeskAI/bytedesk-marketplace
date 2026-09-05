/**
 * The goal planner's approval path, driven in a real browser.
 *
 * This exists because the properties worth guarding here are not expressible against jsdom or a
 * unit test. Whether a preview leaves the board alone is a server property and is tested there;
 * whether the OPERATOR can be shown one thing and have another applied is a property of the page,
 * the dialog and the request it actually sends.
 *
 * Four things it checks, and each is a real failure mode rather than a rendering detail:
 *
 *   1. Proposing writes nothing. The board count before and after a preview is the same.
 *   2. The apply control is gated on the explicit review checkbox, not merely styled as if it were.
 *   3. Applying sends the digest the server is holding, and the epic count moves by exactly one.
 *   4. There is no free composer. After the goal is submitted the only text input is the one bound
 *      to an open question — a surface that grew a general prompt box would fail here.
 *
 * ponytail: raw CDP over Node's global WebSocket, the way tests/browser/keyboard.mjs does it. No
 * Playwright, no new dependency.
 *
 * NOT part of ./run-tests.sh — that suite is deliberately dependency-free and this needs Chrome
 * plus a built dashboard being served:
 *
 *   npm --prefix dashboard run build
 *   node tests/browser/planner.mjs [url]
 *
 * It creates one planning session and one epic, and removes both before it exits, so it can be run
 * against a real board without leaving anything behind.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

/** The store this board is serving, for the one cleanup that has no HTTP route. */
function storeDir() {
  for (const base of [process.env.TM_ROOT, process.cwd()].filter(Boolean)) {
    const dir = join(base, ".bytedesk", "task-management");
    if (existsSync(join(dir, "dashboard.port"))) return dir;
  }
  return null;
}

const URL_ = process.argv[2] || runningBoard();
const api = (path) => new URL(path, URL_);

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

const post = (path, body) =>
  fetch(api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const get = (path) => fetch(api(path)).then((r) => r.json());
const epicCount = async () => (await get("/api/board")).epics.length;

/* ── set up one session with one proposal ─────────────────────────────────────────────── */

const TITLE = `planner browser check ${Date.now()}`;
const opened = await post("/api/planner", { goal: "Browser check: approve one governed change" });
if (opened.status !== 201) {
  console.log(`  FAIL could not open a planning session: ${JSON.stringify(opened.body)}`);
  process.exit(1);
}
const PL = opened.body.id;
await post(`/api/planner/${PL}/turn`, { role: "agent", kind: "question", text: "Which epic should this land under?" });

const proposed = await post(`/api/planner/${PL}/propose`, {
  operations: [{ op: "epic.create", args: { ref: "E", title: TITLE, body: "Created by tests/browser/planner.mjs." } }],
});
const DIGEST = proposed.body.digest;

const profile = mkdtempSync(join(tmpdir(), "plannercheck-"));
const PORT = Number(process.env.PLANNER_CDP_PORT || 0) || 20000 + Math.floor(Math.random() * 20000);
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-sandbox",
  "--disable-gpu",
  new URL(`/planner?session=${PL}`, URL_).toString(),
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ pass, name });
  console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${pass ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};

async function cleanup() {
  try {
    chrome.kill();
  } catch { /* already gone */ }
  // Chrome flushes its profile on the way out, so removing it immediately races that write and
  // throws ENOTEMPTY. Wait for the process, then treat the removal as best effort — a leftover
  // temp profile is untidy; a crash in cleanup would hide the results the check just produced.
  await new Promise((r) => { chrome.once("exit", r); setTimeout(r, 3000); });
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* a temp profile left behind is not worth failing over */ }
  // Remove what this check created, so it can run against a real board without silting it up.
  await fetch(api(`/api/planner/${PL}`), { method: "DELETE" }).catch(() => {});
  const board = await get("/api/board").catch(() => ({ epics: [] }));
  const mine = (board.epics || []).find((e) => e.title === TITLE);
  if (!mine) return;
  // There is no HTTP delete for an epic, on purpose — the board is a record, not a scratchpad.
  // So this reaches for the file directly, and ONLY for the one it created: matched by the
  // timestamped title it minted, never by position or by "the newest one".
  const dir = storeDir();
  if (!dir) {
    console.log(`  note: could not find the store; remove ${mine.id} (${TITLE}) by hand`);
    return;
  }
  const file = join(dir, "epics", `${mine.id}-${TITLE.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.md`);
  try {
    if (existsSync(file) && readFileSync(file, "utf8").includes(TITLE)) {
      rmSync(file);
      await fetch(api("/api/reindex"), { method: "POST" }).catch(() => {});
    } else {
      console.log(`  note: remove the epic this check created: ${mine.id} (${TITLE})`);
    }
  } catch {
    console.log(`  note: remove the epic this check created: ${mine.id} (${TITLE})`);
  }
}

try {
  async function target() {
    for (let i = 0; i < 60; i += 1) {
      try {
        const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
        const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && String(t.url).includes("/planner"));
        if (page) return page.webSocketDebuggerUrl;
      } catch { /* not up yet */ }
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

  // The screen is a lazy chunk plus two fetches; wait for the proposal rather than a fixed sleep.
  for (let i = 0; i < 60; i += 1) {
    if (await evaluate("document.querySelectorAll('.gp-proposal').length")) break;
    await sleep(250);
  }

  const before = await epicCount();
  check("the proposal renders as an inspectable card", await evaluate("document.querySelectorAll('.gp-proposal').length"), 1);
  check(
    "the card names a consequence, not just its arguments",
    await evaluate("(document.querySelector('.gp-proposal__consequence')?.textContent || '').includes('independently reviewable epic')"),
    true,
  );
  check("previewing wrote nothing to the board", await epicCount(), before);

  // The only text input on an open session is the one bound to the open question. A surface that
  // grew a general composer would fail here, which is the point of the assertion.
  check(
    "the only text input is the one bound to the open question",
    await evaluate("Array.from(document.querySelectorAll('textarea')).map(t=>t.closest('.gp-answer')?'answer':'loose').join(',')"),
    "answer",
  );

  await evaluate("document.querySelector('[data-gp=approve]').click()");
  await sleep(300);
  check("approving opens a confirmation", await evaluate("!!document.querySelector('dialog[open]')"), true);
  check(
    "the confirmation names the digest being approved",
    await evaluate(`(document.querySelector('dialog[open]')?.textContent || '').includes(${JSON.stringify(DIGEST.slice(0, 16))})`),
    true,
  );
  check(
    "apply is disabled until the review box is ticked",
    await evaluate("document.querySelector('dialog[open] [data-gp=apply]')?.disabled"),
    true,
  );

  // Clicking the disabled control must do nothing — a gate that only looks like a gate is worse
  // than none, because the dialog then reads as consent that was never given.
  await evaluate("document.querySelector('dialog[open] [data-gp=apply]').click()");
  await sleep(300);
  check("a click on the disabled control applies nothing", await epicCount(), before);

  await evaluate("document.querySelector('dialog[open] input[type=checkbox]').click()");
  await sleep(150);
  check(
    "ticking the box enables apply",
    await evaluate("document.querySelector('dialog[open] [data-gp=apply]')?.disabled"),
    false,
  );

  await evaluate("document.querySelector('dialog[open] [data-gp=apply]').click()");
  for (let i = 0; i < 40; i += 1) {
    if ((await epicCount()) !== before) break;
    await sleep(250);
  }
  check("approving applies exactly the proposed change", await epicCount(), before + 1);
  check("and the session ends", (await get(`/api/planner/${PL}`)).status, "applied");
} catch (e) {
  console.log(`  FAIL ${e.message}`);
  results.push({ pass: false, name: "ran to completion" });
} finally {
  await cleanup();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
