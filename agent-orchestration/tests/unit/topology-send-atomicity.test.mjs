// TM-143. A send that is refused for ONE recipient must not leave the message delivered to any
// other recipient. The refusals that used to fire inside the per-recipient write loop —
// TOPOLOGY_ROUTE_BLOCKED, TOPOLOGY_UNKNOWN_AGENT, TOPOLOGY_COORDINATOR_NOT_A_WORKER — threw with
// the envelope already persisted and, once several recipients were addressed at once, with the
// earlier ones already holding an inbox file.
//
// These tests assert on the FILESYSTEM rather than on the error, because the error was never the
// problem: the old code raised exactly the same error while quietly delivering to everybody ahead
// of the refused recipient.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sendMessage } from "../../topology/lib/mailbox.mjs";
import { readJson, writeJson } from "../../topology/lib/util.mjs";

const WORKERS = ["w-one", "w-two", "w-three"];
const COORDINATOR = "the-conductor";

/** A run with three ordinary workers and one coordinator, all local to the same project. */
async function runWithCoordinator() {
  const dir = await mkdtemp(join(tmpdir(), "ao-send-atomic-"));
  const runDir = join(dir, ".bytedesk", "agent-orchestration", "runs", "demo");
  for (const id of [...WORKERS, COORDINATOR]) {
    await mkdir(join(runDir, "agents", id, "inbox"), { recursive: true });
    await mkdir(join(runDir, "agents", id, "outbox"), { recursive: true });
  }
  await writeJson(join(runDir, "run.json"), {
    run_id: "demo", consumer: dir, sequence: 0,
    agents: [
      ...WORKERS.map((id) => ({ id, role: "worker", token: `tok-${id}` })),
      { id: COORDINATOR, role: "orchestrator", token: "tok-conductor", coordinates_only: true },
    ],
  });
  return { dir, runDir };
}

const inboxOf = (runDir, id) => readdir(join(runDir, "agents", id, "inbox")).catch(() => []);

/** Everything the run record and the inboxes say about deliveries, in one comparable shape. */
async function traces(runDir) {
  const run = await readJson(join(runDir, "run.json"));
  const inboxes = {};
  for (const id of [...WORKERS, COORDINATOR]) inboxes[id] = (await inboxOf(runDir, id)).sort();
  return {
    sequence: run.sequence ?? 0,
    envelopes: Object.keys(run.message_envelopes ?? {}).sort(),
    deliveries: Object.keys(run.message_deliveries ?? {}).sort(),
    inboxes,
  };
}

test("a coordinator LAST in the list refuses the whole send: nobody ahead of it is delivered to", async (t) => {
  const { dir, runDir } = await runWithCoordinator();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const before = await traces(runDir);

  await assert.rejects(
    () => sendMessage({ runDir, fromProject: dir, from: "operator", to: [...WORKERS, COORDINATOR], stage: "implement", body: "Please write the parser." }),
    (error) => error.code === "TOPOLOGY_COORDINATOR_NOT_A_WORKER",
  );

  const after = await traces(runDir);
  for (const id of WORKERS) {
    assert.deepEqual(after.inboxes[id], [], `${id} is ahead of the refused recipient and must have NO inbox file`);
  }
  assert.deepEqual(after.inboxes[COORDINATOR], [], "the refused recipient itself has nothing either");
  assert.deepEqual(after.envelopes, [], "a send that reached nobody must not leave an envelope behind (the TM-142 invariant)");
  assert.deepEqual(after.deliveries, [], "the run record must not claim a message that was never delivered to anyone");
  assert.deepEqual(after, before, "the refusal leaves run.json byte-identical, sequence included");
});

test("an unknown agent LAST in the list refuses the whole send, and burns no sequence number", async (t) => {
  const { dir, runDir } = await runWithCoordinator();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const before = await traces(runDir);

  await assert.rejects(
    () => sendMessage({ runDir, fromProject: dir, from: "operator", to: [...WORKERS, "nobody-here"], stage: "ask", body: "Anyone home?" }),
    (error) => error.code === "TOPOLOGY_UNKNOWN_AGENT",
  );

  assert.deepEqual(await traces(runDir), before, "nothing written, no number consumed");
});

test("a router that blocks the LAST recipient refuses the whole send", async (t) => {
  const { dir, runDir } = await runWithCoordinator();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const before = await traces(runDir);
  const routed = [];
  const route = async ({ to }) => {
    routed.push(to);
    return to === WORKERS[2] ? { blocked: "policy", reason: "not while the cutover lock is held" } : { deliver_to: to, redirected: false };
  };

  await assert.rejects(
    () => sendMessage({ runDir, fromProject: dir, from: "operator", to: WORKERS, stage: "ask", body: "Status?", route }),
    (error) => error.code === "TOPOLOGY_ROUTE_BLOCKED" && /cutover lock/.test(error.message),
  );

  assert.deepEqual(await traces(runDir), before, "the two admitted recipients ahead of the blocked one keep empty inboxes");
  assert.deepEqual(routed, WORKERS, "every recipient is admitted once, in order, before anything is written");
});

test("the router is consulted exactly once per recipient — the write pass reuses the admitted decision", async (t) => {
  const { dir, runDir } = await runWithCoordinator();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  const route = async ({ to }) => {
    calls.push(to);
    return { deliver_to: to, redirected: false };
  };

  const sent = await sendMessage({ runDir, fromProject: dir, from: "operator", to: WORKERS, stage: "ask", body: "Status?", route });

  assert.deepEqual(calls, WORKERS, "one admission per recipient, and no second call at write time");
  assert.deepEqual(sent.deliveries.map((d) => d.agent), WORKERS);
  for (const id of WORKERS) assert.equal((await inboxOf(runDir, id)).length, 1, `${id} has exactly one inbox file`);
});

test("the control: with no refused recipient, every addressed agent is delivered to", async (t) => {
  const { dir, runDir } = await runWithCoordinator();
  t.after(() => rm(dir, { recursive: true, force: true }));

  const sent = await sendMessage({ runDir, fromProject: dir, from: "operator", to: WORKERS, stage: "implement", body: "Please write the parser." });

  assert.deepEqual(sent.deliveries.map((d) => d.agent), WORKERS);
  const after = await traces(runDir);
  assert.equal(after.envelopes.length, 1);
  assert.equal(after.deliveries.length, 1);
  for (const id of WORKERS) assert.equal(after.inboxes[id].length, 1);
  assert.deepEqual(after.inboxes[COORDINATOR], [], "an unaddressed coordinator is untouched");
});
