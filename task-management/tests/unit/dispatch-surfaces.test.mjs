/**
 * TM-064 — the dispatch layer on all three surfaces: CLI `tm dispatch`, MCP
 * `tm_dispatch`, HTTP `POST /api/task/:id/dispatch` (+ `GET /api/caps`).
 *
 * The parity invariant: one code path (lib/dispatch) and ONE refusal wording.
 * These tests assert the exact same string crosses subprocess stderr, an MCP
 * tool result and an HTTP 409 unchanged.
 *
 * Injection: TM_DISPATCH_REGISTRY names a module exporting a backend registry
 * (envRegistry() in lib/dispatch/backend.mjs) — the one mechanism that reaches
 * the CLI subprocess and the in-process surfaces identically.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempRepo } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { claimTask } from "../../lib/claims.mjs";
import { gateStart } from "../../lib/enforce.mjs";
import { create, read, seedGitContract, state, update, writeConfig } from "../../lib/store.mjs";
import { handleRequest } from "../../lib/mcp.mjs";
import { handleAsync, handleWrite } from "../../lib/dashboard-api.mjs";

// The WIP-gate test needs enforcement on, whatever the runner exports.
delete process.env.TM_ENFORCE;

const trash = [];
after(() => cleanup(...trash));

const TM_BIN = fileURLToPath(new URL("../../bin/tm", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/fake-dispatch-registry.mjs", import.meta.url));

/** A store rooted in a real git repo, because dispatch provisions a worktree. */
function repoStore(cfg = {}) {
  const root = tempRepo();
  const p = paths(root);
  ensureDirs(p);
  seedGitContract(p);
  writeConfig({ requireEpic: false, wipLimit: 99, ...cfg }, p);
  trash.push(root);
  return p;
}

/**
 * Run the real CLI as a subprocess. TM_SESSION_ID leads SESSION_ENV, so the
 * session is deterministic no matter which harness env the suite runs under;
 * TM_DISPATCH_REGISTRY injects the fake backend through envRegistry().
 */
function tmCli(p, args, env = {}) {
  const full = { ...process.env, TM_ROOT: p.root, TM_SESSION_ID: "s-cli", ...env };
  try {
    const stdout = execFileSync("node", [TM_BIN, ...args], { cwd: p.root, env: full, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || "", stderr: err.stderr || "" };
  }
}

/** The JSON payload a tools/call response carries in its single text block. */
async function mcpDispatch(p, args) {
  const res = await handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "tm_dispatch", arguments: args } }, { p });
  return JSON.parse(res.result.content[0].text);
}

/** Env around an await — the in-process surfaces read TM_DISPATCH_REGISTRY from process.env. */
async function withEnv(vars, fn) {
  const saved = new Map(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const injected = { TM_DISPATCH_REGISTRY: FIXTURE };

describe("CLI tm dispatch", () => {
  it("dispatches to a fake backend: claims, starts, provisions, prints the run", () => {
    const p = repoStore();
    const t = create("task", { title: "dispatch me" }, "the body", p);

    const r = tmCli(p, ["dispatch", t.id, "--backend", "fake", "--json"], injected);

    assert.equal(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assert.equal(res.ok, true);
    assert.equal(res.backend, "fake");
    assert.equal(res.run, "fake:run-1");
    assert.equal(read(t.id, p).status, "in_progress", "the same write `tm start` performs");
    assert.equal(read(t.id, p).dispatched.backend, "fake");
    assert.equal(state(p).claims[t.id].session, "s-cli");
  });

  it("prints the one-line summary and, for the manual backend, the commands to paste", () => {
    const p = repoStore();
    const t = create("task", { title: "by hand" }, "", p);

    const r = tmCli(p, ["dispatch", t.id, "--backend", "manual"]);

    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^${t.id} dispatched to manual`, "m"));
    assert.match(r.stdout, /^cd \S+/m, "the worktree cd is printed");
    assert.match(r.stdout, /# start your agent harness/);
    assert.match(r.stdout, /# Handoff — /, "the handoff itself is the last thing printed");
  });

  it("--backend bogus is refused before anything is claimed", () => {
    const p = repoStore();
    const t = create("task", { title: "pinned" }, "", p);

    const r = tmCli(p, ["dispatch", t.id, "--backend", "bogus"]);

    assert.equal(r.code, 2);
    assert.match(r.stderr, /no dispatch backend available/);
    assert.match(r.stderr, /bogus: module not present/);
    assert.equal(read(t.id, p).status, "open", "a refused dispatch starts nothing");
    assert.equal(state(p).claims[t.id], undefined, "and claims nothing");
  });
});

describe("the refusal wording is one string on every surface", () => {
  it("a live claim refuses CLI, MCP and HTTP with the exact same text", async () => {
    const p = repoStore();
    const t = create("task", { title: "contended" }, "", p);
    // A live claim from another session: real worktree dir, so it cannot read as expired.
    const theirs = join(p.root, "their-checkout");
    mkdirSync(theirs, { recursive: true });
    claimTask(t.id, { session: "s1", actor: "@alice", worktree: theirs, p });

    const cli = tmCli(p, ["dispatch", t.id], injected);
    assert.equal(cli.code, 2);
    const mcp = await withEnv(injected, () => mcpDispatch(p, { id: t.id }));
    assert.equal(mcp.ok, false);
    const http = await withEnv(injected, () => handleAsync("POST", `/api/task/${t.id}/dispatch`, {}, { p }));
    assert.equal(http.status, 409);

    const wording = cli.stderr.trim();
    assert.match(wording, /@alice/, "the refusal names the holder");
    assert.match(wording, /--steal/);
    assert.equal(mcp.error, wording, "MCP carries the CLI's words verbatim");
    assert.equal(http.body.error, wording, "HTTP carries the CLI's words verbatim");

    assert.equal(read(t.id, p).status, "open");
    assert.equal(state(p).claims[t.id].session, "s1", "the original claim still stands");
  });

  it("the WIP gate refuses dispatch on every surface with the exact same text", async () => {
    const p = repoStore({ wipLimit: 1 });
    const busy = create("task", { title: "busy" }, "", p);
    const queued = create("task", { title: "queued" }, "", p);
    update(busy.id, { status: "in_progress" }, p);
    const expected = gateStart(queued.id, p).reason;
    assert.ok(expected, "the gate genuinely refuses here");

    const cli = tmCli(p, ["dispatch", queued.id], injected);
    assert.equal(cli.code, 2);
    const mcp = await withEnv(injected, () => mcpDispatch(p, { id: queued.id }));
    const http = await withEnv(injected, () => handleAsync("POST", `/api/task/${queued.id}/dispatch`, {}, { p }));

    assert.equal(cli.stderr.trim(), expected);
    assert.equal(mcp.error, expected);
    assert.equal(http.status, 409);
    assert.equal(http.body.error, expected);
    assert.equal(read(queued.id, p).status, "open", "a gated dispatch leaves the task untouched");
    assert.equal(state(p).claims[queued.id], undefined);
  });
});

describe("MCP tm_dispatch", () => {
  it("dispatches through the same core and answers with the dispatch result", async () => {
    const p = repoStore();
    const t = create("task", { title: "over the wire" }, "", p);

    const res = await withEnv({ ...injected, TM_SESSION_ID: "s-mcp" }, () => mcpDispatch(p, { id: t.id, backend: "fake" }));

    assert.equal(res.ok, true, res.error);
    assert.equal(res.backend, "fake");
    assert.equal(res.run, "fake:run-1");
    assert.equal(read(t.id, p).status, "in_progress");
    assert.equal(state(p).claims[t.id].session, "s-mcp");
  });

  it("refuses an id that does not exist", async () => {
    const p = repoStore();
    const res = await withEnv(injected, () => mcpDispatch(p, { id: "TM-404" }));
    assert.equal(res.ok, false);
    assert.match(res.error, /not found: TM-404/);
  });

  it("a re-dispatch from another session is refused while the first claim is live", async () => {
    const p = repoStore();
    const t = create("task", { title: "taken" }, "", p);

    const first = await withEnv({ ...injected, TM_SESSION_ID: "s-first" }, () => mcpDispatch(p, { id: t.id, backend: "fake" }));
    assert.equal(first.ok, true, first.error);

    const again = await withEnv({ ...injected, TM_SESSION_ID: "s-second" }, () => mcpDispatch(p, { id: t.id, backend: "fake" }));
    assert.equal(again.ok, false);
    assert.match(again.error, /s-first|claimed/, "the refusal names the live claim");
    assert.equal(read(t.id, p).status, "in_progress", "the first dispatch still owns the task");
  });
});

describe("HTTP POST /api/task/:id/dispatch", () => {
  it("200 with the dispatch result on success", async () => {
    const p = repoStore();
    const t = create("task", { title: "from the board" }, "", p);

    const res = await withEnv({ ...injected, TM_SESSION_ID: "s-http" }, () =>
      handleAsync("POST", `/api/task/${t.id}/dispatch`, { backend: "fake" }, { p }),
    );

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.backend, "fake");
    assert.equal(read(t.id, p).status, "in_progress");
    assert.equal(state(p).claims[t.id].session, "s-http");
  });

  it("404 for a missing task, 400 for a non-task id — requireTask's conventions", async () => {
    const p = repoStore();
    const missing = await handleAsync("POST", "/api/task/TM-404/dispatch", {}, { p });
    assert.equal(missing.status, 404);
    const epic = create("epic", { title: "not a task" }, "", p);
    const wrongKind = await handleAsync("POST", `/api/task/${epic.id}/dispatch`, {}, { p });
    assert.equal(wrongKind.status, 400);
  });
});

describe("GET /api/caps", () => {
  it("returns the host capability report, manual floor included", () => {
    const p = repoStore();
    const res = handleWrite("GET", "/api/caps", null, { p });
    assert.equal(res.status, 200);
    assert.equal(res.body.backends.manual.available, true, "the floor never disappears");
    for (const name of ["orchestration", "fleet", "tmux"]) {
      assert.ok(typeof res.body.backends[name].available === "boolean", `${name} reports availability`);
    }
  });
});
