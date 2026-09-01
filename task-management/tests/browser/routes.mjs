/**
 * Every route in the app, opened in a real browser at a desktop and a phone width.
 *
 * The router is hand-rolled and the screens are lazy chunks, so the failure this guards is
 * the quiet one: a route that resolves, renders a blank canvas, and logs an error nobody is
 * looking at. Per route and width it asserts no console errors or uncaught exceptions, no
 * horizontal body scroll (the page must never scroll sideways — wide content scrolls inside
 * its own container), a document title, and an h1 on the canvas.
 *
 * NOT part of ./run-tests.sh: it needs Chrome and a built dashboard being served.
 *
 *   npm --prefix dashboard run build && bin/tm-dashboard --restart --no-browser
 *   node tests/browser/routes.mjs [url]
 *
 * ponytail: raw CDP like keyboard.mjs — same boilerplate, no shared helper, one file to read.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function runningBoard() {
  for (const base of [process.env.TM_ROOT, process.cwd()].filter(Boolean)) {
    const file = join(base, ".bytedesk", "task-management", "dashboard.port");
    if (existsSync(file)) return `http://127.0.0.1:${readFileSync(file, "utf8").trim()}/`;
  }
  return "http://127.0.0.1:7910/";
}
const URL_ = (process.argv[2] || runningBoard()).replace(/\/$/, "");
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844, mobile: true },
];

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
let board;
try {
  board = await fetch(`${URL_}/api/board`).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
} catch {
  console.log(`skip: no board answering at ${URL_} — start one with bin/tm-dashboard`);
  process.exit(0);
}

// The route table is the source of truth; read it rather than keep a second list here.
const routesTs = readFileSync(join(HERE, "..", "..", "dashboard", "src", "app", "routes.ts"), "utf8");
const patterns = [...routesTs.matchAll(/pattern:\s*"([^"]+)"/g)].map((m) => m[1]);
const sample = {
  "/tasks/:id": board.tasks?.[0]?.id,
  "/epics/:id": board.epics?.[0]?.id,
  "/sprints/:id": board.sprints?.[0]?.id,
  "/capabilities/:id": board.capabilities?.[0]?.id,
  "/decisions/:id": board.adrs?.[0]?.id,
};
const paths = patterns.map((p) => (p.includes(":id") ? (sample[p] ? p.replace(":id", sample[p]) : null) : p));
for (const [i, p] of patterns.entries()) if (!paths[i]) console.log(`  skip  ${p} — the store has nothing to open`);

const profile = mkdtempSync(join(tmpdir(), "routecheck-"));
const PORT = Number(process.env.ROUTECHECK_CDP_PORT || 0) || 20000 + Math.floor(Math.random() * 20000);
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-sandbox",
  "--disable-gpu",
  "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl && (t.url === "about:blank" || String(t.url).startsWith(URL_.replace(/\/$/, ""))));
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
let errors = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === "Runtime.exceptionThrown") {
    errors.push((msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || "exception").split("\n")[0]);
  } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    errors.push(msg.params.args.map((a) => String(a.value ?? a.description ?? "")).join(" ").split("\n")[0]);
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
await send("Runtime.enable");
await send("Page.enable");

const results = [];
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ pass, name });
  console.log(`${pass ? "  ok  " : "  FAIL"} ${name}${pass ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
};

for (const vp of VIEWPORTS) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: !!vp.mobile,
  });
  console.log(`\n${vp.name} ${vp.width}x${vp.height}`);
  for (const path of paths.filter(Boolean)) {
    errors = [];
    await send("Page.navigate", { url: `${URL_}${path}` });
    await sleep(1800);
    const shape = await evaluate(`({
      title: document.title,
      h1: !!document.querySelector('h1'),
      sideways: document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1,
    })`);
    check(`${path} renders without errors`, errors.slice(0, 3), []);
    check(`${path} has a title`, shape.title.length > 0, true);
    check(`${path} has an h1`, shape.h1, true);
    check(`${path} does not scroll sideways`, shape.sideways, false);
  }
}

chrome.kill();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
