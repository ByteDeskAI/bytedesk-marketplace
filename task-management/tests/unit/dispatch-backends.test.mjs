/**
 * The dispatch backends that land workers outside this process: orchestration
 * (an MCP stdio client of the sibling agent-orchestration plugin) and fleet
 * (an argv-only shell-out to spawn-claude-feature).
 *
 * Orchestration is tested against a REAL child process running a fake MCP server
 * (fixtures/fake-orchestration-mcp.mjs) — a stubbed spawn proves nothing about a
 * line-delimited JSON-RPC handshake. Fleet is tested with a stubbed spawnSync,
 * because its whole contract is the argv and env, and those are pure values.
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
import * as fleet from "../../lib/dispatch/fleet.mjs";

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

describe("fleet backend", () => {
  it("is available exactly when caps found spawn-claude-feature", () => {
    assert.equal(fleet.available(capsWith({ fleet: { available: true, path: "/x" } })), true);
    assert.equal(fleet.available(capsWith({ fleet: { available: false, reason: "needs tmux" } })), false);
  });

  it("builds an argv-only spawn: prompt by file, repo by flag, full-auto, env passthrough", () => {
    const written = [];
    const spawned = [];
    const request = req();
    const res = fleet.spawn(request, {
      caps: capsWith({ fleet: { available: true, path: "/plugins/fleet/bin/spawn-claude-feature" } }),
      writeImpl: (file, contents) => written.push([file, contents]),
      spawnImpl: (bin, args, opts) => {
        spawned.push([bin, args, opts]);
        return { status: 0 };
      },
      env: { PATH: "/usr/bin" },
    });

    assert.equal(res.ok, true);
    assert.equal(res.run, "fleet:TM-001", "the ticket is the run handle");

    assert.equal(written.length, 1);
    const [promptFile, contents] = written[0];
    assert.equal(contents, request.prompt, "the prompt travels as a file, verbatim");
    assert.ok(promptFile.includes("tm-fleet-TM-001"), "a per-spawn temp file");

    assert.equal(spawned.length, 1);
    const [bin, args, opts] = spawned[0];
    assert.equal(bin, "/plugins/fleet/bin/spawn-claude-feature");
    assert.deepEqual(
      args,
      ["TM-001", "fix-the-thing", "--prompt-file", promptFile, "--repo", "/repo", "--full-auto"],
      "exact argv: ticket, slug, prompt-by-file, repo, full-auto",
    );
    assert.equal(opts.shell, false, "never a shell");
    assert.ok(!args.some((a) => a.includes("Handoff")), "the prompt text is in no argv element");
    assert.ok(!args.some((a) => /&&|\|\||;\s*\S/.test(a)), "no shell composition anywhere");

    assert.equal(opts.env.TM_SESSION_ID, "s-1", "the dispatching session follows the worker");
    assert.equal(opts.env.TM_ACTOR, "@bot");
    assert.equal(opts.env.TM_ROOT, "/repo");
    assert.equal(opts.env.CLAUDE_SESSION_TICKET, "TM-001", "fleet's recursion guard needs the ticket to derive depth");
    assert.equal(opts.env.PATH, "/usr/bin", "the ambient environment passes through");
  });

  it("omits tm identity vars that were never set, but always sets the ticket", () => {
    const spawned = [];
    fleet.spawn(req({ session: null, actor: null }), {
      caps: capsWith({ fleet: { available: true, path: "/x" } }),
      writeImpl: () => {},
      spawnImpl: (bin, args, opts) => {
        spawned.push(opts);
        return { status: 0 };
      },
      env: {},
    });
    assert.equal(spawned[0].env.CLAUDE_SESSION_TICKET, "TM-001");
    assert.equal("TM_SESSION_ID" in spawned[0].env, false);
    assert.equal("TM_ACTOR" in spawned[0].env, false);
  });

  it("maps a nonzero exit to a refusal with fleet's stderr", () => {
    const res = fleet.spawn(req(), {
      caps: capsWith({ fleet: { available: true, path: "/x" } }),
      writeImpl: () => {},
      spawnImpl: () => ({ status: 66, stderr: "error: session 'TM-001' already exists" }),
    });
    assert.equal(res.ok, false);
    assert.match(res.reason, /exited 66/);
    assert.match(res.reason, /already exists/);
  });

  it("maps a spawn error to a refusal", () => {
    const res = fleet.spawn(req(), {
      caps: capsWith({ fleet: { available: true, path: "/x" } }),
      writeImpl: () => {},
      spawnImpl: () => ({ error: new Error("spawn /x ENOENT") }),
    });
    assert.equal(res.ok, false);
    assert.match(res.reason, /ENOENT/);
  });

  it("refuses before spawning when unavailable", () => {
    const spawned = [];
    const res = fleet.spawn(req(), {
      caps: capsWith({ fleet: { available: false, reason: "needs tmux, which is not on PATH" } }),
      spawnImpl: () => {
        spawned.push(1);
        return { status: 0 };
      },
    });
    assert.equal(res.ok, false);
    assert.match(res.reason, /tmux/);
    assert.equal(spawned.length, 0);
  });
});

describe("resolveBackend with the real modules", () => {
  // No registry injection: loadBackend really imports ./orchestration.mjs and
  // ./fleet.mjs, so these tests prove the modules exist, parse, and answer
  // available() from caps — the integration the previous wave stubbed out.
  const p = paths("/tmp/tm-resolve-backend-none");

  it("orchestration wins when its binary is present", async () => {
    const picked = await resolveBackend({
      caps: capsWith({
        orchestration: { available: true, path: "/x" },
        fleet: { available: true, path: "/y" },
        tmux: { available: true },
      }),
      p,
    });
    assert.equal(picked.name, "orchestration");
    assert.equal(picked.backend, orchestration);
  });

  it("fleet wins when orchestration is absent", async () => {
    const picked = await resolveBackend({
      caps: capsWith({
        orchestration: { available: false, reason: "not found" },
        fleet: { available: true, path: "/y" },
        tmux: { available: true },
      }),
      p,
    });
    assert.equal(picked.name, "fleet");
    assert.equal(picked.backend, fleet);
    assert.match(picked.tried[0].reason, /unavailable/);
  });

  it("falls through to tmux, then manual, when neither launcher exists", async () => {
    const neither = capsWith({
      orchestration: { available: false, reason: "not found" },
      fleet: { available: false, reason: "not found" },
      tmux: { available: true },
    });
    assert.equal((await resolveBackend({ caps: neither, p })).name, "tmux");

    const bare = capsWith({
      orchestration: { available: false, reason: "not found" },
      fleet: { available: false, reason: "not found" },
      tmux: { available: false, reason: "not on PATH" },
    });
    assert.equal((await resolveBackend({ caps: bare, p })).name, "manual", "manual is the floor and never disappears");
  });
});
