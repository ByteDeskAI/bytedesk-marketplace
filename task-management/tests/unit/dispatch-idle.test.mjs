/**
 * Idle dispatch (TM-135): handing a ready task to an agent that is ALREADY running.
 *
 * The whole point of the backend is that it does NOT start a worker, so nothing here spawns one.
 * `ao-topology` is a stubbed `spawnSync` throughout, because the backend's entire contract is the
 * argv it builds, the session it refuses without, and — on the collect side — the fact that the
 * completion signal is a mailbox REPLY and not a dead session.
 *
 * NOTHING IN THIS FILE TOUCHES TMUX. Not `has-session`, not a socket, not an env var. That is not
 * caution, it is the point: an idle dispatch's worker outlives its task, so a tmux liveness probe
 * is the one thing that must never appear on this path.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempRepo } from "./helpers.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, read, readEvents, seedGitContract, update, writeConfig } from "../../lib/store.mjs";
import { claimant } from "../../lib/claims.mjs";
import { dispatch } from "../../lib/dispatch/index.mjs";
import { DEFAULT_ORDER, backendOrder } from "../../lib/dispatch/backend.mjs";
import { collect, collectIdle } from "../../lib/dispatch/collect.mjs";
import * as idle from "../../lib/dispatch/idle.mjs";

const trash = [];
after(() => cleanup(...trash));

function repoStore() {
  const root = tempRepo();
  const p = paths(root);
  ensureDirs(p);
  seedGitContract(p);
  trash.push(root);
  return p;
}

const CAPS = { backends: { topology: { available: true, path: "/fake/ao-topology" } } };

/** A stubbed ao-topology that records its argv and answers each verb from a script. */
function fakeTopology(answers) {
  const calls = [];
  return {
    calls,
    spawnImpl(path, args, options) {
      calls.push({ path, args, options });
      const verb = args[1];
      const answer = answers[verb];
      if (typeof answer === "function") return answer(args);
      return answer ?? { status: 1, stdout: "", stderr: `no scripted answer for ${verb}` };
    },
  };
}

const ok = (payload) => ({ status: 0, stdout: JSON.stringify(payload), stderr: "" });

describe("idle backend — the assignment shell-out", () => {
  it("builds argv-only, omits --agent so arbitration picks, and never passes the prompt as a word", () => {
    const args = idle.argvFor({ task: { id: "TM-001" }, worktree: "/repo/wt" }, "/repo/wt/PROMPT.md");
    assert.deepEqual(args, ["manage", "assign", "--task", "TM-001", "--consumer", "/repo/wt", "--prompt-file", "/repo/wt/PROMPT.md"]);
    assert.ok(!args.some((a) => a.includes("$(") || a.includes("`")), "no argv element could ever be shell source");
    assert.deepEqual(idle.argvFor({ task: { id: "TM-001" }, worktree: "/repo/wt" }, "/p.md", "agent-7").slice(-2), ["--agent", "agent-7"]);
  });

  /**
   * CAP-0002. A null session writes an UNOWNED claim the stop gate cannot attribute, and every
   * session's Stop hook then nags about a task nobody holds. `dispatch()` synthesises one, so this
   * is unreachable from the normal path — which is exactly why it is worth asserting, because a
   * backend called directly is the path that would put the shape back.
   */
  it("refuses a dispatch with no session id, before it writes anything", () => {
    const wrote = [];
    const res = idle.spawn(
      { task: { id: "TM-001" }, worktree: "/repo/wt", prompt: "do it", session: null },
      { caps: CAPS, writeImpl: (...a) => wrote.push(a), spawnImpl: () => assert.fail("must not shell out without a session") },
    );
    assert.equal(res.ok, false);
    assert.match(res.reason, /session/i);
    assert.match(res.reason, /CAP-0002/);
    assert.equal(wrote.length, 0, "a refused dispatch writes no handoff file");
  });

  it("refuses a relative worktree, because --consumer would resolve against the wrong checkout", () => {
    const res = idle.spawn({ task: { id: "TM-001" }, worktree: "wt", prompt: "x", session: "s1" }, { caps: CAPS, spawnImpl: () => assert.fail("must not shell out") });
    assert.equal(res.ok, false);
    assert.match(res.reason, /absolute/);
  });

  it("returns an idle:<agentId> handle — a WHO, not a session to watch for death", () => {
    const topo = fakeTopology({ assign: ok({ assigned: true, agent_id: "agent-7", message_id: "m1" }) });
    const res = idle.spawn(
      { task: { id: "TM-001" }, worktree: "/repo/wt", prompt: "do it", session: "s1" },
      { caps: CAPS, writeImpl: () => {}, spawnImpl: topo.spawnImpl },
    );
    assert.equal(res.ok, true);
    assert.equal(res.run, "idle:agent-7");
    assert.equal(res.pid, undefined, "nothing was started, so there is no pid");
    assert.equal(topo.calls[0].options.shell, false);
  });
});

describe("pool preference — one predicate, not a second scheduler", () => {
  it("dispatch.preferIdle moves idle to the front and leaves the rest of the order alone", () => {
    const p = repoStore();
    assert.deepEqual(backendOrder(p), DEFAULT_ORDER, "idle is opt-in: it is not in the default order");
    writeConfig({ dispatch: { preferIdle: true } }, p);
    assert.deepEqual(backendOrder(p), ["idle", ...DEFAULT_ORDER]);
  });

  it("an explicit backends list still wins, with idle hoisted rather than appended", () => {
    const p = repoStore();
    writeConfig({ dispatch: { preferIdle: true, backends: ["tmux", "idle", "manual"] } }, p);
    assert.deepEqual(backendOrder(p), ["idle", "tmux", "manual"], "idle appears exactly once, at the front");
  });
});

describe("collectIdle — the completion signal is the reply, not a dead session", () => {
  /** A dispatched-to-idle task, provisioned for real so `task.worktree` is a real path. */
  async function dispatched(p, { title = "idle work" } = {}) {
    const t = create("task", { title }, "the body", p);
    const backend = { name: "idle", available: () => true, spawn: () => ({ ok: true, run: "idle:agent-7" }) };
    const res = await dispatch(t.id, { backend, session: "s-idle", actor: "@bot", p });
    assert.equal(res.ok, true, res.reason);
    return read(t.id, p);
  }

  /**
   * The REAL routing table, with no `impls` override — an override would answer the question with
   * its own answer. `collect` must not report "no collector for backend", whatever this host's
   * capabilities happen to be.
   */
  it("routes to collectIdle from the dispatched record", async () => {
    const p = repoStore();
    const t = await dispatched(p);
    const res = await collect(t.id, p);
    assert.ok(!/no collector for backend/.test(res.reason ?? ""), `idle must be in the routing table, got: ${res.reason ?? "(ok)"}`);
  });

  it("an unanswered assignment is pending — it does NOT ask tmux whether the session is alive", async () => {
    const p = repoStore();
    const t = await dispatched(p);
    const topo = fakeTopology({ assignment: ok({ assigned: true, pending: true, agent_id: "agent-7" }) });
    const res = collectIdle(t.id, { caps: CAPS, p, spawnImpl: topo.spawnImpl });
    assert.deepEqual(res, { ok: true, pending: true, agent: "agent-7" });
    assert.equal(topo.calls.length, 1, "one read, no release");
    assert.deepEqual(topo.calls[0].args.slice(0, 2), ["manage", "assignment"]);
    assert.equal(read(t.id, p).status, "in_progress", "a standing agent that has not answered is still working");
  });

  /**
   * The downgrade rule, byte-identical because it is `recordResult` doing it. "done" is a claim
   * about the store and the store gets the last word.
   */
  it("a DONE reply for a task the store does not show done is recorded as a failure that says so", async () => {
    const p = repoStore();
    const t = await dispatched(p);
    const topo = fakeTopology({
      assignment: ok({ assigned: true, pending: false, agent_id: "agent-7", outcome: "done", summary: "DONE shipped it" }),
      release: ok({ released: true }),
    });
    const res = collectIdle(t.id, { caps: CAPS, p, spawnImpl: topo.spawnImpl });
    assert.equal(res.ok, true);
    assert.equal(res.outcome, "failed");
    assert.equal(res.downgraded, true);
    assert.equal(read(t.id, p).status, "parked", "park-never-strand: it must not stay in_progress");
    assert.match(read(t.id, p).parkedReason, /worker reported done but task is in_progress/);
    assert.equal(claimant(t.id, p), null, "parking released the claim");
    const evt = readEvents(p).find((e) => e.event === "task_result" && e.id === t.id);
    assert.equal(evt.outcome, "failed");
    assert.equal(evt.run, "idle:agent-7");
  });

  it("a terminal result releases the assignment, so the standing agent is free again", async () => {
    const p = repoStore();
    const t = await dispatched(p);
    const topo = fakeTopology({
      assignment: ok({ assigned: true, pending: false, agent_id: "agent-7", outcome: "blocked", summary: "BLOCKED needs a key" }),
      release: ok({ released: true, agent_id: "agent-7" }),
    });
    const res = collectIdle(t.id, { caps: CAPS, p, spawnImpl: topo.spawnImpl });
    assert.equal(res.released, true);
    const release = topo.calls.find((c) => c.args[1] === "release");
    assert.ok(release, "the assignment is released");
    assert.deepEqual(release.args.slice(0, 4), ["manage", "release", "--task", t.id]);
    assert.equal(read(t.id, p).status, "parked");
  });

  /**
   * The agent's freedom is not conditional on the store's bookkeeping. A reply that arrived means
   * this agent is done with this task, and leaving it bound because a comment could not be written
   * would cost the repository a standing worker permanently.
   */
  it("releases even when recordResult refuses the outcome", async () => {
    const p = repoStore();
    const t = await dispatched(p);
    update(t.id, { status: "done" }, p);
    const topo = fakeTopology({
      assignment: ok({ assigned: true, pending: false, agent_id: "agent-7", outcome: "done", summary: "DONE" }),
      release: ok({ released: true }),
    });
    const before = topo.calls.length;
    collectIdle(t.id, { caps: CAPS, p, spawnImpl: topo.spawnImpl });
    assert.ok(topo.calls.slice(before).some((c) => c.args[1] === "release"), "the agent is freed regardless");
  });

  it("a released or absent assignment is a skip, not an error", async () => {
    const p = repoStore();
    const t = await dispatched(p);
    const topo = fakeTopology({ assignment: ok({ assigned: false, reason: "TM-001 has no idle-dispatch assignment." }) });
    const res = collectIdle(t.id, { caps: CAPS, p, spawnImpl: topo.spawnImpl });
    assert.equal(res.ok, true);
    assert.equal(res.pending, false);
    assert.match(res.skipped, /no idle-dispatch assignment/);
  });

  it("unparseable topology output is a refusal that quotes what came back, never a silent pass", async () => {
    const p = repoStore();
    const t = await dispatched(p);
    const topo = fakeTopology({ assignment: { status: 0, stdout: "not json at all", stderr: "" } });
    const res = collectIdle(t.id, { caps: CAPS, p, spawnImpl: topo.spawnImpl });
    assert.equal(res.ok, false);
    assert.match(res.reason, /not json at all/);
  });

  it("never throws: a spawn that fails outright comes back as { ok:false }", async () => {
    const p = repoStore();
    const t = await dispatched(p);
    const res = collectIdle(t.id, { caps: CAPS, p, spawnImpl: () => ({ error: new Error("ENOENT") }) });
    assert.equal(res.ok, false);
    assert.match(res.reason, /ENOENT/);
  });
});
