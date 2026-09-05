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
