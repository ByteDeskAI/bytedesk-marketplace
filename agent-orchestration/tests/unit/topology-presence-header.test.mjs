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
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
