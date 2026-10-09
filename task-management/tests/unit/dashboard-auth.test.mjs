/**
 * TM-468: the dashboard's write API requires a per-dashboard secret, and a board write is the
 * board's own — never the session that happened to launch the dashboard.
 *
 * Against a REAL `bin/tm-dashboard` process: the token is minted, written, checked and printed by
 * the server binary, and the identity is set there too, so a test of the library alone would not
 * exercise either.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import { writeConfig } from "../../lib/store.mjs";
import { SESSION_ENV } from "../../lib/harness/sessions.mjs";
import { installWriteToken } from "../../dashboard/src/lib/write-token.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "tm-dashboard");
const LEAD = "lead-session-0000-tm468";
const trash = [];
after(() => cleanup(...trash));

const freePort = () => new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

describe("TM-468 dashboard write API", () => {
  let p;
  let child;
  let base;
  let stdout = "";

  before(async () => {
    p = tempStore();
    trash.push(p.root);
    writeConfig({ requireEpic: false, dispatch: { enabled: false } }, p);
    const port = await freePort();
    const env = { ...process.env, TM_ROOT: p.root, TM_DASHBOARD_PORT: String(port), CLAUDE_CODE_SESSION_ID: LEAD };
    for (const k of SESSION_ENV) if (k !== "CLAUDE_CODE_SESSION_ID") delete env[k];
    for (const k of Object.keys(env)) if (/^(AO_|TM_NTFY_|TM_ACTOR$|CLAUDE_AGENT_NAME$|TMUX)/.test(k)) delete env[k];
    child = spawn(process.execPath, [BIN, "--no-browser"], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => (stdout += d));
    base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100 && !stdout.includes("task-management board:"); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.match(stdout, /task-management board:/, `the board came up: ${stdout}`);
  });
  after(() => child?.kill("SIGTERM"));

  const tokenFile = () => join(p.base, "dashboard.token");
  const post = (path, body, headers = {}) =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const create = (headers) => post("/api/task", { title: "made from the board", body: "context", acceptance: ["it exists"] }, headers);

  it("mints a token, writes it 0600 under the store, and prints it only in the link's fragment", () => {
    assert.ok(existsSync(tokenFile()), "dashboard.token exists");
    assert.equal(statSync(tokenFile()).mode & 0o777, 0o600);
    const token = readFileSync(tokenFile(), "utf8").trim();
    assert.match(token, /^[A-Za-z0-9_-]{40,}$/);
    assert.ok(stdout.includes(`/#tm-token=${token}`), `the printed link carries the token: ${stdout}`);
  });

  it("refuses an unauthenticated POST, and writes nothing", async () => {
    const res = await create();
    assert.equal(res.status, 401);
    assert.match((await res.json()).error, /write token is missing/);
    const board = await (await fetch(`${base}/api/board`)).json();
    assert.equal(JSON.stringify(board).includes("made from the board"), false, "the refused create did not land");
  });

  it("refuses a wrong token, and a PATCH without one", async () => {
    const wrong = await create({ "x-tm-token": "A".repeat(43) });
    assert.equal(wrong.status, 401);
    assert.match((await wrong.json()).error, /wrong or stale/);
    const patch = await fetch(`${base}/api/task/TM-001`, { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(patch.status, 401);
  });

  it("accepts the token the dashboard wrote, and a claim through it is the dashboard's, not the lead's", async () => {
    const token = readFileSync(tokenFile(), "utf8").trim();
    const made = await create({ "x-tm-token": token });
    assert.equal(made.status, 201, await made.clone().text());
    const { id } = await made.json();
    const claimed = await post(`/api/task/${id}/claim`, {}, { "x-tm-token": token });
    assert.equal(claimed.status, 200, await claimed.clone().text());
    const claim = JSON.parse(readFileSync(join(p.base, "state.json"), "utf8")).claims[id];
    assert.equal(claim.session, "tm-dashboard", `the claim's session: ${JSON.stringify(claim)}`);
    assert.equal(claim.actor, "@dashboard");
    assert.notEqual(claim.session, LEAD, "the launching session is never borrowed");
    const events = readFileSync(join(p.base, "events.jsonl"), "utf8");
    assert.equal(events.includes(LEAD), false, "no event is attributed to the launching session");
  });

  it("reads need no token", async () => {
    assert.equal((await fetch(`${base}/api/board`)).status, 200);
  });
});

describe("TM-468 the UI sends the token", () => {
  /** A window just big enough for installWriteToken: location, history, storage, fetch. */
  function fakeWindow(href) {
    const store = new Map();
    const calls = [];
    const url = new URL(href);
    const win = {
      location: { href: url.href, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash },
      history: { state: null, replaceState(_s, _t, to) { win.location.hash = ""; win.location.href = new URL(to, url).href; } },
      localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      Headers,
      fetch: (input, init = {}) => {
        calls.push({ input, method: init.method ?? "GET", token: new Headers(init.headers).get("x-tm-token") });
        return Promise.resolve(new Response("{}"));
      },
    };
    return { win, calls, store };
  }

  it("captures the fragment, strips it, and sends the token on writes only", async () => {
    const { win, calls, store } = fakeWindow("http://127.0.0.1:45001/tasks?x=1#tm-token=abc_DEF-123");
    installWriteToken(win);
    assert.equal(store.get("tm.writeToken"), "abc_DEF-123", "kept for reloads");
    assert.equal(win.location.hash, "", "the token leaves the address bar");
    await win.fetch("/api/task", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await win.fetch("/api/task/TM-1", { method: "PATCH", body: "{}" });
    await win.fetch("/api/board");
    await win.fetch("https://elsewhere.example/api/task", { method: "POST" });
    assert.deepEqual(calls.map((c) => [c.method, c.token]), [["POST", "abc_DEF-123"], ["PATCH", "abc_DEF-123"], ["GET", null], ["POST", null]]);
  });

  it("a reload without the fragment still writes with the stored token", async () => {
    const { win, calls, store } = fakeWindow("http://127.0.0.1:45001/");
    store.set("tm.writeToken", "kept");
    installWriteToken(win);
    await win.fetch("/api/settings", { method: "POST", body: "{}" });
    assert.equal(calls[0].token, "kept");
  });
});
