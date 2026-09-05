/**
 * The dispatch backends that land workers outside this process: orchestration
 * (an MCP stdio client of the sibling agent-orchestration plugin) and topology
 * (an argv-only shell-out to that same plugin's `ao-topology launch`).
 *
 * Orchestration is tested against a REAL child process running a fake MCP server
 * (fixtures/fake-orchestration-mcp.mjs) — a stubbed spawn proves nothing about a
 * line-delimited JSON-RPC handshake. Topology is tested with a stubbed spawnSync,
 * because its whole contract is the argv, the env and the spec it writes, and
 * those are pure values.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup } from "./helpers.mjs";
import { paths } from "../../lib/paths.mjs";
import { resolveBackend } from "../../lib/dispatch/backend.mjs";
import * as orchestration from "../../lib/dispatch/orchestration.mjs";
import * as topology from "../../lib/dispatch/topology.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_SERVER = join(HERE, "fixtures", "fake-orchestration-mcp.mjs");

const trash = [];
after(() => cleanup(...trash));

/** Caps that make one backend present at a fixed fake path. */
function capsWith(entries) {
  return { backends: { manual: { available: true }, ...entries } };
}

/** A dispatch request the way dispatch/index.mjs builds it. */
function req(over = {}) {
  return {
    task: { id: "TM-001", title: "Fix the thing", type: "task", labels: [] },
    worktree: "/repo/.bytedesk/worktrees/TM-001-fix-the-thing",
    prompt: "# Handoff — TM-001 Fix the thing\n\nDo it. `rm -rf $HOME` is just text here.",
    session: "s-1",
    actor: "@bot",
    p: { root: "/repo" },
    ...over,
  };
}

/** Spawn the fake MCP server and call orchestration.spawn against it. */
async function spawnAgainstFake(request, { mode = "ok", env = {}, ...opts } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "tm-orch-test-"));
  trash.push(dir);
  const capture = join(dir, "capture.json");
  const res = await orchestration.spawn(request, {
    caps: capsWith({ orchestration: { available: true, path: FAKE_SERVER } }),
    env: { ...process.env, FAKE_MODE: mode, FAKE_CAPTURE: capture, ...env },
    ...opts,
  });
  return { res, capture, dir };
}

/** Wait until a pid is gone (SIGTERM delivery is not synchronous with kill()). */
async function waitDead(pid, ms = 2000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe("orchestration backend — availability and request shape", () => {
  it("is available exactly when caps found the MCP binary", () => {
    assert.equal(orchestration.available(capsWith({ orchestration: { available: true, path: "/x" } })), true);
    assert.equal(orchestration.available(capsWith({ orchestration: { available: false, reason: "gone" } })), false);
    assert.equal(orchestration.available({ backends: {} }), false);
  });

  it("maps task shape to intent: decision:research → research, bug → operations, else implementation", () => {
    assert.equal(orchestration.intentFor({ labels: ["decision:research"] }), "research");
    assert.equal(orchestration.intentFor({ labels: ["decision:map", "decision:research"] }), "research");
    assert.equal(orchestration.intentFor({ type: "bug", labels: [] }), "operations");
    assert.equal(orchestration.intentFor({ type: "bug", labels: ["decision:research"] }), "research", "research wins — it is the more specific signal");
    assert.equal(orchestration.intentFor({ type: "task", labels: [] }), "implementation");
    assert.equal(orchestration.intentFor({}), "implementation");
  });

  it("refuses to launch when the backend is unavailable, before spawning anything", async () => {
    const res = await orchestration.spawn(req(), { caps: capsWith({ orchestration: { available: false, reason: "not found" } }) });
    assert.equal(res.ok, false);
    assert.match(res.reason, /not found/);
  });

  it("refuses a relative worktree — consumerCwd is absolute by contract", async () => {
    const res = await orchestration.spawn(req({ worktree: "relative/path" }), {
      caps: capsWith({ orchestration: { available: true, path: FAKE_SERVER } }),
    });
    assert.equal(res.ok, false);
    assert.match(res.reason, /absolute/);
  });
});

describe("orchestration backend — the MCP handshake, against a fake server", () => {
  it("sends initialize then tools/call orchestration_spawn with the dispatch request shape", async () => {
    const request = req();
    const { res, capture } = await spawnAgainstFake(request);

    assert.equal(res.ok, true);
    assert.equal(res.run, "orchestration:run-fake-1", "the run handle is the server's run id, namespaced");
    assert.equal(res.detail.runId, "run-fake-1");

    const params = JSON.parse(readFileSync(capture, "utf8"));
    assert.equal(params.name, "orchestration_spawn");
    const args = params.arguments;
    assert.equal(args.consumerCwd, request.worktree, "the tm worktree is the consumer root");
    assert.ok(isAbsolute(args.consumerCwd), "absolute by contract");
    assert.equal(args.task, request.prompt, "the handoff travels as DATA inside the JSON task field");
    assert.equal(args.permissionProfile, "write", "dispatch needs write; the tool default (read) would strand the worker");
    assert.equal(args.intent, "implementation");
    assert.equal(args.idempotencyKey, "TM-001-s-1", "a retried dispatch collapses onto the same run");
  });

  it("maps an isError envelope to a refusal, naming code and message", async () => {
    const { res } = await spawnAgainstFake(req(), { mode: "tool-error" });
    assert.equal(res.ok, false);
    assert.match(res.reason, /E_NO_PROVIDER/);
    assert.match(res.reason, /no provider endpoint is ready/);
  });

  it("maps a JSON-RPC error to a refusal", async () => {
    const { res } = await spawnAgainstFake(req(), { mode: "rpc-error" });
    assert.equal(res.ok, false);
    assert.match(res.reason, /-32602/);
    assert.match(res.reason, /invalid params/);
  });

  it("times out a server that never answers, and kills the child", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tm-orch-hang-"));
    trash.push(dir);
    const pidFile = join(dir, "pid");
    const { res } = await spawnAgainstFake(req(), { mode: "hang", timeoutMs: 300, env: { FAKE_PID_FILE: pidFile } });

    assert.equal(res.ok, false);
    assert.match(res.reason, /did not answer within 300ms/);
    const pid = Number(readFileSync(pidFile, "utf8"));
    assert.equal(await waitDead(pid), true, "the hung server was killed, not left behind");
  });

  it("caps the stdout buffer: an oversized frame is a failure, not a heap", async () => {
    const { res } = await spawnAgainstFake(req(), { maxBuffer: 512, env: { FAKE_PAD: "4096" } });
    assert.equal(res.ok, false);
    assert.match(res.reason, /exceeded 512 bytes/);
  });

  it("tolerates non-JSON noise on stderr", async () => {
    const { res } = await spawnAgainstFake(req(), { mode: "junk-stderr" });
    assert.equal(res.ok, true, "stderr is diagnostics by contract; only stdout is framed");
  });

  it("fails on a non-JSON line on stdout — the protocol is broken, the server is not who we think", async () => {
    const { res } = await spawnAgainstFake(req(), { mode: "bad-stdout" });
    assert.equal(res.ok, false);
    assert.match(res.reason, /non-JSON/);
  });
});

describe("orchestration backend — no shell, ever", () => {
  it("spawns process.execPath with argv-only, and the prompt appears in NO argv element", async () => {
    const spawned = [];
    // A minimal child lookalike: errors on the next tick so spawn settles.
    const fakeChild = () => {
      const child = new EventEmitter();
      child.stdin = Object.assign(new EventEmitter(), {
        writable: true,
        destroyed: false,
        write: () => true,
        end: () => {},
      });
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      queueMicrotask(() => child.emit("error", new Error("spawn stubbed")));
      return child;
    };

    const request = req();
    const res = await orchestration.spawn(request, {
      caps: capsWith({ orchestration: { available: true, path: "/plugins/agent-orchestration/bin/agent-orchestration-mcp" } }),
      spawnImpl: (bin, args, opts) => {
        spawned.push([bin, args, opts]);
        return fakeChild();
      },
    });

    assert.equal(res.ok, false, "the stubbed child errors; only the argv matters here");
    assert.equal(spawned.length, 1);
    const [bin, args, opts] = spawned[0];
    assert.equal(bin, process.execPath, "the server runs under the current node");
    assert.deepEqual(args, ["/plugins/agent-orchestration/bin/agent-orchestration-mcp"], "argv is exactly the server path");
    assert.equal(opts.shell, false, "never a shell");
    assert.ok(!args.some((a) => a.includes("Handoff")), "the prompt is not an argv element — it only ever travels inside the JSON on stdin");
    assert.ok(!args.some((a) => /&&|\|\||;\s*\S/.test(a)), "no shell composition anywhere");
  });
});

describe("topology backend", () => {
  /** ao-topology launch --json prints exactly this. */
  const launched = (over = {}) => ({
    status: 0,
    stdout: JSON.stringify({ runDir: "/repo/.bytedesk/worktrees/TM-001-fix-the-thing/.bytedesk/agent-orchestration/runs/20260905-120000-abcd", session: "tm-001-20260905-120000-abcd", state: "running", agents: [{ id: "worker", ready: true }], warnings: [] }),
    stderr: "",
    ...over,
  });

  /** Run spawn() with everything stubbed; returns what it wrote and what it ran. */
  function launch(request = req(), { caps = { topology: { available: true, path: "/plugins/agent-orchestration/bin/ao-topology" } }, result = launched(), rosterList = [], env = { PATH: "/usr/bin" } } = {}) {
    const written = [];
    const spawned = [];
    const res = topology.spawn(request, {
      caps: capsWith(caps),
      rosterList,
      writeImpl: (file, contents) => written.push([file, contents]),
      mkdtempImpl: (prefix) => `${prefix}XXXX`,
      spawnImpl: (bin, args, opts) => {
        spawned.push([bin, args, opts]);
        return result;
      },
      env,
    });
    return { res, written, spawned };
  }

  it("is available exactly when caps found ao-topology (which already needs tmux)", () => {
    assert.equal(topology.available(capsWith({ topology: { available: true, path: "/x" } })), true);
    assert.equal(topology.available(capsWith({ topology: { available: false, reason: "needs tmux, which is not on PATH" } })), false);
    assert.equal(topology.available(capsWith({ topology: { available: false, reason: "ao-topology not found (looked: …)" } })), false);
  });

  it("launches into tm's worktree as the consumer and creates no checkout of its own", () => {
    const request = req();
    const { res, spawned } = launch(request);

    assert.equal(res.ok, true);
    assert.equal(res.run, "topology:tm-001-20260905-120000-abcd", "the tmux session is the run handle");

    const [bin, args] = spawned[0];
    assert.equal(bin, "/plugins/agent-orchestration/bin/ao-topology");
    assert.equal(args[0], "launch");
    assert.equal(args[args.indexOf("--consumer") + 1], request.worktree, "the consumer IS tm's provisioned worktree");
    // ADR-0001's ownership rule: one worktree per task. Nothing here may ask for
    // another checkout, and nothing may point the run at the repo root instead.
    assert.equal(args.includes("--repo"), false, "no second checkout is requested");
    assert.equal(args.includes("--worktree"), false);
    assert.equal(args.includes(request.p.root), false, "the repo root is never the consumer");
  });

  it("the spec is one agent with no cwd of its own, so the consumer's default stands", () => {
    const { written } = launch();
    const spec = JSON.parse(written.find(([file]) => file.endsWith("spec.json"))[1]);

    assert.equal(spec.version, 1);
    assert.equal(spec.name, "tm-001");
    assert.equal(spec.agents.length, 1, "a dispatch is one worker");
    assert.equal(spec.agents[0].role, "orchestrator", "a solo worker conducts itself; the schema requires exactly one");
    assert.equal("cwd" in spec.agents[0], false, "no cwd — the spec default is {{consumer}}, which is tm's worktree");
    assert.equal("cwd" in spec, false);
    assert.equal("run_dir" in spec, false, "the run dir defaults under the consumer too");
  });

  it("the prompt never becomes an argv element — it travels in the spec file and the worktree copy", () => {
    const request = req();
    const { written, spawned } = launch(request);
    const [, args] = spawned[0];

    assert.ok(!args.some((a) => a.includes("Handoff")), "the prompt text is in no argv element");
    assert.ok(!args.some((a) => a.includes("rm -rf")), "nor any fragment of it");
    assert.ok(!args.some((a) => /&&|\|\||;\s*\S|\$\(/.test(a)), "no shell composition anywhere");
    assert.equal(spawned[0][2].shell, false, "never a shell");

    const spec = JSON.parse(written.find(([file]) => file.endsWith("spec.json"))[1]);
    assert.equal(spec.agents[0].instructions, request.prompt, "the handoff is DATA inside the spec file, verbatim");

    const [promptFile, contents] = written.find(([file]) => file.endsWith(".tm-dispatch-prompt.md"));
    assert.equal(promptFile, join(request.worktree, topology.PROMPT_FILE), "the durable copy sits in the worktree, same name as tmux uses");
    assert.equal(contents, request.prompt);
  });

  it("borrows an identity from the repo's agent library when it has one", () => {
    const roster = [
      { id: "ag-lead", role: "lead", full_name: "Ada Lead" },
      { id: "ag-worker", role: "implementer", full_name: "Bo Worker" },
    ];
    const { res, written } = launch(req(), { rosterList: roster });
    const spec = JSON.parse(written.find(([file]) => file.endsWith("spec.json"))[1]);

    assert.equal(spec.agents[0].agent, "ag-worker", "the lead is the repo's, not a dispatch worker's, identity");
    assert.equal(spec.agents[0].instructions, req().prompt, "the handoff is appended to the stored prompt, not instead of it");
    assert.equal("instructions_file" in spec.agents[0], false, "the stored agent's own system prompt must survive");
    assert.equal(res.detail.agent, "ag-worker");
  });

  it("falls back to an inline single-agent spec when the repo has no roster", () => {
    const { res, written } = launch(req(), { rosterList: [] });
    const spec = JSON.parse(written.find(([file]) => file.endsWith("spec.json"))[1]);

    assert.equal("agent" in spec.agents[0], false);
    assert.equal(spec.agents[0].candidates, "claude");
    assert.equal(res.detail.agent, null);
  });

  it("a roster of nothing but the lead still goes inline", () => {
    const { written } = launch(req(), { rosterList: [{ id: "ag-lead", role: "lead", full_name: "Ada Lead" }] });
    const spec = JSON.parse(written.find(([file]) => file.endsWith("spec.json"))[1]);
    assert.equal("agent" in spec.agents[0], false);
  });

  it("passes the dispatching session through, and omits identity vars that were never set", () => {
    const { spawned } = launch();
    assert.equal(spawned[0][2].env.TM_SESSION_ID, "s-1");
    assert.equal(spawned[0][2].env.TM_ACTOR, "@bot");
    assert.equal(spawned[0][2].env.TM_ROOT, "/repo");
    assert.equal(spawned[0][2].env.PATH, "/usr/bin", "the ambient environment passes through");

    const bare = launch(req({ session: null, actor: null }), { env: {} });
    assert.equal("TM_SESSION_ID" in bare.spawned[0][2].env, false);
    assert.equal("TM_ACTOR" in bare.spawned[0][2].env, false);
  });

  it("bounds the launch: an explicit timeout and a capped buffer", () => {
    const { spawned } = launch();
    assert.equal(spawned[0][2].timeout, topology.LAUNCH_TIMEOUT_MS);
    assert.equal(spawned[0][2].maxBuffer, topology.MAX_BUFFER_BYTES);
  });

  it("refuses a relative consumer before writing or spawning anything", () => {
    const spawned = [];
    const res = topology.spawn(req({ worktree: "relative/worktree" }), {
      caps: capsWith({ topology: { available: true, path: "/x" } }),
      writeImpl: () => assert.fail("nothing may be written for a refused launch"),
      spawnImpl: () => {
        spawned.push(1);
        return { status: 0 };
      },
    });
    assert.equal(res.ok, false);
    assert.match(res.reason, /absolute/);
    assert.equal(spawned.length, 0);
  });

  it("refuses before spawning when unavailable", () => {
    const spawned = [];
    const res = topology.spawn(req(), {
      caps: capsWith({ topology: { available: false, reason: "needs tmux, which is not on PATH" } }),
      spawnImpl: () => {
        spawned.push(1);
        return { status: 0 };
      },
    });
    assert.equal(res.ok, false);
    assert.match(res.reason, /tmux/);
    assert.equal(spawned.length, 0);
  });

  it("maps a nonzero exit to a refusal carrying ao-topology's stderr", () => {
    const { res } = launch(req(), { result: { status: 4, stdout: "", stderr: "TOPOLOGY_SPEC_INVALID: agents must be a non-empty array" } });
    assert.equal(res.ok, false);
    assert.match(res.reason, /exited 4/);
    assert.match(res.reason, /TOPOLOGY_SPEC_INVALID/);
  });

  it("maps a spawn error to a refusal", () => {
    const { res } = launch(req(), { result: { error: new Error("spawn /x ENOENT") } });
    assert.equal(res.ok, false);
    assert.match(res.reason, /ENOENT/);
  });

  it("a launch that printed no run JSON is a refusal, not a fake success", () => {
    const { res } = launch(req(), { result: { status: 0, stdout: "Launched tm-001 · run 20260905\n", stderr: "" } });
    assert.equal(res.ok, false);
    assert.match(res.reason, /no run JSON/);
  });
});

describe("resolveBackend with the real modules", () => {
  // No registry injection: loadBackend really imports ./topology.mjs and
  // ./orchestration.mjs, so these tests prove the modules exist, parse, and answer
  // available() from caps — the integration a stubbed registry cannot.
  const p = paths("/tmp/tm-resolve-backend-none");

  it("topology wins when its launcher is present, even against orchestration", async () => {
    const picked = await resolveBackend({
      caps: capsWith({
        topology: { available: true, path: "/x" },
        orchestration: { available: true, path: "/y" },
        tmux: { available: true },
      }),
      p,
    });
    assert.equal(picked.name, "topology", "ADR-0001 demotes orchestration below topology");
    assert.equal(picked.backend, topology);
  });

  it("raw tmux is the fallback beneath topology, ahead of orchestration", async () => {
    const picked = await resolveBackend({
      caps: capsWith({
        topology: { available: false, reason: "not found" },
        orchestration: { available: true, path: "/y" },
        tmux: { available: true },
      }),
      p,
    });
    assert.equal(picked.name, "tmux");
    assert.match(picked.tried[0].reason, /unavailable/);
  });

  it("falls through to orchestration, then manual, when no tmux exists", async () => {
    const noTmux = capsWith({
      topology: { available: false, reason: "needs tmux" },
      orchestration: { available: true, path: "/y" },
      tmux: { available: false, reason: "not on PATH" },
    });
    const picked = await resolveBackend({ caps: noTmux, p });
    assert.equal(picked.name, "orchestration");
    assert.equal(picked.backend, orchestration);

    const bare = capsWith({
      topology: { available: false, reason: "not found" },
      orchestration: { available: false, reason: "not found" },
      tmux: { available: false, reason: "not on PATH" },
    });
    assert.equal((await resolveBackend({ caps: bare, p })).name, "manual", "manual is the floor and never disappears");
  });
});
