import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { addressOf, displayName, mintId, mintName, mintSpawn, sessionName, titleForRole } from "../../topology/lib/identity.mjs";
import { agentDirs, agentsRoot, createAgent, findLead, listAgents, resolveAgentRef } from "../../topology/lib/agents.mjs";
import { hopExceeded, wouldLoop } from "../../topology/lib/routing.mjs";
import { roleDirs } from "../../topology/lib/resolve.mjs";

const repo = () => mkdtemp(join(tmpdir(), "ao-identity-"));

test("ids and names are minted independently; a name collision never moves an address", async () => {
  const taken = new Set();
  const a = mintName("reviewer", { taken });
  taken.add(a.full_name);
  const b = mintName("reviewer", { taken });
  assert.notEqual(a.full_name, b.full_name, "generator must not hand out a name already in use");

  // The id is not derived from the name in any way: same name data, different ids.
  const ids = new Set(Array.from({ length: 200 }, () => mintId()));
  assert.equal(ids.size, 200, "ids must be independent and unique");
  assert.match(mintId(), /^[a-f][0-9a-f]{7}$/, "a minted id must lead with a letter — see the spec-id invariant test");
  assert.match(mintSpawn(), /^[0-9a-f]{7}$/);
});

test("every built-in role including lead has a title, and people never see an id", () => {
  for (const role of ["lead", "orchestrator", "worker", "designer", "judge", "reviewer", "researcher", "implementer"]) {
    assert.ok(titleForRole(role).length > 0, `${role} needs a title`);
  }
  const agent = { id: "deadbeef", first_name: "Mira", last_name: "Thorne", full_name: "Mira Thorne", title: "Staff Reviewer" };
  const shown = displayName(agent);
  assert.equal(shown, "Mira Thorne, Staff Reviewer");
  assert.ok(!shown.includes("deadbeef"), "a human-facing string must not carry the id");
  assert.equal(addressOf(agent), "deadbeef", "machines address by id");
});

test("a session is one agent's stable address plus a per-spawn discriminator", () => {
  const id = mintId();
  const one = sessionName(id, mintSpawn());
  const two = sessionName(id, mintSpawn());
  assert.notEqual(one, two, "two spawns of one agent must be separately addressable");
  assert.ok(one.startsWith(`${id}-`) && two.startsWith(`${id}-`), "both must resolve to the same agent");
});

test("agents resolve through the same four-tier search path as the other resource types", () => {
  const args = { pluginRoot: "/plugin", consumer: "/repo", home: "/home/x", extra: ["/explicit"] };
  // Same tiers, same order, same consumer fallback to the legacy `.orchestration` layout — the only
  // difference is the kind. Compared against roles rather than restated, so the two cannot drift.
  assert.deepEqual(agentDirs(args), roleDirs(args).map((dir) => dir.replace(/roles$/, "agents")));
  assert.deepEqual(agentDirs(args), [
    "/explicit",
    join("/repo", ".bytedesk", "agent-orchestration", "agents"),
    join("/repo", ".orchestration", "agents"),
    join("/home/x", ".config", "agent-orchestration", "agents"),
    join("/plugin", "agents"),
  ]);
  assert.deepEqual(agentDirs({}), [], "no consumer, no home, no plugin — nothing to search");
});

test("a repo takes exactly one lead, and agents resolve by id or by name", async () => {
  const dir = await repo();
  try {
    const lead = await createAgent(dir, { role: "lead" });
    const rev = await createAgent(dir, { role: "reviewer", reports_to: lead.id });
    const dirs = [agentsRoot(dir)];

    assert.equal((await listAgents(dirs)).length, 2);
    assert.equal((await findLead(dirs)).id, lead.id);
    assert.equal((await resolveAgentRef(rev.id, dirs)).id, rev.id, "resolves by id");
    assert.equal((await resolveAgentRef(rev.full_name, dirs)).id, rev.id, "resolves by name");
    assert.equal((await resolveAgentRef(rev.full_name.toLowerCase(), dirs)).id, rev.id, "name match is case-insensitive");
    // Whatever an operator surface prints has to be a string they can paste straight back in.
    assert.equal((await resolveAgentRef(displayName(rev), dirs)).id, rev.id, "resolves by the displayed \"Name, Title\" form");
    assert.equal((await resolveAgentRef(`  ${rev.full_name} ,  ${rev.title}  `.toUpperCase(), dirs)).id, rev.id, "case and spacing around the comma do not matter");

    await assert.rejects(
      () => createAgent(dir, { role: "lead" }),
      (err) => err.code === "TOPOLOGY_LEAD_EXISTS",
      "a second lead must be refused",
    );

    // A minted name is checked against the roster; a name typed by a person must be too, or two
    // agents share a display identity and `resolveAgentRef` by name becomes a coin toss.
    await assert.rejects(
      () => createAgent(dir, { role: "worker", full_name: rev.full_name }),
      (err) => err.code === "TOPOLOGY_AGENT_NAME_TAKEN",
      "an explicit duplicate name must be refused",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an agent's prompt maps the real work tree and warns against relative paths", async () => {
  const dir = await repo();
  try {
    const agent = await createAgent(dir, { role: "implementer" });
    const { readFile } = await import("node:fs/promises");
    const prompt = await readFile(join(agent._dir, "prompt.md"), "utf8");
    assert.ok(prompt.includes(dir), "the prompt must name the project root");
    assert.match(prompt, /absolute paths/i, "the prompt must warn about relative paths");
    assert.ok(prompt.includes(agent.full_name));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Routing and delegation are exercised end to end, against two real projects, in
// topology-collaboration.test.mjs. Only the pure guards live here.
test("loop and hop guards", () => {
  assert.equal(wouldLoop(["a", "b"], "b"), true);
  assert.equal(wouldLoop(["a"], "b"), false);
  assert.equal(hopExceeded(["a", "b", "c", "d"]), true);
  assert.equal(hopExceeded(["a"]), false);
});
