// TM-135 — assignment arbitration: who owns this task, and can that agent take it?
//
// THE ONE INVARIANT THIS FILE EXISTS FOR: the idle check and the assignment write happen inside the
// SAME critical section. The census is a hint; the record under `assignment.lock` is the authority.
// Check idle in the scheduler and write the binding here and two ticks both see the same agent
// idle, both provision a worktree, and one pane silently interleaves two tasks — so the first test
// races two assignments for two DIFFERENT tasks at the same agent and requires exactly one winner.
//
// No tmux server: `listPanes`, the census, the mailbox and the task store are all injected seams.
// Real git, because `ownedTask` verifies the worktree and its branch and a mock proves nothing.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assignTaskToAgent, assignmentResult, parseAssignmentReply, releaseAssignment } from "../../topology/lib/management.mjs";
import { run } from "../../topology/lib/util.mjs";

const SERVER = "/tmp/ao-idle-test/socket";
const bindingOf = (n) => ({ serverKey: SERVER, serverPid: 99, sessionId: `$${n}`, sessionCreated: 1_700_000_000 + n, paneId: `%${n}`, panePid: 1000 + n });
const paneOf = (n, over = {}) => ({ ...bindingOf(n), sessionName: `s${n}`, alive: true, ...over });

/** A census row the way `takeCensus` writes one. */
const agentRow = (agentId, n, over = {}) => ({ agentId, state: "idle", dispatchable: true, binding: bindingOf(n), sessionName: `s${n}`, ...over });

async function fixture(t, taskIds = ["TM-1"]) {
  const root = await mkdtemp(join(tmpdir(), "ao-idle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, "repo");
  await mkdir(consumer);
  const git = (cwd, args) => run("git", ["-C", cwd, ...args]);
  await run("git", ["init", "-q", "-b", "main", consumer]);
  await writeFile(join(consumer, "code.txt"), "base");
  await git(consumer, ["add", "code.txt"]);
  await git(consumer, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "base"]);

  const docs = new Map();
  for (const id of taskIds) {
    const worktree = join(root, id.toLowerCase());
    await git(consumer, ["worktree", "add", "-q", "-b", `tm/${id}`, worktree]);
    docs.set(id, { id, status: "in_progress", worktree, branch: `tm/${id}` });
  }
  const comments = [];
  const store = {
    root: consumer,
    show: async (id) => ({ ...docs.get(id) }),
    claim: async () => ({ session: "author" }),
    comment: async (task, value) => comments.push({ task, ...JSON.parse(value) }),
  };
  const delivered = [];
  const panes = new Map([[1, paneOf(1)], [2, paneOf(2)]]);
  const census = { agents: [agentRow("agent-1", 1)], stale: false };
  const base = {
    consumer,
    home: join(root, "home"),
    env: { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") },
    store,
    owner: "author",
    census: async () => census,
    listPanes: async () => [...panes.values()],
    deliver: async (input) => {
      delivered.push(input);
      return { status: "delivered", envelope: input };
    },
  };
  return { root, consumer, base, census, panes, delivered, comments, docs };
}

test("the idle check and the write are one critical section: two tasks cannot get the same agent", async (t) => {
  const fx = await fixture(t, ["TM-1", "TM-2"]);
  // Both calls see the SAME census document, which says agent-1 is idle. That is exactly the race:
  // a census is a hint, and two ticks a second apart read the same hint.
  const [first, second] = await Promise.allSettled([
    assignTaskToAgent({ ...fx.base, task: "TM-1" }),
    assignTaskToAgent({ ...fx.base, task: "TM-2" }),
  ]);
  const winners = [first, second].filter((r) => r.status === "fulfilled");
  const losers = [first, second].filter((r) => r.status === "rejected");
  assert.equal(winners.length, 1, "exactly one task may hold agent-1");
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason.code, "TOPOLOGY_MANAGEMENT_NO_IDLE_AGENT");
  assert.equal(winners[0].value.agent_id, "agent-1");
  assert.equal(fx.delivered.length, 1, "the loser delivered no pointer at all");
});

test("a stale census is no news, not old news: nothing is dispatchable from one", async (t) => {
  const fx = await fixture(t);
  await assert.rejects(
    assignTaskToAgent({ ...fx.base, task: "TM-1", census: async () => ({ agents: [agentRow("agent-1", 1)], stale: true }) }),
    { code: "TOPOLOGY_MANAGEMENT_CENSUS" },
  );
  await assert.rejects(assignTaskToAgent({ ...fx.base, task: "TM-1", census: async () => null }), { code: "TOPOLOGY_MANAGEMENT_CENSUS" });
  assert.equal(fx.delivered.length, 0);
});

/**
 * The census's freshness bound is 45 s off the supervisor's slowest rung, and a pane can exit
 * inside that. The six-tuple is therefore re-proved under the SAME lock as the write, exactly as
 * `observeWorker` proves a dispatched worker's.
 */
test("an agent the census calls idle but whose pane incarnation is gone is refused", async (t) => {
  const fx = await fixture(t);
  fx.panes.delete(1);
  await assert.rejects(assignTaskToAgent({ ...fx.base, task: "TM-1" }), { code: "TOPOLOGY_MANAGEMENT_AGENT_GONE" });

  // A pane id that is back but on a new incarnation is a stranger, not the same agent.
  fx.panes.set(1, paneOf(1, { panePid: 9999 }));
  await assert.rejects(assignTaskToAgent({ ...fx.base, task: "TM-1" }), { code: "TOPOLOGY_MANAGEMENT_AGENT_GONE" });
  assert.equal(fx.delivered.length, 0);
});

test("an assignment that is already live refuses a second one for the same task", async (t) => {
  const fx = await fixture(t);
  await assignTaskToAgent({ ...fx.base, task: "TM-1" });
  fx.census.agents.push(agentRow("agent-2", 2));
  await assert.rejects(assignTaskToAgent({ ...fx.base, task: "TM-1" }), { code: "TOPOLOGY_MANAGEMENT_ASSIGNED" });
});

/**
 * The envelope id is derived so a RETRIED assign delivers nothing twice. Without the round in it,
 * the id is a pure function of (repo, task, agent): reassigning the same task to the same agent
 * would recompute the id, the standing mailbox would dedupe to the already-delivered envelope, and
 * `assignmentResult` would read the PREVIOUS round's reply as this round's completion signal — the
 * task would collect instantly with a stale outcome and the second attempt would never be seen.
 */
test("reassigning the same task to the same agent mints a NEW envelope, not the last round's", async (t) => {
  const fx = await fixture(t);
  const first = await assignTaskToAgent({ ...fx.base, task: "TM-1" });
  await releaseAssignment({ ...fx.base, task: "TM-1", reason: "collected: failed" });
  const second = await assignTaskToAgent({ ...fx.base, task: "TM-1" });
  assert.equal(second.agent_id, "agent-1", "a released agent is free again");
  assert.notEqual(second.message_id, first.message_id, "a second round must not reuse the first round's reply");
  assert.equal(fx.delivered.length, 2);
});

test("the pointer carries the dispatching session id, so the agent's tm shares the claim (CAP-0002)", async (t) => {
  const fx = await fixture(t);
  const result = await assignTaskToAgent({ ...fx.base, task: "TM-1" });
  const body = fx.delivered[0].body;
  assert.match(body, /export TM_SESSION_ID=author/, "the claim is held by the dispatching session, not by a fresh id");
  assert.match(body, new RegExp(`cd ${result.worktree}`), "one task, one checkout, provisioned by tm");
  assert.match(body, /REPLY TO THIS MESSAGE/, "the completion signal is the reply, not this session exiting");
  assert.match(body, /your session\s*\n?is not expected to exit/i);
  assert.equal(fx.delivered[0].assignment, true);
});

test("assignment requires an owning session: an unowned claim cannot be handed to anyone", async (t) => {
  const fx = await fixture(t);
  await assert.rejects(assignTaskToAgent({ ...fx.base, task: "TM-1", owner: null }), { code: "TOPOLOGY_MANAGEMENT_ASSIGN" });
  await assert.rejects(assignTaskToAgent({ ...fx.base, task: "TM-1", owner: "  " }), { code: "TOPOLOGY_MANAGEMENT_ASSIGN" });
  assert.equal(fx.delivered.length, 0);
});

test("the result is the reply: pending until one arrives, and the first word is the outcome", async (t) => {
  const fx = await fixture(t);
  const assigned = await assignTaskToAgent({ ...fx.base, task: "TM-1" });

  const pending = await assignmentResult({ ...fx.base, task: "TM-1", store: { root: null }, readMessage: async () => ({ status: "delivered" }) });
  assert.deepEqual([pending.assigned, pending.pending], [true, true], "a standing session that has not answered is still working");

  const answered = await assignmentResult({
    ...fx.base, task: "TM-1", store: { root: null },
    readMessage: async ({ id }) => {
      assert.equal(id, assigned.message_id);
      return { status: "delivered", reply: { body: "BLOCKED the API key is missing", created_at: "2026-09-09T00:00:00Z" } };
    },
  });
  assert.equal(answered.pending, false);
  assert.equal(answered.outcome, "blocked");
  assert.match(answered.summary, /API key/);
});

test("an unrecognised reply is an honest failure, never a silent success", () => {
  assert.equal(parseAssignmentReply("DONE shipped").outcome, "done");
  assert.equal(parseAssignmentReply("done shipped").outcome, "done", "case does not decide an outcome");
  assert.equal(parseAssignmentReply("FAILED could not build").outcome, "failed");
  assert.equal(parseAssignmentReply("I think it went fine?").outcome, "failed");
  assert.equal(parseAssignmentReply("").outcome, "failed");
  assert.equal(parseAssignmentReply(null).outcome, "failed");
});

test("release is idempotent and keeps the record, because an assignment that happened is history", async (t) => {
  const fx = await fixture(t);
  await assignTaskToAgent({ ...fx.base, task: "TM-1" });
  const first = await releaseAssignment({ ...fx.base, task: "TM-1", reason: "collected: done" });
  assert.equal(first.released, true);
  const again = await releaseAssignment({ ...fx.base, task: "TM-1" });
  assert.deepEqual([again.released, again.already], [false, true]);
  const none = await releaseAssignment({ ...fx.base, task: "TM-2", store: { root: null } });
  assert.equal(none.released, false);
});
