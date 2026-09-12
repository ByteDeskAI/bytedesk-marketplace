/** TM-074 — agent-first docs and skills stay honest against lib/ and the 39 MCP tools. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../../lib/mcp.mjs";
import { listSkills } from "../../lib/skills.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(join(PLUGIN, rel), "utf8");

describe("agent-first documentation (TM-074)", () => {
  it("README links docs/agent-first.md and names the four harnesses", () => {
    const readme = read("README.md");
    assert.match(readme, /docs\/agent-first\.md/);
    for (const h of ["Claude Code", "Codex CLI", "Grok", "Kimi Code"]) {
      assert.match(readme, new RegExp(h), `README recipe missing ${h}`);
    }
    assert.match(readme, /ready-for-agent/);
    assert.match(readme, /tm dispatch/);
    assert.match(readme, /tm collect/);
    assert.match(readme, /tm pool/);
  });

  it("docs/agent-first.md covers every agent-first CLI verb, flags, and refusals", () => {
    const doc = read("docs/agent-first.md");
    for (const verb of ["caps", "dispatch", "pool", "collect", "agent", "events"]) {
      assert.match(doc, new RegExp(`tm ${verb}`), `missing tm ${verb}`);
    }
    assert.match(doc, /--backend/);
    assert.match(doc, /--steal/);
    assert.match(doc, /--dry-run/);
    assert.match(doc, /--follow/);
    assert.match(doc, /--since/);
    assert.match(doc, /--json/);
    assert.match(doc, /topology → tmux → orchestration → manual/);
    assert.match(doc, /dispatch\.backends/);
    assert.match(doc, /dispatch\.heartbeatSeconds/);
    assert.match(doc, /agentTtlMinutes/);
    assert.match(doc, /dispatch\.enabled/);
    assert.match(doc, /dispatch\.poolWip/);
    assert.match(doc, /dispatch\.pollSeconds/);
    assert.match(doc, /gateStart|WIP/);
    assert.match(doc, /never dispatched|was never dispatched/);
  });

  it("parity table lists all 39 MCP tools and the HTTP twins for dispatch/collect/caps/agents", () => {
    const doc = read("docs/agent-first.md");
    assert.equal(TOOLS.length, 39, `expected 39 MCP tools, got ${TOOLS.length}`);
    for (const t of TOOLS) {
      assert.match(doc, new RegExp(`\`${t.name}\``), `docs/agent-first.md missing ${t.name}`);
    }
    assert.match(doc, /POST \/api\/task\/:id\/dispatch/);
    assert.match(doc, /POST \/api\/task\/:id\/collect/);
    assert.match(doc, /GET \/api\/caps/);
    assert.match(doc, /GET \/api\/agents/);
  });

  /**
   * TM-180. The docs described a world that no longer exists: a label somebody types, and a
   * pool somebody opts into. These assertions are the ones that FAIL if that wording comes
   * back — a positive check for each new truth, and one negative sweep for the old ones.
   */
  it("the agent-first docs describe computed readiness and the human veto", () => {
    for (const rel of ["README.md", "AGENTS.md", "docs/agent-first.md"]) {
      const body = read(rel);
      assert.match(body, /ready-for-human/, `${rel} never names the veto label`);
      assert.match(body, /triage/i, `${rel} never mentions triage`);
    }
    const doc = read("docs/agent-first.md");
    assert.match(doc, /dispatch\.autoReady/);
    assert.match(doc, /tm triage/);
    assert.match(doc, /--human/, "the create-time veto flag");
    assert.match(read("README.md"), /triagedBy: human|triagedBy` ?: ?`human|stamps `triagedBy: human`/);
  });

  it("the agent-first docs describe the pool as on by default, with a brake", () => {
    const doc = read("docs/agent-first.md");
    assert.match(doc, /on by default/i);
    assert.match(doc, /dispatch\.maxFailures/);
    assert.match(doc, /tm pool resume/);
    assert.match(doc, /dispatch\.maxRuntimeMinutes/);
    assert.match(read("README.md"), /on by default/i);
    // The switch is now an OFF switch. `enabled: false` is the sentence that has to be there.
    assert.match(doc, /dispatch\.enabled: false|dispatch\.enabled` is `false`/);
  });

  it("the agent-first docs describe the worker guard and the PR finish line", () => {
    const doc = read("docs/agent-first.md");
    assert.match(doc, /gh pr create/);
    assert.match(doc, /git push -u origin/);
    assert.match(doc, /TM_DISPATCH_WORKER/);
    assert.match(doc, /gh pr merge/, "the guard's headline refusal");
    assert.match(doc, /never merge/i);
    for (const rel of ["README.md", "AGENTS.md", "docs/use-cases.md", "skills/dispatch/SKILL.md", "skills/implement/SKILL.md"]) {
      assert.match(read(rel), /gh pr create/, `${rel} never states the PR finish line`);
    }
  });

  /**
   * The negative sweep. Every phrase here was true before EP-021 and is now wrong; a doc that
   * says any of them is describing automation nobody can run. This is the check that fails
   * when someone reinstates the old story, which the positive assertions above cannot see.
   */
  it("no doc still calls the pool opt-in, or the triage label hand-applied", () => {
    const stale = /opt-in|opt in|human's go-ahead|dispatch\.enabled true|applied by hand/i;
    for (const rel of [
      "README.md",
      "AGENTS.md",
      "docs/agent-first.md",
      "docs/use-cases.md",
      "skills/pool/SKILL.md",
      "skills/dispatch/SKILL.md",
      "skills/tickets/SKILL.md",
      "skills/implement/SKILL.md",
      "skills/groom/SKILL.md",
    ]) {
      const hit = read(rel).split("\n").find((l) => stale.test(l));
      assert.equal(hit, undefined, `${rel} still says: ${hit}`);
    }
    const pool = listSkills().find((s) => s.name === "pool");
    assert.doesNotMatch(pool.description, /opt-in|opt in/i, "the pool skill's description still says opt-in");
    assert.match(pool.description, /on by default/i);
  });

  it("skills cross-link dispatch → pool → collect → events", () => {
    const chain = {
      dispatch: "pool",
      pool: "collect",
      collect: "events",
      events: "dispatch",
    };
    for (const [from, to] of Object.entries(chain)) {
      const body = read(`skills/${from}/SKILL.md`);
      assert.match(body, new RegExp(`\\[\\[${to}\\]\\]`), `${from} should link [[${to}]]`);
    }
    const skills = listSkills();
    assert.ok(skills.find((s) => s.name === "dispatch").description.includes("ready-for-agent"));
  });
});
