// Presence v1 header extension (TM-136). Two things are under test and neither is a claim in a doc:
//
//   1. the FROZEN validator, unmodified, accepts every extended fixture and REJECTS the negative
//      one — the mechanical evidence that additive keys are v1 while opening a closed vocabulary
//      is schemaVersion 2;
//   2. an `image-gen` run agent APPEARS in the snapshot instead of vanishing from it.
//
// (2) is the regression test for a verified v1 producer bug: collectPresenceAgents used to
// `continue` past any run agent whose role was outside its private ROLES set, so `add()` never ran
// and the agent had no entry at all. See PRESENCE-HEADER-ADDENDUM.md §7.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { publishPresence } from "../../topology/lib/presence.mjs";

const run = promisify(execFile);
const python = (args, options = {}) => run("python3", args, { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, ...options });
const topology = join(dirname(fileURLToPath(import.meta.url)), "../../topology");
const frozen = join(topology, "fixtures/presence-v1");
const header = join(topology, "fixtures/presence-v1-header");
const put = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); };

test("the frozen validator, unmodified, accepts the extended fixtures and rejects the vocabulary change", async () => {
  const check = await python([join(header, "check.py")]);
  assert.match(check.stdout, /accepts 2 extended fixture/);
  assert.match(check.stdout, /rejects n01-repo-role-designer\.json/);

  // Belt and braces: the same claim without going through our own runner.
  const positives = await python([join(frozen, "validate_presence.py"),
    join(header, "h01-header-full.json"), join(header, "h02-header-sparse.json")]);
  assert.match(positives.stdout, /2 snapshot\(s\) conform/);

  await assert.rejects(
    python([join(frozen, "validate_presence.py"), join(header, "n01-repo-role-designer.json")]),
    (error) => error.code === 1 && /repoRole 'designer'/.test(error.stdout),
    "repoRole: 'designer' must FAIL the frozen validator — that is what makes it schemaVersion 2");
});

test("a run agent whose library role is outside the frozen vocabulary appears, mapped, instead of vanishing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ao-presence-header-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, "repo");
  await mkdir(consumer);
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  const home = join(root, "home");
  const pane = (n) => ({ serverKey: "/tmp/test.sock", serverPid: 100, sessionId: `$${n}`, sessionCreated: 200,
    paneId: `%${n}`, panePid: 300 + n, sessionName: `display-${n}`, command: "kimi", alive: true });
  const panes = [1, 2, 3].map(pane);

  for (const [id, role] of [["draw0001", "image-gen"], ["lead0001", "lead"], ["work0001", "worker"]]) {
    await put(join(consumer, ".bytedesk/agent-orchestration/agents", id, "agent.json"),
      { id, full_name: `Person ${id}`, title: "Engineer", role });
  }
  // All three are RUN agents. `image-gen` and `lead` are both outside the frozen runRole set.
  await put(join(consumer, ".bytedesk/agent-orchestration/runs/root/run.json"), {
    run_id: "root", name: "root", run_dir: join(consumer, ".bytedesk/agent-orchestration/runs/root"),
    consumer, parent: null, depth: 0, agents: [
      { id: "draw0001", role: "image-gen", binding: panes[0] },
      { id: "lead0001", role: "lead", binding: panes[1] },
      { id: "work0001", role: "worker", binding: panes[2] },
    ],
  });

  const snapshot = await publishPresence({ consumer, env, home, listPanesFn: async () => panes });
  assert.equal(snapshot.agents.length, 3, "no run agent may be dropped for an unrecognised role");

  const drawn = snapshot.agents.find((a) => a.agentId === "draw0001");
  assert.ok(drawn, "the image-gen run agent must have an entry, not merely a corrected label");
  assert.equal(drawn.runRole, "worker", "mapped to the nearest legal token");
  assert.equal(drawn.roleName, "image-gen", "the truth rides in the additive key");
  assert.equal(drawn.repoRole, "member", "repoRole stays inside its frozen vocabulary");

  const lead = snapshot.agents.find((a) => a.agentId === "lead0001");
  assert.equal(lead.runRole, "worker", "'lead' is not a runRole either, and is mapped the same way");
  assert.equal(lead.roleName, "lead");
  assert.equal(lead.repoRole, "lead", "the library lead is still the repository lead");

  const worker = snapshot.agents.find((a) => a.agentId === "work0001");
  assert.equal(worker.runRole, "worker", "a legal role is passed through untouched");
  assert.equal(worker.roleName, "worker");

  // The whole point: the extended snapshot is still a valid v1 snapshot.
  await python([join(frozen, "validate_presence.py"), join(env.AGENT_ORCHESTRATION_STATE_HOME, "presence",
    `${snapshot.repositoryKey}.json`)]);
});

// ── D1: an activity reading must say when it was CONFIRMED ───────────────────
// The gateway countersigned the addendum conditionally, and this is the condition. `since` says
// when a state was entered, not when it was last confirmed — and presence and the census run on
// deliberately different clocks (census stale bound 45s, capture budget 8, presence republished
// every ~10s). So a snapshot fresh by every rule the contract enforces could carry an activity
// block up to 45s old, and "confirmed a second ago" and "last confirmed four minutes ago" render
// identically. One of them is a lie.
//
// The frozen validator CANNOT check this — it has no key whitelist and no knowledge of `activity` —
// so it is producer discipline, and this is the gate that keeps it honest.
test("every activity block in the header fixtures carries observedAt", async () => {
  const dir = new URL("../../topology/fixtures/presence-v1-header/", import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json"));
  assert.ok(names.length >= 2, "the fixture set must not be empty, or this test proves nothing");

  let checked = 0;
  for (const name of names) {
    const snapshot = JSON.parse(await readFile(new URL(name, dir), "utf8"));
    for (const agent of snapshot.agents ?? []) {
      const activity = agent.activity;
      if (!activity) continue;
      checked += 1;
      assert.ok(activity.observedAt, `${name} ${agent.agentId}: activity without observedAt is advisory-only to the gateway`);
      assert.match(activity.observedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `${name} ${agent.agentId}: RFC3339 Z, like every other timestamp on the wire`);
      assert.ok(activity.observedAt >= activity.since, `${name} ${agent.agentId}: a state cannot be confirmed before it was entered`);
      if (snapshot.generatedAt) {
        assert.ok(activity.observedAt <= snapshot.generatedAt, `${name} ${agent.agentId}: the census confirms BEFORE presence publishes, never after`);
      }
    }
  }
  assert.ok(checked >= 5, `only ${checked} activity blocks were checked; the fixtures should cover more than that`);
});

test("a live reading is confirmed strictly before the snapshot was generated", async () => {
  // The point of the field is that the two clocks are NOT the same. A fixture where every
  // observedAt equalled generatedAt would assert exactly the coupling D1 says does not exist, and
  // would pass the test above while teaching a consumer the wrong thing.
  const full = JSON.parse(await readFile(new URL("../../topology/fixtures/presence-v1-header/h01-header-full.json", import.meta.url), "utf8"));
  const live = (full.agents ?? []).filter((agent) => agent.activity?.observed === true);
  assert.ok(live.some((agent) => agent.activity.observedAt < full.generatedAt),
    "at least one live reading must show the census lag the field exists to express");
});

test("TM-138: the producer emits the additive header keys, and the FROZEN validator still accepts the result", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ao-presence-keys-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, "repo");
  await mkdir(consumer);
  const stateHome = join(root, "state");
  const env = { AGENT_ORCHESTRATION_STATE_HOME: stateHome };
  const home = join(root, "home");
  const pane = { serverKey: "/tmp/test.sock", serverPid: 100, sessionId: "$1", sessionCreated: 200,
    paneId: "%1", panePid: 301, sessionName: "display-1", command: "claude", alive: true };
  const panes = [pane];

  await put(join(consumer, ".bytedesk/agent-orchestration/agents/work0001/agent.json"),
    { id: "work0001", full_name: "Person work0001", title: "Engineer", role: "worker" });
  await put(join(consumer, ".bytedesk/agent-orchestration/runs/root/run.json"), {
    run_id: "root", name: "root", run_dir: join(consumer, ".bytedesk/agent-orchestration/runs/root"),
    consumer, parent: null, depth: 0, agents: [{ id: "work0001", role: "worker", binding: pane }],
  });

  // Publish once to learn the repository key rather than guessing how the id is hashed.
  const first = await publishPresence({ consumer, env, home, listPanesFn: async () => panes });
  const key = first.repositoryKey;
  assert.ok(key, "precondition: the snapshot names its repository key");

  // Now write the state each additive key is read FROM. Slot and management records are read
  // directly by the producer, which is the point: it must not call the mutating readers.
  await put(join(stateHome, "slots", key, "integration.json"), {
    version: 1, name: "integration", repo_id: "x", next_ticket: "2",
    holder: { agent_id: "work0001", granted_at: "2026-09-09T21:06:41.000Z" },
    queue: [{ agent_id: "other001" }], history: [],
  });
  await put(join(stateHome, "census", `${key}.json`), {
    at: new Date().toISOString(), staleAfterMs: 45000,
    agents: [{ agent_id: "work0001", state: "working", since: "2026-09-09T21:12:55.100Z", observed: true }],
  });
  await put(join(stateHome, "management", key, "TM-999.json"), {
    task: "TM-999", assignee: { agent_id: "work0001", released_at: null },
  });

  const snapshot = await publishPresence({ consumer, env, home, listPanesFn: async () => panes });
  const agent = snapshot.agents.find((a) => a.agentId === "work0001");
  assert.ok(agent, "precondition: the agent is in the snapshot at all");

  assert.equal(agent.activity?.state, "working", "activity comes from the census");
  assert.ok(agent.activity?.observedAt, "activity says WHEN it was confirmed (gateway defect D1)");
  assert.notEqual(agent.activity.observedAt, agent.activity.since, "observedAt is not a copy of since");
  assert.equal(agent.task, "TM-999", "task comes from the management assignee");
  assert.deepEqual(agent.slots?.held, ["integration"], "a held slot is reported");
  assert.deepEqual(snapshot.slotQueues, [
    { name: "integration", holder: "work0001", heldSince: "2026-09-09T21:06:41.000Z", waiting: ["other001"] },
  ], "slotQueues is a TOP-LEVEL key, not an agent one");

  // The whole point of the addendum: none of this is visible to a v1 consumer. Run the FROZEN
  // validator, unmodified, over the producer's REAL output rather than over a hand-written fixture.
  const file = join(root, "produced.json");
  await writeFile(file, JSON.stringify(snapshot, null, 2));
  const verdict = await python([join(frozen, "validate_presence.py"), file]);
  assert.match(verdict.stdout, /conform to Presence v1/, "the extended snapshot must still be valid v1");
});

test("TM-138: an agent with no slot, census, assignment or mail carries none of those keys", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ao-presence-sparse-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, "repo");
  await mkdir(consumer);
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  const home = join(root, "home");
  const pane = { serverKey: "/tmp/test.sock", serverPid: 100, sessionId: "$9", sessionCreated: 200,
    paneId: "%9", panePid: 309, sessionName: "display-9", command: "claude", alive: true };
  await put(join(consumer, ".bytedesk/agent-orchestration/agents/lone0001/agent.json"),
    { id: "lone0001", full_name: "Lone", title: "Engineer", role: "worker" });
  await put(join(consumer, ".bytedesk/agent-orchestration/runs/root/run.json"), {
    run_id: "root", name: "root", run_dir: join(consumer, ".bytedesk/agent-orchestration/runs/root"),
    consumer, parent: null, depth: 0, agents: [{ id: "lone0001", role: "worker", binding: pane }],
  });
  const snapshot = await publishPresence({ consumer, env, home, listPanesFn: async () => [pane] });
  const agent = snapshot.agents.find((a) => a.agentId === "lone0001");
  // Absent, never a placeholder. A null `task` or an empty `slots` would invite a consumer to
  // conclude something was measured and found empty, which is not what happened.
  for (const key of ["activity", "mailboxDepth", "task", "slots"]) {
    assert.equal(key in agent, false, `${key} must be ABSENT when the producer does not know it`);
  }
  assert.deepEqual(snapshot.slotQueues, [], "no slot records means an empty list, not a missing key");
});
