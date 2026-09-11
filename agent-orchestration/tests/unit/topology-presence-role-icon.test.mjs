// TM-168 — role icons on presence and census.
//
// What is under test, each as behaviour rather than a claim in a document:
//   * every presence entry carries a computed roleIcon + roleLabel, including the entries that have
//     no library definition or a role the registry does not know;
//   * the icon is computed AFTER the first-join roleName overwrite, so it follows the run role;
//   * census rows and tombstones carry the same pair presence computed, and only a registry pair
//     ever reaches formatCensus's terminal output;
//   * the fixtures, the generated map and the documents' tables all come from the registry, and the
//     frozen and signed artifacts keep their recorded hashes.
// No tmux: panes are injected through listPanesFn, exactly as the other presence tests do.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { NESTED_TEAM_ICON, ROLE_ICON_MAP, roleVisual } from "../../topology/lib/identity.mjs";
import { publishPresence } from "../../topology/lib/presence.mjs";
import { formatCensus, takeCensus } from "../../topology/lib/census.mjs";
import { canonicalRepoId } from "../../topology/lib/repoid.mjs";

const run = promisify(execFile);
const python = (args) => run("python3", args, { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const topology = join(packageRoot, "topology");
const fixtures = join(topology, "fixtures/presence-role-icon");
const put = async (path, value) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); };

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const HOSTILE = `${ESC}]0;owned${BEL}lead`;
// C0, DEL and C1 — every byte a terminal reads as the start of a control or escape sequence.
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]");
const FALLBACK = roleVisual();
const pick = (entry) => ({ roleIcon: entry.roleIcon, roleLabel: entry.roleLabel });
const pane = (n, over = {}) => ({ serverKey: "/tmp/test.sock", serverPid: 100, sessionId: `$${n}`, sessionCreated: 200,
  paneId: `%${n}`, panePid: 300 + n, sessionName: `display-${n}`, command: "claude", alive: true, ...over });

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), "ao-role-icon-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, "repo");
  await mkdir(consumer);
  return { root, consumer, env: { AGENT_ORCHESTRATION_STATE_HOME: join(root, "state") }, home: join(root, "home") };
}
async function library(ctx, id, role, binding = null) {
  const dir = join(ctx.consumer, ".bytedesk/agent-orchestration/agents", id);
  await put(join(dir, "agent.json"), { id, full_name: `Person ${id}`, title: "Engineer", role });
  if (binding) await put(join(dir, "session.json"), { agent_id: id, binding, ready: true });
}
async function workflow(ctx, id, agents, { depth = 0, parent = null } = {}) {
  const dir = join(ctx.consumer, ".bytedesk/agent-orchestration/runs", id);
  await put(join(dir, "run.json"), { run_id: id, name: id, run_dir: dir, consumer: ctx.consumer, parent, depth, agents });
  return dir;
}
const publish = (ctx, panes) => publishPresence({ consumer: ctx.consumer, env: ctx.env, home: ctx.home, listPanesFn: async () => panes });
const produced = (ctx, snapshot) => join(ctx.env.AGENT_ORCHESTRATION_STATE_HOME, "presence", `${snapshot.repositoryKey}.json`);

test("presence: a lead in its run, a run worker, a child-run member, an unknown session and hostile roles each get a computed icon", async (t) => {
  const ctx = await repository(t);
  const panes = [1, 2, 3, 4, 5, 6].map((n) => pane(n));
  await library(ctx, "lead0001", "lead", panes[0]);
  await library(ctx, "work0001", "worker");
  await library(ctx, "impl0001", "implementer");
  await library(ctx, "evil0001", HOSTILE, panes[5]);          // hostile LIBRARY role, standing
  const root = await workflow(ctx, "root", [
    { id: "lead0001", role: "orchestrator", binding: panes[0] },
    { id: "work0001", role: "worker", binding: panes[1] },
    { id: "host0001", role: HOSTILE, binding: panes[4] },       // hostile DECLARED run role
  ]);
  await workflow(ctx, "child", [{ id: "impl0001", role: "implementer", binding: panes[2] }],
    { depth: 1, parent: { run_id: "root", run_dir: root, chain: ["root"] } });
  const { id: repoId } = await canonicalRepoId(ctx.consumer);
  await put(join(ctx.env.AGENT_ORCHESTRATION_STATE_HOME, "enrollments/enrolled/ghost.json"),
    { repo_id: repoId, agent_id: "ghost001", binding: panes[3] });

  const snapshot = await publish(ctx, panes);
  const by = (id) => snapshot.agents.find((a) => a.agentId === id);
  assert.equal(snapshot.agents.length, 6, "every pane has an entry; an unknown role is never a reason to drop one");

  const lead = by("lead0001");
  assert.equal(lead.repoRole, "lead");
  assert.equal(lead.runRole, "orchestrator", "precondition: the lead coordinates the run");
  assert.deepEqual(pick(lead), roleVisual({ role: "lead" }), "a repository lead shows the lead icon even inside its run");

  assert.deepEqual(pick(by("work0001")), roleVisual({ role: "worker" }));

  const child = by("impl0001");
  assert.equal(child.memberships[0].depth, 1, "precondition: a member of the NESTED run");
  assert.deepEqual(pick(child), roleVisual({ role: "implementer" }), "a child-run member shows its own run role");
  assert.equal(snapshot.agents.some((a) => a.roleIcon === NESTED_TEAM_ICON), false,
    "a nested team has no pane, so the team icon never appears on a presence entry");

  const ghost = by("ghost001");
  assert.equal(ghost.displayName, "Unenrolled agent", "precondition: no library definition");
  assert.equal("roleName" in ghost, false);
  assert.deepEqual(pick(ghost), FALLBACK);

  for (const id of ["host0001", "evil0001"]) {
    assert.deepEqual(pick(by(id)), FALLBACK, `${id}: a role the registry does not know falls back, it is never echoed`);
  }
  for (const agent of snapshot.agents) {
    assert.equal(typeof agent.roleIcon, "string", `${agent.agentId}: roleIcon`);
    assert.equal(typeof agent.roleLabel, "string", `${agent.agentId}: roleLabel`);
    assert.equal(CONTROL.test(agent.roleIcon) || CONTROL.test(agent.roleLabel), false, `${agent.agentId}: no escape data`);
  }

  // The producer's REAL output: valid v2, and it passes the role-icon rules the gateway is asked to sign.
  await python([join(topology, "fixtures/presence-v2/validate_presence_v2.py"), produced(ctx, snapshot)]);
  const rules = await python([join(fixtures, "check.py"), "--snapshot", produced(ctx, snapshot)]);
  assert.match(rules.stdout, /role-icon rules pass for 6 agent\(s\)/);
});

test("roleIcon follows the first-join roleName overwrite rather than the library role", async (t) => {
  const ctx = await repository(t);
  const panes = [pane(1)];
  await library(ctx, "rev00001", "reviewer", panes[0]);

  const standing = (await publish(ctx, panes)).agents[0];
  assert.deepEqual(pick(standing), roleVisual({ role: "reviewer" }), "control: standing, it shows its library role");

  await workflow(ctx, "root", [{ id: "rev00001", role: "judge", binding: panes[0] }]);
  const joined = (await publish(ctx, panes)).agents[0];
  assert.equal(joined.roleName, "judge", "precondition: the overwrite moved roleName to the run role");
  assert.equal(joined.repoRole, "reviewer", "repository standing is unchanged");
  assert.deepEqual(pick(joined), roleVisual({ role: "judge" }), "the icon moved with roleName, so the two never disagree");
});

test("census rows and tombstones carry the icon presence computed, and only a registry pair", async (t) => {
  const ctx = await repository(t);
  const panes = [pane(1), pane(2)];
  await library(ctx, "lead0001", "lead", panes[0]);
  await library(ctx, "work0001", "worker");
  await workflow(ctx, "root", [{ id: "work0001", role: "worker", binding: panes[1] }]);
  const roster = (await publish(ctx, panes)).agents;
  const leadRow = roster.find((a) => a.agentId === "lead0001");
  const workRow = roster.find((a) => a.agentId === "work0001");
  assert.ok(leadRow && workRow, "precondition: presence observed both agents");
  const identity = { id: ctx.root, kind: "path", git_common_dir: null };
  const census = (input) => takeCensus({ env: ctx.env, home: ctx.home, consumer: ctx.consumer },
    { identity, memo: new Map(), capture: async () => "done\n> ", now: 1_000_000, write: false, ...input });

  const first = await census({ agents: roster, panes, previous: null });
  assert.equal(first.agents.length, 2);
  for (const row of first.agents) {
    assert.deepEqual(pick(row), pick(roster.find((a) => a.agentId === row.agentId)), `${row.agentId}: census and presence carry the same pair`);
  }

  // The worker's pane leaves the listing: its row survives one tick as a tombstone, same icon.
  const second = await census({ agents: [leadRow], panes: [panes[0]], previous: first, now: 1_000_001 });
  const tombstone = second.agents.find((a) => a.agentId === "work0001");
  assert.equal(tombstone?.carriedForward, true, "precondition: a tombstone");
  assert.deepEqual(pick(tombstone), pick(workRow));

  // A roster row, or a prior document, that is not a registry pair never reaches a row.
  const lead = roleVisual({ role: "lead" });
  const tampered = await census({
    agents: [{ ...leadRow, roleIcon: `${ESC}]0;x${BEL}`, roleLabel: "Lead" }, { ...workRow, roleIcon: lead.roleIcon, roleLabel: "Worker" }],
    panes,
    previous: { agents: [{ agentId: "gone0001", state: "idle", roleIcon: `${lead.roleIcon}${ESC}[2J`, roleLabel: "Lead" }] },
  });
  assert.equal(tampered.agents.length, 3, "precondition: two rows and one tombstone");
  for (const row of tampered.agents) assert.deepEqual(pick(row), FALLBACK, `${row.agentId}: an unregistered pair falls back`);
});

test("formatCensus puts the role icon beside the name with its label, and keeps the state glyph first", () => {
  const lead = roleVisual({ role: "lead" });
  const row = (over) => ({ agentId: "k3n8vq2a", displayName: "Priya Raman", state: "idle", durationMs: 5000,
    reason: "no spinner and nothing waiting on a human", dispatchable: true, ...over });
  const text = formatCensus({ captures: 1, tickMs: 3, agents: [
    row({ ...lead }),
    row({ agentId: "s2v7ho3j", displayName: "Kenji Watanabe", state: "working", roleIcon: `${ESC}]0;owned${BEL}`, roleLabel: "Lead" }),
    row({ agentId: "f9k1ps5u", displayName: "Unenrolled agent" }),
  ] });
  const [leadLine, hostileLine, unknownLine] = text.split("\n");
  assert.match(leadLine, new RegExp(`^○ ${lead.roleIcon} Priya Raman +Lead +idle +5s  no spinner`));
  assert.match(hostileLine, new RegExp(`^• ${FALLBACK.roleIcon} Kenji Watanabe +Agent +working `), "a tampered icon prints the fallback");
  assert.match(unknownLine, new RegExp(`^○ ${FALLBACK.roleIcon} f9k1ps5u +Agent +idle `), "a row with no icon at all prints the fallback");
  assert.equal(CONTROL.test(text.replaceAll("\n", "")), false, "no escape byte reaches the terminal");
});

// ── Contract artifacts ────────────────────────────────────────────────────────

test("the role-icon fixture check accepts every h fixture and rejects every n fixture for its declared reason", async () => {
  const { stdout } = await python([join(fixtures, "check.py")]);
  assert.match(stdout, /h01-v1-role-icons\.json: validate_presence\.py accepts it and the role-icon rules pass for 5 agent/);
  assert.match(stdout, /h02-v2-fallbacks\.json: validate_presence_v2\.py accepts it and the role-icon rules pass for 5 agent/);
  assert.match(stdout, /n01-icon-as-repo-role\.json: the frozen validator rejects it on repoRole/);
  for (const name of ["n02-lead-icon-on-worker", "n03-escape-in-icon", "n04-icon-without-label"]) {
    assert.match(stdout, new RegExp(`${name}\\.json: the frozen validator accepts it and the role-icon rules reject it`));
  }
  assert.match(stdout, /role-icon extension conforms/);
});

const codepoints = (s) => [...s].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
const withCodepoints = (visual) => ({ ...visual, codepoints: codepoints(visual.roleIcon) });

test("role-icon-map.json is the registry, not a copy of it", async () => {
  const map = JSON.parse(await readFile(join(fixtures, "role-icon-map.json"), "utf8"));
  assert.deepEqual(map, {
    roles: Object.fromEntries(Object.keys(ROLE_ICON_MAP).map((role) => [role, withCodepoints(roleVisual({ role }))])),
    nestedTeam: withCodepoints(roleVisual({ nestedTeam: true })),
    unknown: withCodepoints(FALLBACK),
  });
  assert.ok(Object.keys(map.roles).length >= 10, "the map must not be empty, or this test proves nothing");
});

test("the mapping table in the addendum and in the countersignature request is rendered from the registry", async () => {
  const row = (name, visual) => `| ${name} | ${visual.roleIcon} | ${codepoints(visual.roleIcon)} | ${visual.roleLabel} |`;
  const expected = [
    "| Effective role | `roleIcon` | Code points | `roleLabel` |",
    "|---|---|---|---|",
    ...Object.keys(ROLE_ICON_MAP).map((role) => row(`\`${role}\``, roleVisual({ role }))),
    row("nested team (no pane; never on a presence entry)", roleVisual({ nestedTeam: true })),
    row("any other, custom or missing role", FALLBACK),
  ].join("\n");
  for (const name of ["PRESENCE-ROLE-ICON-ADDENDUM.md", "ROLE-ICON-COUNTERSIGNATURE-REQUEST.md"]) {
    const doc = await readFile(join(topology, name), "utf8");
    const block = /<!-- role-icon-map:begin -->\n([\s\S]*?)<!-- role-icon-map:end -->/.exec(doc)?.[1];
    assert.ok(block, `${name} must keep its generated table markers`);
    assert.equal(block.trim(), expected, `${name}: the table must be the registry, not a retyped copy`);
  }
});

test("every artifact recorded in ROLE-ICON-HASHES.txt still has its recorded hash", async () => {
  const lines = (await readFile(join(fixtures, "ROLE-ICON-HASHES.txt"), "utf8")).split("\n").filter((l) => /^[0-9a-f]{64}  /.test(l));
  assert.ok(lines.length >= 25, `only ${lines.length} hashes recorded; the frozen, signed and new sets should all be there`);
  for (const line of lines) {
    const [hash, path] = [line.slice(0, 64), line.slice(66)];
    const actual = createHash("sha256").update(await readFile(join(packageRoot, path))).digest("hex");
    assert.equal(actual, hash, `${path} changed after its hash was recorded`);
  }
});
