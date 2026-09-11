// TM-133 — broadcast addressing with one expansion point.
//
// The load-bearing claims under test: an `@` token is the only new syntax and everything else is
// byte-identical to today; expansion happens inside sendMessage so nothing can bypass admission;
// an `@` token from outside the repository is refused; a standing agent outside `run.agents` is
// DELIVERED rather than tripping TOPOLOGY_UNKNOWN_AGENT; and the bound refuses instead of
// truncating.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_BROADCAST, expandAddresses } from "../../topology/lib/addressing.mjs";
import { expandFanout, forwardMessageToWorkflow, loadRun, recordReply, sendMessage, waitForReplies } from "../../topology/lib/mailbox.mjs";
import { agentsRoot } from "../../topology/lib/agents.mjs";
import { writeJson } from "../../topology/lib/util.mjs";

const ROSTER = [
  { id: "conductor", role: "orchestrator" },
  { id: "alice", role: "worker" },
  { id: "bob", role: "worker" },
  { id: "rev", role: "reviewer" },
];

const LIBRARY = [
  ["conductor", "orchestrator"], ["alice", "worker"], ["bob", "worker"], ["rev", "reviewer"],
  ["lead0001", "lead"], ["standing-rev", "reviewer"],
];

/** Presence is a DIRECTORY, not authority — these are the rows `collectPresenceAgents` would return. */
function presenceRow(agentId, { repoRole = "member", runRole = null, kind = "role-session", enrollment = "enrolled" } = {}) {
  return { agentId, displayName: agentId, repoRole, runRole, enrollment, session: { kind } };
}
const presence = (rows) => async () => rows;
const censusOf = (doc) => async () => doc;

async function fixture(t, { agents = ROSTER, library = LIBRARY, consumerName = "repo" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ao-addressing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, consumerName);
  const home = join(root, "home");
  await Promise.all([consumer, home].map((path) => mkdir(path, { recursive: true })));
  const runDir = join(consumer, "run");
  await writeJson(join(runDir, "run.json"), {
    consumer, version: 1, name: "t", run_id: "r1", session: "t-r1", sequence: 0, agents,
  });
  for (const [id, role] of library) await writeJson(join(agentsRoot(consumer), id, "agent.json"), { id, role, full_name: id });
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  // A responsive lead on both sides, so a cross-repo test exercises ROUTING rather than readiness.
  const readiness = async () => ({ status: "responsive", record: { agent_id: "lead0001" }, library_lead: "lead0001" });
  return { root, consumer, home, runDir, env, standingOptions: { home, readiness } };
}

test("every non-@ address is byte-identical to expandFanout, and an unknown @ token is refused", async (t) => {
  const f = await fixture(t, {
    agents: [...ROSTER,
      { id: "per-file.a", role: "worker", fanout_of: "per-file" },
      { id: "per-file.b", role: "worker", fanout_of: "per-file" }],
  });
  const run = await loadRun(f.runDir);
  for (const to of [["alice"], ["alice", "bob"], ["per-file"], ["per-file", "alice"], ["ghost"], ["conductor", "per-file", "ghost"]]) {
    const expanded = await expandAddresses({ run, to, from: "conductor", consumer: f.consumer });
    assert.deepEqual(expanded.map((entry) => entry.id), expandFanout(run, to), `literal ${to.join(",")} must not change`);
    assert.ok(expanded.every((entry) => entry.delivery === "run"), "a literal token keeps today's envelope path");
  }
  await assert.rejects(expandAddresses({ run, to: ["@runn"], consumer: f.consumer }), { code: "TOPOLOGY_ADDRESS_UNKNOWN" });
  await assert.rejects(expandAddresses({ run, to: ["@role:"], consumer: f.consumer }), { code: "TOPOLOGY_ADDRESS_UNKNOWN" });
});

test("@run is the roster minus the sender minus the orchestrator", async (t) => {
  const f = await fixture(t);
  const run = await loadRun(f.runDir);
  assert.deepEqual((await expandAddresses({ run, to: ["@run"], from: "alice", consumer: f.consumer })),
    [{ id: "bob", delivery: "run" }, { id: "rev", delivery: "run" }]);
  assert.deepEqual((await expandAddresses({ run, to: ["@run"], from: "conductor", consumer: f.consumer })).map((e) => e.id),
    ["alice", "bob", "rev"]);
  // Unioned by the comma `--to` already means, deduplicated, no intersection grammar.
  assert.deepEqual((await expandAddresses({ run, to: ["@run", "alice"], from: "alice", consumer: f.consumer })).map((e) => e.id),
    ["bob", "rev", "alice"]);
});

test("@role: spans both scopes and tags each expansion with its envelope path", async (t) => {
  const f = await fixture(t);
  const run = await loadRun(f.runDir);
  const rows = [presenceRow("standing-rev", { repoRole: "reviewer" }), presenceRow("bob", { runRole: "worker", kind: "run" })];
  assert.deepEqual(await expandAddresses({ run, to: ["@role:reviewer"], from: "alice", consumer: f.consumer, collectPresence: presence(rows) }),
    [{ id: "rev", delivery: "run" }, { id: "standing-rev", delivery: "standing" }]);
  // A run pane is `@run`'s business; `@repo` is the STANDING agents of the destination repository.
  assert.deepEqual((await expandAddresses({ run, to: ["@repo"], from: "alice", consumer: f.consumer, collectPresence: presence(rows) })).map((e) => e.id),
    ["standing-rev"]);
});

test("@idle reads the census, and refuses rather than degrading when it cannot", async (t) => {
  const f = await fixture(t);
  const run = await loadRun(f.runDir);
  const fresh = { stale: false, ageMs: 1000, agents: [
    { agentId: "alice", dispatchable: true }, { agentId: "bob", dispatchable: false }, { agentId: "lead0001", dispatchable: true }] };
  assert.deepEqual(await expandAddresses({ run, to: ["@idle"], from: "alice", consumer: f.consumer, census: censusOf(fresh) }),
    [{ id: "lead0001", delivery: "standing" }]);
  await assert.rejects(expandAddresses({ run, to: ["@idle"], from: "alice", consumer: f.consumer, census: censusOf(null) }),
    { code: "TOPOLOGY_CENSUS_UNAVAILABLE" });
  await assert.rejects(expandAddresses({ run, to: ["@idle"], from: "alice", consumer: f.consumer,
    census: censusOf({ stale: true, ageMs: 90_000, agents: [{ agentId: "bob", dispatchable: false }] }) }),
    { code: "TOPOLOGY_CENSUS_UNAVAILABLE" });
  // Nobody free is not the same as everybody free: it refuses too, rather than sending nowhere.
  await assert.rejects(expandAddresses({ run, to: ["@idle"], from: "alice", consumer: f.consumer,
    census: censusOf({ stale: false, ageMs: 10, agents: [{ agentId: "bob", dispatchable: false }] }) }),
    { code: "TOPOLOGY_BROADCAST_EMPTY" });
});

test("THE TRAP: a standing lead outside run.agents is delivered, not TOPOLOGY_UNKNOWN_AGENT", async (t) => {
  const f = await fixture(t);
  const rows = [presenceRow("lead0001", { repoRole: "lead" }), presenceRow("standing-rev", { repoRole: "reviewer" }),
    presenceRow("bob", { runRole: "worker", kind: "run" })];
  const message = await sendMessage({
    runDir: f.runDir, from: "alice", fromProject: f.consumer, to: ["@repo"], stage: "brief",
    body: "Room, listen.", env: f.env, standingOptions: f.standingOptions,
    addressing: { collectPresence: presence(rows) },
  });
  assert.deepEqual(message.holds, [], "nothing was held: same-repo standing mail skips the lead-readiness gate");
  assert.deepEqual(message.deliveries.map((d) => [d.agent, Boolean(d.standing)]), [["lead0001", true], ["standing-rev", true]]);
  const run = await loadRun(f.runDir);
  assert.equal(Object.keys(run.standing_messages ?? {}).length, 2, "each standing recipient got one durable envelope");
  assert.deepEqual(run.message_envelopes[message.id].to, ["@repo"], "the envelope records what was ADDRESSED, not what it expanded to");
});

test("TM-168: a role icon is display only — a lead icon on a worker's row does not make it a lead", async (t) => {
  const f = await fixture(t);
  const run = await loadRun(f.runDir);
  const { roleVisual } = await import("../../topology/lib/identity.mjs");
  const lead = roleVisual({ role: "lead" });
  const impostor = { ...presenceRow("impostor", { runRole: "worker", kind: "run" }), ...lead };
  const expand = (to) => expandAddresses({ run, to, from: "alice", consumer: f.consumer, collectPresence: presence([impostor]) });
  await assert.rejects(expand(["@role:lead"]), { code: "TOPOLOGY_BROADCAST_EMPTY" },
    "addressing reads repoRole and runRole; a lead icon and label must not put anyone in the lead audience");
  assert.ok((await expand(["@role:worker"])).some((entry) => entry.id === "impostor"), "it is reached by the role it actually has");
  await assert.rejects(expand([`@role:${lead.roleIcon}`]), { code: "TOPOLOGY_ADDRESS_UNKNOWN" }, "an icon is not an address");
});

test("an @ token from outside the repository is refused, while a plain id still reaches the lead", async (t) => {
  const f = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), "ao-outsider-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const send = (to) => sendMessage({ runDir: f.runDir, from: "stranger", fromProject: outside, to,
    stage: "ask", body: "Tell everyone.", env: f.env, standingOptions: f.standingOptions,
    addressing: { collectPresence: presence([presenceRow("lead0001", { repoRole: "lead" })]), census: censusOf({ stale: false, agents: [{ agentId: "alice", dispatchable: true }] }) } });
  for (const token of ["@run", "@repo", "@role:worker", "@idle"]) {
    await assert.rejects(send([token]), { code: "TOPOLOGY_BROADCAST_EXTERNAL" }, `${token} must be refused from outside`);
  }
  await assert.rejects(send(["@run", "alice"]), { code: "TOPOLOGY_BROADCAST_EXTERNAL" }, "one @ token poisons the whole list");
  const plain = await send(["alice"]);
  assert.deepEqual(plain.deliveries.map((d) => [d.requested, d.agent]), [["alice", "lead0001"]], "the front door still works exactly as today");
});

test("the bound refuses naming the count and the limit, never truncates, and --max-recipients raises it", async (t) => {
  const wide = [{ id: "conductor", role: "orchestrator" },
    ...Array.from({ length: MAX_BROADCAST + 2 }, (_, i) => ({ id: `w${i}`, role: "worker" }))];
  const f = await fixture(t, { agents: wide, library: [...LIBRARY, ...wide.map((a) => [a.id, a.role])] });
  const args = { runDir: f.runDir, from: "conductor", fromProject: f.consumer, to: ["@run"],
    stage: "brief", body: "All hands.", env: f.env, standingOptions: f.standingOptions };
  await assert.rejects(sendMessage(args), (error) => {
    assert.equal(error.code, "TOPOLOGY_BROADCAST_TOO_WIDE");
    assert.match(error.message, new RegExp(`${MAX_BROADCAST + 2} recipients; the limit is ${MAX_BROADCAST}`));
    return true;
  });
  const run = await loadRun(f.runDir);
  assert.deepEqual(Object.values(run.message_deliveries ?? {}), [], "a refusal delivers to nobody at all");
  const raised = await sendMessage({ ...args, addressing: { maxRecipients: MAX_BROADCAST + 2 } });
  assert.equal(raised.deliveries.length, MAX_BROADCAST + 2);
});

test("wait --message barriers over exactly the delivered set and names the silent one", async (t) => {
  const f = await fixture(t);
  const message = await sendMessage({ runDir: f.runDir, from: "alice", fromProject: f.consumer,
    to: ["@run"], stage: "brief", body: "Status please.", env: f.env, standingOptions: f.standingOptions });
  assert.deepEqual(message.deliveries.map((d) => d.agent), ["bob", "rev"], "the sender and the orchestrator are not in the room");
  await recordReply({ runDir: f.runDir, agentId: "bob", messageId: message.id, body: "bob here" });

  const timeout = await waitForReplies({ runDir: f.runDir, agentIds: ["@run"], messageId: message.id, timeoutMs: 120, pollMs: 20 });
  assert.equal(timeout.ok, false);
  // `@run` expands LIVE here — alice, bob and rev — and the message-id filter is what narrows
  // the barrier to exactly the set the broadcast reached.
  assert.deepEqual(timeout.pending.map((p) => p.agent), ["rev"], "only the recipient that has not answered is named");

  await recordReply({ runDir: f.runDir, agentId: "rev", messageId: message.id, body: "rev here" });
  const done = await waitForReplies({ runDir: f.runDir, agentIds: ["@run"], messageId: message.id, timeoutMs: 2000, pollMs: 20 });
  assert.equal(done.ok, true);
  assert.deepEqual(done.replies.map((r) => r.agent).sort(), ["bob", "rev"]);
});

test("a redirected recipient still satisfies the barrier through the existing redirect map", async (t) => {
  const f = await fixture(t);
  const route = async ({ to }) => (to === "rev"
    ? { deliver_to: "bob", redirected: true, reason: "rev is out", intended_display: "rev" }
    : { deliver_to: to, redirected: false });
  const message = await sendMessage({ runDir: f.runDir, from: "alice", fromProject: f.consumer,
    to: ["@role:reviewer"], stage: "brief", body: "Review this.", route, env: f.env,
    standingOptions: f.standingOptions, addressing: { collectPresence: presence([]) } });
  assert.deepEqual(message.deliveries.map((d) => [d.requested, d.agent]), [["rev", "bob"]]);
  await recordReply({ runDir: f.runDir, agentId: "bob", messageId: message.id, body: "covered for rev" });
  const done = await waitForReplies({ runDir: f.runDir, agentIds: ["@role:reviewer"], messageId: message.id,
    timeoutMs: 2000, pollMs: 20, addressing: { collectPresence: presence([]) } });
  assert.equal(done.ok, true);
  assert.deepEqual(done.replies.map((r) => [r.agent, r.on_behalf_of]), [["bob", "rev"]]);
});

test("forwarding a broadcast-delivered message into a child workflow cannot re-broadcast it", async (t) => {
  const f = await fixture(t);
  const childDir = join(f.consumer, "child");
  await writeJson(join(childDir, "run.json"), { consumer: f.consumer, version: 1, name: "c", run_id: "r2",
    session: "c-r2", sequence: 0, agents: [{ id: "childcond", role: "orchestrator" }, { id: "childworker", role: "worker" }] });
  const run = await loadRun(f.runDir);
  run.agents = run.agents.map((agent) => (agent.id === "bob"
    ? { ...agent, workflow: { name: "w", run_dir: childDir, conductor: "childcond" } } : agent));
  await writeJson(join(f.runDir, "run.json"), run);

  const message = await sendMessage({ runDir: f.runDir, from: "alice", fromProject: f.consumer,
    to: ["@run"], stage: "brief", body: "Broadcast body.", env: f.env, standingOptions: f.standingOptions });
  assert.ok(message.deliveries.some((d) => d.agent === "bob"));
  const forwarded = await forwardMessageToWorkflow({ runDir: f.runDir, messageId: message.id,
    recipient: "bob", env: f.env, standingOptions: f.standingOptions });
  assert.deepEqual(forwarded.deliveries.map((d) => d.agent), ["childcond"],
    "the child sees one named conductor, never the parent's audience token");
  const child = await loadRun(childDir);
  assert.deepEqual(child.message_envelopes[forwarded.id].to, ["childcond"]);
});

// TM-142 — a refused broadcast must cost nothing.
//
// Expansion used to run AFTER `nextSequence` and after the envelope write, so a refusal left
// `message_envelopes[id]` behind and burned a sequence number for a message nobody ever received.
// The assertion here is deliberately on the BYTES of run.json rather than on any one field: a
// refusal that leaves the file identical cannot have written anything at all, whatever gets added
// to the record later.
test("a refused broadcast leaves run.json byte-identical, and an outsider cannot grow it", async (t) => {
  const wide = [{ id: "conductor", role: "orchestrator" },
    ...Array.from({ length: MAX_BROADCAST + 2 }, (_, i) => ({ id: `w${i}`, role: "worker" }))];
  const f = await fixture(t, { agents: wide, library: [...LIBRARY, ...wide.map((a) => [a.id, a.role])] });
  const outside = await mkdtemp(join(tmpdir(), "ao-outsider-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const runFile = join(f.runDir, "run.json");
  const bytes = () => readFile(runFile);

  // One real send first, so the file under comparison is a run with history rather than a blank.
  await sendMessage({ runDir: f.runDir, from: "conductor", fromProject: f.consumer, to: ["w0"],
    stage: "brief", body: "One real message.", env: f.env, standingOptions: f.standingOptions });
  const before = await bytes();

  const refusals = [
    ["TOPOLOGY_BROADCAST_TOO_WIDE", { from: "conductor", fromProject: f.consumer, to: ["@run"] }],
    ["TOPOLOGY_BROADCAST_EXTERNAL", { from: "stranger", fromProject: outside, to: ["@run"] }],
    ["TOPOLOGY_BROADCAST_EXTERNAL", { from: "stranger", fromProject: outside, to: ["@repo"] }],
    ["TOPOLOGY_ADDRESS_UNKNOWN", { from: "conductor", fromProject: f.consumer, to: ["@nobody"] }],
  ];
  // Repeated, because the adversarial case is an outsider hammering the same refusal to grow
  // somebody else's run record one envelope at a time.
  for (let round = 0; round < 3; round += 1) {
    for (const [code, args] of refusals) {
      await assert.rejects(sendMessage({ runDir: f.runDir, stage: "brief", body: "Tell everyone.",
        env: f.env, standingOptions: f.standingOptions, ...args }), { code });
      assert.deepEqual(await bytes(), before, `${code} must leave run.json untouched`);
    }
  }

  // And the run is still usable afterwards: the next real send takes the very next number, with no
  // gap a reader could mistake for a lost message.
  const next = await sendMessage({ runDir: f.runDir, from: "conductor", fromProject: f.consumer,
    to: ["w1"], stage: "brief", body: "Second real message.", env: f.env, standingOptions: f.standingOptions });
  assert.equal(next.seq, "002", "no sequence number was consumed by the refusals");
  const run = await loadRun(f.runDir);
  assert.deepEqual(Object.keys(run.message_envelopes), ["001-brief", "002-brief"]);
});

// The reorder moved expansion above `nextSequence`, which is where idempotency lives. Same key +
// same content must still return the same seq; same key + different content must still conflict.
test("moving expansion above the allocation does not disturb idempotency", async (t) => {
  const f = await fixture(t);
  const args = { runDir: f.runDir, from: "alice", fromProject: f.consumer, to: ["bob"], stage: "brief",
    body: "Once.", env: f.env, standingOptions: f.standingOptions, idempotencyKey: "k1" };
  const first = await sendMessage(args);
  const again = await sendMessage(args);
  assert.equal(again.seq, first.seq, "a repeated key with the same fingerprint reuses its number");
  await assert.rejects(sendMessage({ ...args, body: "Twice." }), { code: "TOPOLOGY_MESSAGE_ID_CONFLICT" });
  // A refused broadcast must not burn the key either.
  await assert.rejects(sendMessage({ ...args, to: ["@nobody"], idempotencyKey: "k2" }), { code: "TOPOLOGY_ADDRESS_UNKNOWN" });
  const run = await loadRun(f.runDir);
  assert.equal(Object.keys(run.message_keys).length, 1, "the refused send recorded no idempotency key");
});
