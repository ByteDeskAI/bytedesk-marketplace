// End-to-end collaboration: two projects, each with its own lead and members.
// Internal — a member of a project is reachable directly by its own project's agents.
// External — an agent from the other project reaches the LEAD, never a member, unless the lead has
// already delegated the task they are coordinating on AND the receiving repo's own task-management
// store still backs that delegation.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";

import { agentsRoot, createAgent } from "../../topology/lib/agents.mjs";
import {
  MAX_HOPS,
  delegationsRoot,
  issueDelegation,
  routeMessage,
  taskStoreRoot,
  verifyAgainstStore,
} from "../../topology/lib/routing.mjs";
import {
  leadQueueDepth,
  pendingReplies,
  queueDepth,
  readJournal,
  recordReply,
  sendMessage,
  waitForReplies,
} from "../../topology/lib/mailbox.mjs";
import { readJson, writeJson } from "../../topology/lib/util.mjs";

/**
 * A minimal but real task-management store for a project: one task file with JSON frontmatter and
 * one claim in state.json, exactly the shape `tm` writes. Delegation validation reads this off
 * disk, so the fixture has to be the real layout rather than a stub.
 */
async function seedTask(dir, id, { status = "in_progress", holder = null, assignee = null } = {}) {
  const root = taskStoreRoot(dir);
  await mkdir(join(root, "tasks"), { recursive: true });
  const fields = {
    id,
    kind: "task",
    status,
    title: `work item ${id}`,
    ...(assignee ? { assignee } : {}),
  };
  const front = Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
  await writeFile(join(root, "tasks", `${id}-work-item.md`), `---\n${front}\n---\n\nBody.\n`, "utf8");
  const claims = holder ? { [id]: { session: "s1", actor: holder, worktree: dir, branch: "main", ts: new Date().toISOString() } } : {};
  await writeJson(join(root, "state.json"), { claims });
  return join(root, "tasks", `${id}-work-item.md`);
}

async function project(name) {
  const dir = await mkdtemp(join(tmpdir(), `ao-${name}-`));
  const lead = await createAgent(dir, { role: "lead" });
  const member = await createAgent(dir, { role: "reviewer", reports_to: lead.id });
  return { dir, lead, member, dirs: [agentsRoot(dir)] };
}

/** A run whose agents are the real named agents, so routing and the mailbox share identities. */
async function runFor(p, { flagCoordinator = false } = {}) {
  const runDir = join(p.dir, ".bytedesk", "agent-orchestration", "runs", "demo");
  for (const a of [p.lead, p.member]) {
    await mkdir(join(runDir, "agents", a.id, "inbox"), { recursive: true });
    await mkdir(join(runDir, "agents", a.id, "outbox"), { recursive: true });
  }
  await writeJson(join(runDir, "run.json"), {
    run_id: "demo",
    // launchRun records the repo the run belongs to; the lead is resolved from that repo's library.
    consumer: p.dir,
    sequence: 0,
    agents: [
      // A live run really does record its lead as `orchestrator` — that is the spec's role, and no
      // `lead` role pack exists. Encoding the true shape here is what keeps leadQueueDepth honest.
      { id: p.lead.id, role: "orchestrator", token: `tok-${p.lead.id}`, ...(flagCoordinator ? { coordinates_only: true } : {}) },
      { id: p.member.id, role: "reviewer", token: `tok-${p.member.id}` },
    ],
  });
  return runDir;
}

test("internal collaboration: a project's own agents reach each other directly", async () => {
  const p = await project("internal");
  try {
    const runDir = await runFor(p);
    const route = (args) => routeMessage({ consumer: p.dir, ...args });

    const msg = await sendMessage({
      runDir, from: p.lead.id, to: [p.member.id], stage: "review",
      body: "Please review the parser change.", route, fromProject: p.dir,
    });

    assert.equal(msg.redirects.length, 0, "same-project contact must not be redirected");
    assert.equal(msg.deliveries[0].agent, p.member.id, "it lands on the member it was addressed to");

    await recordReply({ runDir, agentId: p.member.id, messageId: msg.id, body: "Reviewed. Two notes.", token: `tok-${p.member.id}` });
    const wait = await waitForReplies({ runDir, agentIds: [p.member.id], messageId: msg.id, timeoutMs: 2000, pollMs: 20 });
    assert.equal(wait.ok, true, "the member's reply satisfies the barrier");
    assert.match(wait.replies[0].body, /Reviewed/);
  } finally {
    await rm(p.dir, { recursive: true, force: true });
  }
});

test("external collaboration: an outsider reaches the lead, not the member", async () => {
  const a = await project("ext-a");
  const b = await project("ext-b");
  try {
    const runDir = await runFor(b);
    const route = (args) => routeMessage({ consumer: b.dir, ...args });

    // An agent in project A addresses a MEMBER of project B directly.
    const msg = await sendMessage({
      runDir, from: a.member.id, to: [b.member.id], stage: "ask",
      body: "Can you look at our schema?", route, fromProject: a.dir,
    });

    assert.equal(msg.redirects.length, 1, "the sender is told the message moved");
    assert.equal(msg.deliveries[0].agent, b.lead.id, "it was delivered to project B's lead");
    assert.equal(msg.deliveries[0].requested, b.member.id, "the intended recipient is preserved");
    assert.deepEqual(msg.deliveries[0].via, [b.lead.id], "the hop that actually handled it is recorded in the chain");

    const journal = await readJournal(runDir);
    const redirect = journal.find((e) => e.type === "route.redirect");
    assert.ok(redirect, "a redirect must be journalled — it is not an error but it must be visible");
    assert.equal(redirect.intended, b.member.id);
    assert.equal(redirect.delivered_to, b.lead.id);
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test("an unresolvable recipient fails closed: an outsider naming a stranger still reaches the lead", async () => {
  const a = await project("unknown-a");
  const b = await project("unknown-b");
  try {
    const runDir = await runFor(b);
    const route = (args) => routeMessage({ consumer: b.dir, ...args });

    // The run's pane list is not the agent library. A spec written with inline ids puts panes in the
    // run that were never library agents, so passing an unresolvable ref through left sendMessage's
    // roster check as the only gate — and it would happily deliver to a non-lead pane.
    const run = await readJson(join(runDir, "run.json"));
    run.agents.push({ id: "inline-pane", role: "worker", token: "tok-inline-pane" });
    await writeJson(join(runDir, "run.json"), run);

    const msg = await sendMessage({
      runDir, from: a.member.id, to: ["inline-pane"], stage: "ask",
      body: "Straight to a pane that is not in the roster.", route, fromProject: a.dir,
    });
    assert.equal(msg.deliveries[0].agent, b.lead.id, "a name this repo's library does not know goes to the front door");
    assert.equal(msg.deliveries[0].requested, "inline-pane", "the unresolvable ref is preserved so the lead knows what was meant");
    assert.equal(msg.redirects.length, 1);
    assert.match(msg.redirects[0].reason, /not in this repo's agent library/);
    const envelope = await readFile(msg.deliveries[0].inbox, "utf8");
    assert.match(envelope, /intended_for: inline-pane/);

    // Inside the repo an unknown name is not a routing question: it is a typo, and sendMessage's own
    // roster check is the right place to say so.
    await assert.rejects(
      () => sendMessage({ runDir, from: b.lead.id, to: ["ghost"], stage: "ask", body: "Hello?", route, fromProject: b.dir }),
      (e) => e.code === "TOPOLOGY_UNKNOWN_AGENT",
      "a same-project typo must still be reported as a typo, not silently sent to the lead",
    );
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test("a project reached by another path shape is the same project, not an outsider", async () => {
  const p = await project("samepath");
  const link = join(await mkdtemp(join(tmpdir(), "ao-link-")), "alias");
  try {
    const runDir = await runFor(p);
    await symlink(p.dir, link, "dir");
    const route = (args) => routeMessage({ consumer: p.dir, ...args });

    // A trailing slash, and a symlinked path to the same tree, are the same repo. Comparing raw
    // strings invents an external contact between an agent and its own teammates.
    for (const [label, fromProject] of [["trailing slash", `${p.dir}/`], ["symlink", link], ["dot segment", join(p.dir, ".")]]) {
      const msg = await sendMessage({
        runDir, from: p.lead.id, to: [p.member.id], stage: "review", body: `Reached via the ${label}.`, route, fromProject,
      });
      assert.equal(msg.redirects.length, 0, `${label} must not read as another project`);
      assert.equal(msg.deliveries[0].agent, p.member.id);
    }
  } finally {
    await rm(p.dir, { recursive: true, force: true });
    await rm(link, { recursive: true, force: true });
  }
});

test("a barrier on the original addressee is satisfied by the lead's answer, and returns it", async () => {
  const a = await project("barrier-a");
  const b = await project("barrier-b");
  try {
    const runDir = await runFor(b);
    const route = (args) => routeMessage({ consumer: b.dir, ...args });
    const msg = await sendMessage({
      runDir, from: a.member.id, to: [b.member.id], stage: "ask",
      body: "Question for your reviewer.", route, fromProject: a.dir,
    });
    assert.equal(msg.deliveries[0].agent, b.lead.id);

    // Still pending, and the wait names the box the answer will actually appear in.
    const before = await pendingReplies(runDir, [b.member.id]);
    assert.equal(before.length, 1);
    assert.equal(before[0].answered_by, b.lead.id);
    assert.match(before[0].outbox, new RegExp(`${b.lead.id}/outbox`));

    // Guard against the barrier being satisfied by nothing. A redirected message never reaches the
    // addressee's inbox, so listing inbox files alone found no obligation and released the wait
    // instantly — success reported before anyone had read the question.
    const premature = await waitForReplies({ runDir, agentIds: [b.member.id], messageId: msg.id, timeoutMs: 120, pollMs: 20 });
    assert.equal(premature.ok, false, "the wait must not release before the message is actually answered");

    await recordReply({ runDir, agentId: b.lead.id, messageId: msg.id, body: "I'll route this internally.", token: `tok-${b.lead.id}` });

    const wait = await waitForReplies({ runDir, agentIds: [b.member.id], messageId: msg.id, timeoutMs: 2000, pollMs: 20 });
    assert.equal(wait.ok, true, "a redirected message answered by the lead must not time the sender out");
    // The barrier releasing is only half of it: the caller has to be handed the answer. Reading only
    // the addressee's own outbox reports success and prints nothing.
    assert.equal(wait.replies.length, 1, "the lead's reply must come back to the waiter");
    assert.equal(wait.replies[0].agent, b.lead.id);
    assert.equal(wait.replies[0].on_behalf_of, b.member.id);
    assert.match(wait.replies[0].body, /route this internally/);
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test("a delegation opens the direct channel, scoped to task and to the named outsider", async () => {
  const a = await project("del-a");
  const b = await project("del-b");
  try {
    const runDir = await runFor(b);
    const route = (args) => routeMessage({ consumer: b.dir, ...args });

    // The receiving repo's own store is what backs the token: TM-42 exists here and is claimed by
    // the member the lead is delegating to.
    await seedTask(b.dir, "TM-42", { holder: b.member.id });
    await issueDelegation(b.dir, { task: "TM-42", external_agent: a.member.id, local_agent: b.member.id, issued_by: b.lead.id });

    const direct = await sendMessage({
      runDir, from: a.member.id, to: [b.member.id], stage: "coord",
      body: "Following up on TM-42.", route, fromProject: a.dir, task: "TM-42",
    });
    assert.equal(direct.redirects.length, 0, "the delegated task may be coordinated on directly");
    assert.equal(direct.deliveries[0].agent, b.member.id);

    const otherTask = await sendMessage({
      runDir, from: a.member.id, to: [b.member.id], stage: "coord",
      body: "Unrelated question.", route, fromProject: a.dir, task: "TM-999",
    });
    assert.equal(otherTask.redirects.length, 1, "the exception does not generalise to other tasks");

    const otherAgent = await sendMessage({
      runDir, from: "stranger", to: [b.member.id], stage: "coord",
      body: "Hello.", route, fromProject: a.dir, task: "TM-42",
    });
    assert.equal(otherAgent.redirects.length, 1, "the exception does not generalise to other agents");
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test("the receiving repo's task store gets the last word on a delegation token", async () => {
  const a = await project("store-a");
  const b = await project("store-b");
  try {
    const runDir = await runFor(b);
    const route = (args) => routeMessage({ consumer: b.dir, ...args });

    // A token cannot even be minted for a task this repo has never heard of.
    await assert.rejects(
      () => issueDelegation(b.dir, { task: "TM-404", external_agent: a.member.id, local_agent: b.member.id }),
      (e) => e.code === "TOPOLOGY_DELEGATION_UNBACKED" && /not in this repo's task-management store/.test(e.message),
      "a delegation must reference a real claim in the receiving repo's own store",
    );

    // Nor may work be delegated to somebody whose job is to coordinate rather than implement.
    await seedTask(b.dir, "TM-7", { holder: b.lead.id });
    await assert.rejects(
      () => issueDelegation(b.dir, { task: "TM-7", local_agent: b.lead.id, agent: b.lead }),
      (e) => e.code === "TOPOLOGY_COORDINATOR_NOT_A_WORKER",
    );

    // A token written straight into the ledger — the shape a forged or stale record would take —
    // authorises nothing, because the store does not have the task.
    await mkdir(delegationsRoot(b.dir), { recursive: true });
    await writeJson(join(delegationsRoot(b.dir), "deadbeefdeadbeef.json"), {
      token: "deadbeefdeadbeef",
      task: "TM-404",
      external_agent: a.member.id,
      local_agent: b.member.id,
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const forged = await sendMessage({
      runDir, from: a.member.id, to: [b.member.id], stage: "coord",
      body: "Presenting a token.", route, fromProject: a.dir, task: "TM-404",
    });
    assert.equal(forged.redirects.length, 1, "an unbacked token must not open the direct channel");
    assert.match(forged.redirects[0].reason, /the store does not back it/);

    // And a token that WAS good stops being good the moment the store moves on.
    await seedTask(b.dir, "TM-8", { holder: b.member.id });
    const good = await issueDelegation(b.dir, { task: "TM-8", external_agent: a.member.id, local_agent: b.member.id });
    const open = await routeMessage({ consumer: b.dir, from: a.member.id, fromProject: a.dir, to: b.member.id, task: "TM-8" });
    assert.equal(open.redirected, false, "while the claim holds, the channel is open");
    assert.equal(open.delegation, good.token);

    await seedTask(b.dir, "TM-8", { status: "done", holder: b.member.id });
    const closed = await routeMessage({ consumer: b.dir, from: a.member.id, fromProject: a.dir, to: b.member.id, task: "TM-8" });
    assert.equal(closed.redirected, true, "a finished task revokes the exception without anyone revoking the token");
    assert.match(closed.reason, /TM-8 is done/);

    // Re-holding it for somebody else is equally decisive.
    await seedTask(b.dir, "TM-8", { holder: "somebody-else" });
    const stolen = await verifyAgainstStore(b.dir, { task: "TM-8", local_agent: b.member.id });
    assert.equal(stolen.ok, false);
    assert.match(stolen.reason, /held by somebody-else/);
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test("the via chain is appended to per hop and enforced on the send path", async () => {
  const a = await project("hop-a");
  const b = await project("hop-b");
  try {
    const runDir = await runFor(b);
    const route = (args) => routeMessage({ consumer: b.dir, ...args });

    // Lead-to-lead ping-pong: this message already passed through B's lead, so B refuses to be
    // handed it again rather than forwarding it in a circle.
    await assert.rejects(
      () => sendMessage({
        runDir, from: a.lead.id, to: [b.member.id], stage: "ask", body: "Round two.",
        route, fromProject: a.dir, via: [b.lead.id],
      }),
      (e) => e.code === "TOPOLOGY_ROUTE_LOOP",
      "a message must not be forwarded back through an agent that already handled it",
    );

    // The hop limit is enforced at the mailbox, so a hand-forwarded message trips it too — no
    // router required.
    const long = Array.from({ length: MAX_HOPS }, (_, i) => `hop${i}`);
    await assert.rejects(
      () => sendMessage({ runDir, from: a.member.id, to: [b.lead.id], stage: "ask", body: "Still going.", via: long }),
      (e) => e.code === "TOPOLOGY_HOP_LIMIT" && new RegExp(`limit is ${MAX_HOPS}`).test(e.message),
    );

    // One hop below the limit still goes through, and the chain comes back one longer than it went
    // in — a chain that never grows would never trip either guard.
    const short = ["hop0", "hop1"];
    const msg = await sendMessage({
      runDir, from: a.member.id, to: [b.member.id], stage: "ask", body: "One more hop.",
      route, fromProject: a.dir, via: short,
    });
    assert.deepEqual(msg.deliveries[0].via, [...short, b.lead.id]);
    assert.deepEqual(short, ["hop0", "hop1"], "the caller's chain is not mutated");
    const inbox = await import("node:fs/promises").then((fs) => fs.readFile(msg.deliveries[0].inbox, "utf8"));
    assert.match(inbox, /via: hop0, hop1, /, "the envelope carries the chain the message actually travelled");
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test("coordinates_only is a capability: the mailbox refuses to assign a coordinator work", async () => {
  const a = await project("coord-a");
  const b = await project("coord-b");
  try {
    const runDir = await runFor(b);
    const route = (args) => routeMessage({ consumer: b.dir, ...args });

    // Addressed straight at the lead — allowed to ask, refused to assign.
    const asked = await sendMessage({
      runDir, from: a.member.id, to: [b.lead.id], stage: "ask", body: "Who owns the parser?",
      route, fromProject: a.dir,
    });
    assert.equal(asked.deliveries[0].agent, b.lead.id, "a coordinator may still be asked things");

    await assert.rejects(
      () => sendMessage({
        runDir, from: a.member.id, to: [b.lead.id], stage: "implement", body: "Please write the parser.",
        route, fromProject: a.dir,
      }),
      (e) => e.code === "TOPOLOGY_COORDINATOR_NOT_A_WORKER",
      "an assignment stage aimed at a coordinator must be refused, not merely discouraged",
    );

    // A redirect does not become a back door: work aimed at a member lands on the lead only if it
    // is not an assignment.
    await assert.rejects(
      () => sendMessage({
        runDir, from: a.member.id, to: [b.member.id], stage: "implement", body: "Do this for us.",
        route, fromProject: a.dir,
      }),
      (e) => e.code === "TOPOLOGY_COORDINATOR_NOT_A_WORKER",
      "a redirect must not hand the lead work the member was meant to do",
    );

    // The same fact holds with no router at all, from the run record alone.
    const flagged = await runFor({ ...b, dir: await mkdtemp(join(tmpdir(), "ao-coord-flag-")) }, { flagCoordinator: true });
    await assert.rejects(
      () => sendMessage({ runDir: flagged, from: "operator", to: [b.lead.id], stage: "build", body: "Ship it." }),
      (e) => e.code === "TOPOLOGY_COORDINATOR_NOT_A_WORKER",
    );
    // An explicit `assignment: false` is the escape hatch for a stage name that only looks like one.
    const forwarded = await sendMessage({
      runDir: flagged, from: "operator", to: [b.lead.id], stage: "build", body: "FYI: the build broke.", assignment: false,
    });
    assert.equal(forwarded.deliveries[0].agent, b.lead.id);
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test("the lead's inbox depth is a number, and it is journalled as it grows", async () => {
  const a = await project("depth-a");
  const b = await project("depth-b");
  try {
    const runDir = await runFor(b);
    const route = (args) => routeMessage({ consumer: b.dir, ...args });

    assert.deepEqual((await leadQueueDepth(runDir)).map((r) => r.depth), [0], "an idle lead reads zero, not nothing");
    // The guard against the bug this replaced: filtering the run on `role === "lead"` matched
    // nothing and returned [], which every caller reads as "no congestion".
    assert.equal((await leadQueueDepth(runDir)).length, 1, "the lead must be found even though the run calls it an orchestrator");

    for (const n of [1, 2, 3]) {
      await sendMessage({
        runDir, from: a.member.id, to: [b.member.id], stage: "ask", body: `Question ${n}.`,
        route, fromProject: a.dir,
      });
    }

    const [lead] = await leadQueueDepth(runDir);
    assert.equal(lead.agent, b.lead.id, "the lead is resolved from the agent library, not from the run's role field");
    assert.equal(lead.lead_from, "library");
    assert.equal(lead.role, "orchestrator", "the run really does record the lead under the spec's role");
    assert.equal(lead.depth, 3, "every redirected message is sitting in the lead's inbox");
    assert.ok(lead.oldest_age_ms >= 0, "the oldest waiting message has an age");
    assert.equal(lead.messages.length, 3);

    // Congestion is in the record, not inferred from slowness after the fact.
    const journal = await readJournal(runDir, 200);
    const depths = journal.filter((e) => e.type === "queue.depth" && e.agent === b.lead.id).map((e) => e.depth);
    assert.deepEqual(depths, [1, 2, 3], "each redirect records the depth it created");

    // Answering drains it, and the member — who never received anything — reads zero.
    await recordReply({ runDir, agentId: b.lead.id, messageId: "001-ask", body: "Answered.", token: `tok-${b.lead.id}` });
    const after = await queueDepth(runDir, [b.lead.id, b.member.id]);
    assert.equal(after.find((r) => r.agent === b.lead.id).depth, 2);
    assert.equal(after.find((r) => r.agent === b.member.id).depth, 0);
  } finally {
    await rm(a.dir, { recursive: true, force: true });
    await rm(b.dir, { recursive: true, force: true });
  }
});

test("a run that records only the token's digest still authenticates the writer", async () => {
  const p = await project("digest");
  try {
    const runDir = await runFor(p);
    const secret = "s3cret-token";
    const digest = createHash("sha256").update(secret).digest("hex");
    const run = await readJson(join(runDir, "run.json"));
    // run.json is readable by anything on the box, so the record holds a digest and not the secret:
    // enough to check a reply with, never enough to forge one with.
    run.agents = run.agents.map((a) => (a.id === p.member.id ? { id: a.id, role: a.role, token_sha256: digest } : a));
    await writeJson(join(runDir, "run.json"), run);

    const msg = await sendMessage({ runDir, from: p.lead.id, to: [p.member.id], stage: "brief", body: "Do the thing." });
    await assert.rejects(
      () => recordReply({ runDir, agentId: p.member.id, messageId: msg.id, body: "forged", token: digest }),
      (e) => e.code === "TOPOLOGY_AGENT_UNAUTHORIZED",
      "the stored digest is not itself a usable credential",
    );
    await recordReply({ runDir, agentId: p.member.id, messageId: msg.id, body: "Done.", token: secret });
    const wait = await waitForReplies({ runDir, agentIds: [p.member.id], messageId: msg.id, timeoutMs: 1000, pollMs: 20 });
    assert.equal(wait.ok, true);
  } finally {
    await rm(p.dir, { recursive: true, force: true });
  }
});

test("an agent cannot answer for another agent, and an empty reply satisfies nothing", async () => {
  const p = await project("auth");
  try {
    const runDir = await runFor(p);
    const msg = await sendMessage({ runDir, from: p.lead.id, to: [p.member.id], stage: "brief", body: "Do the thing." });

    await assert.rejects(
      () => recordReply({ runDir, agentId: p.member.id, messageId: msg.id, body: "forged", token: `tok-${p.lead.id}` }),
      (e) => e.code === "TOPOLOGY_AGENT_UNAUTHORIZED",
      "one agent must not be able to write another's outbox",
    );

    await assert.rejects(
      () => recordReply({ runDir, agentId: p.member.id, messageId: msg.id, body: "   ", token: `tok-${p.member.id}` }),
      (e) => e.code === "TOPOLOGY_REPLY_EMPTY",
      "an empty reply must be refused",
    );

    await assert.rejects(
      () => recordReply({ runDir, agentId: p.member.id, messageId: msg.id, body: "no token at all" }),
      (e) => e.code === "TOPOLOGY_AGENT_UNAUTHORIZED",
      "an unauthenticated reply is not an anonymous one; it is refused",
    );

    const stillPending = await pendingReplies(runDir, [p.member.id]);
    assert.equal(stillPending.length, 1, "neither attempt may satisfy the barrier");

    // A zero-byte file dropped straight into the outbox is the same failure by another route, and
    // must not release the barrier either.
    await writeFile(stillPending[0].outbox, "", "utf8");
    const wait = await waitForReplies({ runDir, agentIds: [p.member.id], messageId: msg.id, timeoutMs: 120, pollMs: 20 });
    assert.equal(wait.ok, false, "an empty reply file is not an answer");
  } finally {
    await rm(p.dir, { recursive: true, force: true });
  }
});
