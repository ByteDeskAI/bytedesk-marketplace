// TM-274 / ADR-0030 — the presence session-names addendum.
//
// What is under test, each as behaviour rather than a claim in a document:
//   * the producer's REAL output for every session kind under the new names still passes the v2
//     validator and the addendum's name rules, and a run of one agent is published as `run`;
//   * the fixture check accepts every h fixture and rejects or misreads every n fixture as declared;
//   * every hashed artifact, frozen ones included, still has its recorded hash — and the hash check
//     itself fails when one byte changes.
// No tmux: panes are injected through listPanesFn, exactly as the other presence tests do.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { publishPresence } from "../../topology/lib/presence.mjs";
import { canonicalRepoId } from "../../topology/lib/repoid.mjs";

const run = promisify(execFile);
const python = (args) => run("python3", args, { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const topology = join(packageRoot, "topology");
const fixtures = join(topology, "fixtures/presence-session-names");
const HASHES = "topology/fixtures/presence-session-names/SESSION-NAMES-HASHES.txt";
const put = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); };
const pane = (n, over = {}) => ({ serverKey: "/tmp/test.sock", serverPid: 100, sessionId: `$${n}`, sessionCreated: 200,
  paneId: `%${n}`, panePid: 300 + n, sessionName: `display-${n}`, command: "claude", alive: true, ...over });
const meta = (over) => ({ id: "01J0000000000000000000000A", node: "agents1", repo: "bytedesk-marketplace", ...over });

test("presence publishes every kind under the new names, unchanged in shape, and a one-agent run as run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ao-session-names-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, "repo");
  await mkdir(consumer);
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") };
  const lib = async (id, role, binding = null) => {
    const dir = join(consumer, ".bytedesk/agent-orchestration/agents", id);
    await put(join(dir, "agent.json"), { id, full_name: `Person ${id}`, title: "Engineer", role });
    if (binding) await put(join(dir, "session.json"), { agent_id: id, binding, ready: true });
  };
  const workflow = async (id, name, agents) => {
    const dir = join(consumer, ".bytedesk/agent-orchestration/runs", id);
    await put(join(dir, "run.json"), { run_id: id, name, run_dir: dir, consumer, parent: null, depth: 0, agents });
  };
  const team = "core--agents1--bytedesk-marketplace--parallel-review--ada";
  const panes = [
    pane(1, { sessionName: "agents1--bytedesk-marketplace--lead--priya", identity: meta({ agent: "lead0001", role: "lead", kind: "role-session" }) }),
    pane(2, { sessionName: "ao-rev00001" }),   // legacy role-session: no options, still recognised
    pane(3, { sessionName: "agents1--bytedesk-marketplace--worker--kenji", identity: meta({ agent: "work0001", role: "worker", run: "solo", workflow: "fix-flaky-test", kind: "spawn" }) }),
    pane(4, { sessionId: "$9", sessionName: team, identity: meta({ agent: "team0001", role: "run", team: "core", run: "pr", workflow: "parallel-review", kind: "run" }) }),
    pane(5, { sessionId: "$9", sessionName: team, identity: meta({ agent: "team0002", role: "run", team: "core", run: "pr", workflow: "parallel-review", kind: "run" }) }),
    pane(6, { sessionName: "zsh" }),
  ];
  await lib("lead0001", "lead", panes[0]);
  await lib("rev00001", "reviewer", panes[1]);
  await lib("work0001", "worker");
  await lib("team0001", "worker");   // one standing reviewer per repo; the run role is separate
  await lib("team0002", "worker");
  // run.json carries no `spawn` token: that is what ao's launch writes (addendum §3.3).
  await workflow("solo", "fix-flaky-test", [{ id: "work0001", role: "worker", binding: panes[2] }]);
  await workflow("pr", "parallel-review", [{ id: "team0001", role: "reviewer", binding: panes[3] }, { id: "team0002", role: "judge", binding: panes[4] }]);
  const { id: repoId } = await canonicalRepoId(consumer);
  await put(join(env.AGENT_ORCHESTRATION_STATE_HOME, "enrollments/pending/ext.json"), { repo_id: repoId, agent_id: "ext00001", binding: panes[5] });

  const snapshot = await publishPresence({ consumer, env, home: join(root, "home"), listPanesFn: async () => panes });
  const kinds = Object.fromEntries(snapshot.agents.map((a) => [a.agentId, [a.session.kind, a.session.sessionName, a.session.spawn]]));
  assert.equal(snapshot.schemaVersion, 2, "the shape is unchanged, so the version is too");
  assert.deepEqual(kinds, {
    lead0001: ["role-session", "agents1--bytedesk-marketplace--lead--priya", null],
    rev00001: ["role-session", "ao-rev00001", null],
    work0001: ["run", "agents1--bytedesk-marketplace--worker--kenji", null],   // @ao-kind says spawn; session.kind is run
    team0001: ["run", team, null],
    team0002: ["run", team, null],
    ext00001: ["external", "zsh", null],
  });
  assert.equal(snapshot.agents.find((a) => a.agentId === "lead0001").repoRole, "lead");

  const file = join(env.AGENT_ORCHESTRATION_STATE_HOME, "presence", `${snapshot.repositoryKey}.json`);
  await python([join(topology, "fixtures/presence-v2/validate_presence_v2.py"), file]);
  const rules = await python([join(fixtures, "check.py"), "--snapshot", file]);
  assert.match(rules.stdout, /session-name rules pass for 6 agent\(s\)/);
});

test("the session-name fixture check accepts every h fixture and rejects or misreads every n fixture as declared", async () => {
  const { stdout } = await python([join(fixtures, "check.py")]);
  assert.match(stdout, /h01-v2-new-names\.json: validate_presence_v2\.py accepts it and the session-name rules pass for 6 agent/);
  assert.match(stdout, /h02-v2-legacy-lead\.json: validate_presence_v2\.py accepts it and the session-name rules pass for 4 agent/);
  assert.match(stdout, /n01-spawn-kind-new-name\.json: validate_presence_v2\.py rejects it \(spawn sessionName must be <agentId>-<spawn>\)/);
  assert.match(stdout, /n02-lead-name-on-external\.json: valid, and parsing the name gets it wrong .*'repoRole': 'lead'/);
  assert.match(stdout, /n03-workflow-named-reviewer\.json: valid, and parsing the name gets it wrong .*'repoRole': 'reviewer'/);
  assert.match(stdout, /session-names addendum conforms/);
});

/** Every `<sha256>  <path>` line in the hashes file under `base`, recomputed: the mismatches. */
async function hashMismatches(base) {
  const lines = (await readFile(join(base, HASHES), "utf8")).split("\n").filter((l) => /^[0-9a-f]{64}  /.test(l));
  const bad = [];
  for (const line of lines) {
    const [hash, path] = [line.slice(0, 64), line.slice(66)];
    const actual = createHash("sha256").update(await readFile(join(base, path))).digest("hex");
    if (actual !== hash) bad.push(path);
  }
  return { count: lines.length, bad };
}

test("every artifact recorded in SESSION-NAMES-HASHES.txt, frozen ones included, still has its recorded hash", async () => {
  const { count, bad } = await hashMismatches(packageRoot);
  assert.ok(count >= 46, `only ${count} hashes recorded; the frozen, signed, prior and new sets should all be there`);
  assert.deepEqual(bad, [], "these files changed after their hash was recorded");

  // The frozen and prior sections must agree, line for line, with the record they were copied from.
  const prior = (await readFile(join(topology, "fixtures/presence-role-icon/ROLE-ICON-HASHES.txt"), "utf8")).split("\n").filter((l) => /^[0-9a-f]{64}  /.test(l));
  const ours = new Set((await readFile(join(packageRoot, HASHES), "utf8")).split("\n"));
  assert.deepEqual(prior.filter((l) => !ours.has(l)), [], "every line of ROLE-ICON-HASHES.txt is carried over unchanged");
  for (const frozen of ["topology/PRESENCE-CONTRACT.md", "topology/fixtures/presence-v1/validate_presence.py", "topology/fixtures/presence-v2/validate_presence_v2.py"]) {
    assert.ok([...ours].some((l) => l.endsWith(`  ${frozen}`)), `${frozen} is recorded`);
  }
});

test("the hash check fails when one byte of a recorded file changes", async (t) => {
  // A check that cannot report a mismatch is not a check: copy the recorded tree, flip one byte of
  // the frozen contract, and require the same function to name exactly that file.
  const scratch = await mkdtemp(join(tmpdir(), "ao-session-names-hash-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  await cp(topology, join(scratch, "topology"), { recursive: true });
  const target = join(scratch, "topology/PRESENCE-CONTRACT.md");
  const bytes = await readFile(target);
  bytes[0] ^= 1;
  await writeFile(target, bytes);
  const { bad } = await hashMismatches(scratch);
  assert.deepEqual(bad, ["topology/PRESENCE-CONTRACT.md"]);
});
