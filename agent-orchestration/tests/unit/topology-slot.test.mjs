// TM-132 — named serial slots with a mechanical queue.
//
// Every test here runs with NO tmux server: the pane world is an injected `listPanesFn`, exactly
// the seam `enrollment.mjs` and `presence.mjs` use, so the lifecycle is testable without a
// terminal. `AGENT_ORCHESTRATION_STATE_HOME` puts the records in a scratch directory.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertSlotName, byTicket, grantSlot, liveness, reconcile, reconcileSlots,
  releaseSlot, requestSlot, restampSlotBindings, slotsDir, slotStatus,
} from "../../topology/lib/slots.mjs";
import { canonicalRepoId } from "../../topology/lib/repoid.mjs";
import { TopologyError } from "../../topology/lib/util.mjs";

const SERVER = "/tmp/tmux-test/default";
const scratch = () => mkdtemp(join(tmpdir(), "ao-slot-"));

function pane(n, overrides = {}) {
  return { serverKey: SERVER, serverPid: 99, sessionId: `$${n}`, sessionCreated: 1_700_000_000 + n,
    paneId: `%${n}`, panePid: 1000 + n, sessionName: `s${n}`, alive: true, ...overrides };
}
const bindingOf = ({ serverKey, serverPid, sessionId, sessionCreated, paneId, panePid }) =>
  ({ serverKey, serverPid, sessionId, sessionCreated, paneId, panePid });

/** A pane world plus the seams every call needs. `world` is mutated by the tests to kill panes. */
function fixture(root, consumer) {
  const world = new Map();
  const listPanesFn = async () => [...world.values()];
  const env = { AGENT_ORCHESTRATION_STATE_HOME: root };
  const ctx = { consumer, env, home: root, listPanesFn };
  return {
    world, ctx, env,
    add(n, overrides) { const row = pane(n, overrides); world.set(row.paneId, row); return bindingOf(row); },
    kill(n) { world.delete(`%${n}`); },
    // The environment an agent standing in pane %n presents.
    as(n, agentId) { return { ...env, TMUX: `${SERVER},99,0`, TMUX_PANE: `%${n}`, AO_AGENT_ID: agentId, AO_CONSUMER: consumer }; },
    async raw(name) { const identity = await canonicalRepoId(consumer); return readFile(join(slotsDir(identity, env, root), `${name}.json`), "utf8"); },
  };
}

async function setup(t) {
  const root = await scratch();
  const consumer = await mkdtemp(join(tmpdir(), "ao-slot-repo-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(consumer, { recursive: true, force: true })]));
  return fixture(root, consumer);
}

test("a name containing / or .. never becomes a path", async () => {
  for (const bad of ["../escape", "a/b", "/etc/passwd", "..", "Cutover", "", "-lead", "x".repeat(65)]) {
    assert.throws(() => assertSlotName(bad), (error) => error instanceof TopologyError && error.code === "TOPOLOGY_SLOT_NAME_INVALID", `"${bad}" must be refused`);
  }
  for (const good of ["integration", "cutover", "deploy-safe", "a", "0", "no-restart-hold"]) assert.equal(assertSlotName(good), good);
});

test("the name is validated before it is joined to a path, on every verb", async (t) => {
  const f = await setup(t);
  f.add(1);
  await assert.rejects(requestSlot({ ...f.ctx, name: "../../pwned", agentId: "a0000001", reason: "x", env: f.as(1, "a0000001") }),
    (error) => error.code === "TOPOLOGY_SLOT_NAME_INVALID");
  await assert.rejects(releaseSlot({ ...f.ctx, name: "a/b", agentId: "a0000001" }), (error) => error.code === "TOPOLOGY_SLOT_NAME_INVALID");
  await assert.rejects(slotStatus({ ...f.ctx, name: ".." }), (error) => error.code === "TOPOLOGY_SLOT_NAME_INVALID");
});

test("first request is granted; the rest queue in ticket order", async (t) => {
  const f = await setup(t);
  for (let n = 1; n <= 3; n += 1) f.add(n);
  const first = await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "cutover to e5f6a7b8 for TM-221", env: f.as(1, "a0000001") });
  assert.equal(first.holder.agent_id, "a0000001");
  assert.equal(first.holder.ticket, "1");
  assert.deepEqual(first.events.map((event) => event.type), ["granted"]);
  const second = await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "second", env: f.as(2, "a0000002") });
  const third = await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000003", reason: "third", env: f.as(3, "a0000003") });
  assert.equal(second.you.ticket, "2");
  assert.equal(third.you.ticket, "3");
  assert.deepEqual(third.queue.map((entry) => entry.agent_id), ["a0000002", "a0000003"]);
  assert.equal(third.holder.agent_id, "a0000001");
});

test("FIFO is by ticket, never by timestamp: skewed clocks do not reorder the queue", async (t) => {
  const f = await setup(t);
  for (let n = 1; n <= 3; n += 1) f.add(n);
  for (const [id, n] of [["a0000001", 1], ["a0000002", 2], ["a0000003", 3]]) {
    await requestSlot({ ...f.ctx, name: "cutover", agentId: id, reason: `for ${id}`, env: f.as(n, id) });
  }
  // Rewrite the durable record so the WAITING entries carry clocks in the opposite order, and give
  // the later ticket the earlier timestamp. A queue ordered by time would now hand the slot to
  // a0000003; a queue ordered by ticket must not.
  const identity = await canonicalRepoId(f.ctx.consumer);
  const path = join(slotsDir(identity, f.env, f.ctx.home), "cutover.json");
  const record = JSON.parse(await readFile(path, "utf8"));
  record.holder = null;
  record.queue[0].requested_at = "2030-01-01T00:00:00.000Z";
  record.queue[1].requested_at = "1999-01-01T00:00:00.000Z";
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const view = await slotStatus({ ...f.ctx, name: "cutover" });
  assert.equal(view.holder.agent_id, "a0000002", "ticket 2 holds even though ticket 3 has the older clock");
  assert.equal(view.holder.ticket, "2");
});

test("byTicket orders decimal strings numerically, past Number.MAX_SAFE_INTEGER", () => {
  assert.ok(byTicket("2", "10") < 0, "a plain string compare would put 10 before 2");
  assert.ok(byTicket("10", "2") > 0);
  assert.ok(byTicket("9007199254740993", "9007199254740994") < 0, "adjacent tickets past the float boundary still differ");
  assert.equal(byTicket("7", "7"), 0);
});

test("a repeated request is idempotent: same ticket, same position, never sent to the back", async (t) => {
  const f = await setup(t);
  for (let n = 1; n <= 3; n += 1) f.add(n);
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "holder", env: f.as(1, "a0000001") });
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: f.as(2, "a0000002") });
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000003", reason: "behind", env: f.as(3, "a0000003") });
  for (let poll = 0; poll < 5; poll += 1) {
    const view = await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: f.as(2, "a0000002") });
    assert.equal(view.you.ticket, "2", "a poller keeps its ticket");
    assert.equal(view.you.position, 1, "a poller keeps its position");
    assert.deepEqual(view.queue.map((entry) => entry.agent_id), ["a0000002", "a0000003"]);
  }
  const view = await slotStatus({ ...f.ctx, name: "cutover" });
  assert.equal(view.next_ticket, "4", "polling allocates no new tickets");
  const settled = await f.raw("cutover");
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: f.as(2, "a0000002") });
  assert.equal(await f.raw("cutover"), settled, "a poll that changes nothing writes nothing");
});

test("release alone does not grant; reconcile does", async (t) => {
  const f = await setup(t);
  f.add(1); f.add(2);
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "holder", env: f.as(1, "a0000001") });
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: f.as(2, "a0000002") });
  const released = await releaseSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", env: f.as(1, "a0000001") });
  assert.equal(released.holder, null, "release clears the holder and does nothing else");
  assert.deepEqual(released.queue.map((entry) => entry.agent_id), ["a0000002"], "the queue is untouched by release");
  assert.deepEqual(released.events.map((event) => event.type), ["released"]);
  // Nobody ran a verb. The tick does it.
  const [view] = await reconcileSlots({ ...f.ctx });
  assert.equal(view.holder.agent_id, "a0000002");
  assert.deepEqual(view.events.map((event) => event.type), ["granted"]);
  assert.equal(view.holder.ticket, "2");
  assert.ok(view.holder.granted_binding, "a grant records the binding it was checked against");
});

test("release without proof refuses and leaves the record byte-identical", async (t) => {
  const f = await setup(t);
  f.add(1); f.add(2);
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "holder", env: f.as(1, "a0000001") });
  const before = await f.raw("cutover");
  const refusals = [
    // Right agent id, wrong pane.
    { ...f.ctx, name: "cutover", agentId: "a0000001", env: f.as(2, "a0000001") },
    // Right pane, someone else asking.
    { ...f.ctx, name: "cutover", agentId: "a0000002", env: f.as(2, "a0000002") },
    // No identity at all.
    { ...f.ctx, name: "cutover", agentId: "a0000001", env: f.env },
    // Claims to be the holder but names another repository.
    { ...f.ctx, name: "cutover", agentId: "a0000001", env: { ...f.as(1, "a0000001"), AO_CONSUMER: tmpdir() } },
  ];
  for (const attempt of refusals) {
    await assert.rejects(releaseSlot(attempt), (error) => error instanceof TopologyError && error.code === "TOPOLOGY_SLOT_NOT_HOLDER");
    assert.equal(await f.raw("cutover"), before, "a refused release must not move a single byte");
  }
  // And the real holder still can.
  const ok = await releaseSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", env: f.as(1, "a0000001") });
  assert.equal(ok.holder, null);
  assert.equal(ok.events[0].proof, "standing-pane");
});

test("a run agent releases with its token digest; a wrong token does not", async (t) => {
  const f = await setup(t);
  f.add(1);
  const { createHash } = await import("node:crypto");
  const runDir = join(f.ctx.consumer, "run");
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "run.json"), JSON.stringify({ run_id: "r1", agents: [{ id: "a0000001", token_sha256: createHash("sha256").update("s3cret").digest("hex") }] }), "utf8");
  await requestSlot({ ...f.ctx, name: "deploy-safe", agentId: "a0000001", reason: "deploy", runDir, env: f.as(1, "a0000001") });
  // A run agent standing in a DIFFERENT pane — the standing proof cannot save it, only the token can.
  const foreign = { ...f.env, TMUX: `${SERVER},99,0`, TMUX_PANE: "%9" };
  await assert.rejects(releaseSlot({ ...f.ctx, name: "deploy-safe", agentId: "a0000001", token: "wrong", env: foreign }),
    (error) => error.code === "TOPOLOGY_SLOT_NOT_HOLDER");
  const ok = await releaseSlot({ ...f.ctx, name: "deploy-safe", agentId: "a0000001", token: "s3cret", env: foreign });
  assert.equal(ok.events[0].proof, "run-token");
});

test("a holder whose six-tuple is absent is reclaimed; a present one is never reclaimed, however old", async (t) => {
  const f = await setup(t);
  f.add(1); f.add(2);
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "holder", expectMs: 1, env: f.as(1, "a0000001") });
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: f.as(2, "a0000002") });
  // Age NEVER reclaims. Backdate the grant a year and declare a 1 ms expectation.
  const identity = await canonicalRepoId(f.ctx.consumer);
  const path = join(slotsDir(identity, f.env, f.ctx.home), "cutover.json");
  const record = JSON.parse(await readFile(path, "utf8"));
  record.holder.granted_at = "2020-01-01T00:00:00.000Z";
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const aged = await slotStatus({ ...f.ctx, name: "cutover" });
  assert.equal(aged.holder.agent_id, "a0000001", "an old hold is still a hold");
  assert.equal(aged.holder.overdue, true, "status flags it, and that is all it does");
  assert.ok(aged.holder.held_for_ms > 86_400_000);
  assert.deepEqual(aged.events, [], "flagging is not reclaiming");
  // Now the pane goes away. THAT reclaims — and the next in line is granted in the same pass.
  f.kill(1);
  const view = await slotStatus({ ...f.ctx, name: "cutover" });
  assert.deepEqual(view.events.map((event) => event.type), ["vacated", "granted"]);
  assert.equal(view.holder.agent_id, "a0000002");
});

test("a grant nobody can prove is reclaimed on the next tick rather than honoured", async (t) => {
  const f = await setup(t);
  f.add(1); f.add(2);
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "holder", env: f.as(1, "a0000001") });
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: f.as(2, "a0000002") });
  // Both die between one tick and the next: the head is granted, then immediately reclaimed.
  f.kill(1); f.kill(2);
  const view = await slotStatus({ ...f.ctx, name: "cutover" });
  assert.equal(view.holder, null, "a slot granted to nobody is free, not held");
  assert.deepEqual(view.queue, []);
  const again = await slotStatus({ ...f.ctx, name: "cutover" });
  assert.deepEqual(again.events, []);
});

test("a dead mid-queue entry is dropped without disturbing those behind it", async (t) => {
  const f = await setup(t);
  for (let n = 1; n <= 4; n += 1) f.add(n);
  const ids = ["a0000001", "a0000002", "a0000003", "a0000004"];
  for (const [index, id] of ids.entries()) await requestSlot({ ...f.ctx, name: "integration", agentId: id, reason: `for ${id}`, env: f.as(index + 1, id) });
  f.kill(3);
  const view = await slotStatus({ ...f.ctx, name: "integration" });
  assert.equal(view.holder.agent_id, "a0000001", "the holder is untouched");
  assert.deepEqual(view.queue.map((entry) => entry.agent_id), ["a0000002", "a0000004"]);
  assert.deepEqual(view.queue.map((entry) => entry.ticket), ["2", "4"], "surviving tickets keep their values");
  assert.deepEqual(view.queue.map((entry) => entry.position), [1, 2]);
  assert.deepEqual(view.events.map((event) => event.type), ["dropped"]);
});

test("an unreadable pane listing reclaims nothing: proof of absence, never absence of proof", async (t) => {
  const f = await setup(t);
  f.add(1); f.add(2);
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "holder", env: f.as(1, "a0000001") });
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: f.as(2, "a0000002") });
  const before = await f.raw("cutover");
  const blind = async () => { const error = new TopologyError("TOPOLOGY_TMUX_OBSERVATION_FAILED", "no server"); error.code = "TOPOLOGY_TMUX_OBSERVATION_FAILED"; throw error; };
  const view = await slotStatus({ ...f.ctx, name: "cutover", listPanesFn: blind });
  assert.equal(view.holder.agent_id, "a0000001", "a tmux hiccup must never hand a cutover slot to a second agent");
  assert.equal(await f.raw("cutover"), before);
});

test("reconcile twice is byte-identical, and returns the same object when nothing moved", async (t) => {
  const f = await setup(t);
  f.add(1); f.add(2);
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "holder", env: f.as(1, "a0000001") });
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: f.as(2, "a0000002") });
  const first = await f.raw("cutover");
  await slotStatus({ ...f.ctx, name: "cutover" });
  assert.equal(await f.raw("cutover"), first);
  await slotStatus({ ...f.ctx, name: "cutover" });
  assert.equal(await f.raw("cutover"), first);
  // And at the pure level, including after a mutating pass.
  const record = JSON.parse(first);
  const alive = liveness([...f.world.values()]);
  const once = reconcile(record, alive, "2026-01-01T00:00:00.000Z");
  assert.equal(once.record, record, "an unchanged record is returned by identity, so callers skip the write");
  f.kill(1);
  const moved = reconcile(record, liveness([...f.world.values()]), "2026-01-01T00:00:00.000Z");
  const settled = reconcile(moved.record, liveness([...f.world.values()]), "2026-01-01T00:00:00.000Z");
  assert.equal(JSON.stringify(moved.record), JSON.stringify(settled.record), "reconcile is idempotent");
  assert.deepEqual(settled.events, []);
});

test("eight concurrent requests yield exactly one holder and seven distinct consecutive tickets", async (t) => {
  const f = await setup(t);
  const agents = Array.from({ length: 8 }, (_, index) => {
    const binding = f.add(index + 1);
    return { id: `a000000${index + 1}`, binding };
  });
  const views = await Promise.all(agents.map((agent) => requestSlot({ ...f.ctx, name: "cutover", agentId: agent.id, reason: `race ${agent.id}`, binding: agent.binding })));
  assert.equal(views.length, 8);
  const view = await slotStatus({ ...f.ctx, name: "cutover" });
  assert.ok(view.holder, "somebody holds it");
  assert.equal(view.queue.length, 7, "and exactly seven wait");
  const tickets = [view.holder.ticket, ...view.queue.map((entry) => entry.ticket)].map(Number).sort((a, b) => a - b);
  assert.deepEqual(tickets, [1, 2, 3, 4, 5, 6, 7, 8], "eight distinct consecutive tickets, no gaps and no reuse");
  assert.equal(view.holder.ticket, "1", "and ticket 1 is the holder: FIFO survives the race");
  assert.deepEqual(view.queue.map((entry) => entry.ticket), ["2", "3", "4", "5", "6", "7", "8"]);
  assert.equal(new Set([view.holder.agent_id, ...view.queue.map((entry) => entry.agent_id)]).size, 8);
});

test("grant --to refuses for a non-lead, and records the tickets it jumped for the lead", async (t) => {
  const f = await setup(t);
  for (let n = 1; n <= 3; n += 1) f.add(n);
  const leadFn = async () => ({ record: { agent_id: "1eadbeef" } });
  for (const [index, id] of ["a0000001", "a0000002", "a0000003"].entries()) {
    await requestSlot({ ...f.ctx, name: "cutover", agentId: id, reason: `for ${id}`, env: f.as(index + 1, id) });
  }
  await assert.rejects(grantSlot({ ...f.ctx, name: "cutover", to: "a0000003", leadFn, env: f.as(2, "a0000002") }),
    (error) => error instanceof TopologyError && error.code === "TOPOLOGY_SLOT_NOT_LEAD");
  await assert.rejects(grantSlot({ ...f.ctx, name: "cutover", to: "a0000003", leadFn: async () => null, env: { ...f.env, AO_AGENT_ID: "1eadbeef" } }),
    (error) => error.code === "TOPOLOGY_SLOT_NOT_LEAD", "no registration means no lead");
  const view = await grantSlot({ ...f.ctx, name: "cutover", to: "a0000003", leadFn, env: { ...f.env, AO_AGENT_ID: "1eadbeef" } });
  assert.equal(view.holder.agent_id, "a0000003");
  assert.deepEqual(view.holder.override.jumped, [{ agent_id: "a0000002", ticket: "2" }], "the jump is on the record");
  assert.equal(view.holder.override.by, "1eadbeef");
  assert.deepEqual(view.queue.map((entry) => entry.agent_id), ["a0000002"], "the jumped agent keeps its place, it does not lose it");
});

test("a failover respawn keeps its slot: restampSlotBindings replaces the six-tuple in place", async (t) => {
  const f = await setup(t);
  f.add(1); f.add(2);
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "holder", env: f.as(1, "a0000001") });
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: f.as(2, "a0000002") });
  // Quota failover: same pane, new process. Without a re-stamp the old six-tuple is provably gone
  // and this agent silently forfeits its slot.
  f.world.delete("%1");
  f.add(1, { panePid: 424_242 });
  const forfeited = await slotStatus({ ...f.ctx, name: "cutover" });
  assert.equal(forfeited.holder.agent_id, "a0000002", "this is the failure the re-stamp exists to prevent");
  // Replay it with the re-stamp in place.
  const fresh = await setup(t);
  fresh.add(1); fresh.add(2);
  await requestSlot({ ...fresh.ctx, name: "cutover", agentId: "a0000001", reason: "holder", env: fresh.as(1, "a0000001") });
  await requestSlot({ ...fresh.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: fresh.as(2, "a0000002") });
  fresh.world.delete("%1");
  const newBinding = fresh.add(1, { panePid: 424_242 });
  assert.deepEqual(await restampSlotBindings({ consumer: fresh.ctx.consumer, agentId: "a0000001", binding: newBinding, env: fresh.env, home: fresh.ctx.home }), ["cutover"]);
  const kept = await slotStatus({ ...fresh.ctx, name: "cutover" });
  assert.equal(kept.holder.agent_id, "a0000001", "the respawned agent keeps its slot");
  assert.equal(kept.holder.binding.panePid, 424_242);
});

test("--reason is required, and the granted line reproduces the observed transcript", async (t) => {
  const f = await setup(t);
  f.add(1);
  await assert.rejects(requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "  ", env: f.as(1, "a0000001") }),
    (error) => error instanceof TopologyError && error.code === "TOPOLOGY_SLOT_REASON_REQUIRED");
  await assert.rejects(requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", env: f.as(1, "a0000001") }),
    (error) => error.code === "TOPOLOGY_SLOT_REASON_REQUIRED");
  const { formatSlot } = await import("../../topology/lib/slots.mjs");
  const view = await requestSlot({ ...f.ctx, name: "cutover", agentId: "e5f6a7b8", reason: "TM-221", env: f.as(1, "e5f6a7b8") });
  assert.equal(formatSlot(view).split("\n")[0], "SERIAL SLOT GRANTED: cutover to e5f6a7b8 for TM-221",
    "the observed transcript line, verbatim, so the hand-rolled heredoc gets deleted rather than reworded");
});

test("a request from outside tmux is refused rather than parked forever", async (t) => {
  const f = await setup(t);
  f.add(1);
  await assert.rejects(requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "no terminal", env: f.env }),
    (error) => error instanceof TopologyError && error.code === "TOPOLOGY_SLOT_BINDING_REQUIRED");
  await assert.rejects(requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "gone", env: { ...f.env, TMUX: `${SERVER},99,0`, TMUX_PANE: "%404" } }),
    (error) => error.code === "TOPOLOGY_SLOT_BINDING_REQUIRED");
});

test("slot status with no name reconciles every slot in the repository", async (t) => {
  const f = await setup(t);
  f.add(1); f.add(2);
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "one", env: f.as(1, "a0000001") });
  await requestSlot({ ...f.ctx, name: "deploy-safe", agentId: "a0000002", reason: "two", env: f.as(2, "a0000002") });
  const all = await slotStatus({ ...f.ctx });
  assert.deepEqual(all.slots.map((slot) => slot.name), ["cutover", "deploy-safe"]);
  f.kill(1);
  const after = await slotStatus({ ...f.ctx });
  assert.equal(after.slots.find((slot) => slot.name === "cutover").holder, null);
  assert.equal(after.slots.find((slot) => slot.name === "deploy-safe").holder.agent_id, "a0000002");
});

test("the supervise tick skips a slot whose lock is busy rather than blocking on it", async (t) => {
  const f = await setup(t);
  f.add(1); f.add(2);
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000001", reason: "holder", env: f.as(1, "a0000001") });
  await requestSlot({ ...f.ctx, name: "cutover", agentId: "a0000002", reason: "waiter", env: f.as(2, "a0000002") });
  const { withLock } = await import("../../topology/lib/lockfile.mjs");
  const identity = await canonicalRepoId(f.ctx.consumer);
  const lock = join(slotsDir(identity, f.env, f.ctx.home), "cutover.lock");
  const started = Date.now();
  const results = await withLock(lock, async () => reconcileSlots({ ...f.ctx, lockTimeoutMs: 100 }));
  assert.deepEqual(results, [], "a busy slot is skipped; the mutation holding the lock reconciles it");
  assert.ok(Date.now() - started < 5000, "and the tick is not parked behind the full lock timeout");
});
