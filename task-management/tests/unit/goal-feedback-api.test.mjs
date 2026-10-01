import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempStore } from "./helpers.mjs";
import { create, read, writeState } from "../../lib/store.mjs";
import { callTool, handleRequest } from "../../lib/mcp.mjs";

const TM = fileURLToPath(new URL("../../bin/tm", import.meta.url));
const admission = { objective: "Complete user journey", criteria: [{ text: "User journey is proven in test" }], authority: { reviewedMerge: true, testTarget: "test", publicRelease: "human", destructive: "human" } };
function cli(p, ...args) {
  return spawnSync(process.execPath, [TM, "goal", ...args, "--json"], { env: { ...process.env, TM_ROOT: p.root }, cwd: p.root, encoding: "utf8" });
}
describe("goal public contracts", () => {
  it("opens over CLI, reloads over MCP/CLI, and returns structured completion refusal", () => {
    const p = tempStore(), epic = create("epic", { title: "Public goal", status: "open" }, "", p);
    const file = join(p.root, "admission.json"); writeFileSync(file, JSON.stringify(admission));
    const opened = cli(p, "open", epic.id, "--file", file);
    assert.equal(opened.status, 0, opened.stderr);
    const output = JSON.parse(opened.stdout);
    assert.equal(output.ok, true);
    assert.equal(callTool("tm_goal_show", { id: epic.id }, p).goal.scopeHash, output.goal.scopeHash);
    assert.equal(JSON.parse(cli(p, "show", epic.id).stdout).goal.criteria[0].id, "AC-001");
    writeFileSync(file, JSON.stringify({ revision: 1, scopeHash: output.goal.scopeHash, artifact: "a".repeat(40), environment: "test" }));
    const refused = cli(p, "complete", epic.id, "--file", file);
    assert.equal(refused.status, 1);
    assert.equal(JSON.parse(refused.stdout).ok, false);
    assert.match(JSON.parse(refused.stdout).error, /assessment/);
    assert.equal(read(epic.id, p).goal.status, "active");
  });
  it("advertises all six tools and preserves the bounded planner read-only boundary", () => {
    const p = tempStore(), epic = create("epic", { title: "MCP goal", status: "open" }, "", p);
    const saved = process.env.TM_MCP_PROFILE;
    try {
      delete process.env.TM_MCP_PROFILE;
      const tools = handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { p }).result.tools.map(t => t.name);
      for (const op of ["open", "show", "finding", "assess", "revise", "complete"]) assert.ok(tools.includes(`tm_goal_${op}`));
      assert.equal(callTool("tm_goal_open", { id: epic.id, input: admission }, p).ok, true);
      process.env.TM_MCP_PROFILE = "planner";
      assert.equal(callTool("tm_goal_show", { id: epic.id }, p).ok, true);
      assert.equal(callTool("tm_goal_complete", { id: epic.id, input: {} }, p).ok, false);
    } finally {
      if (saved === undefined) delete process.env.TM_MCP_PROFILE; else process.env.TM_MCP_PROFILE = saved;
    }
  });
  it("preserves legacy goal import and positional criteria for unadmitted tasks", () => {
    const p = tempStore(), epic = create("epic", { title: "Legacy", status: "open" }, "", p);
    writeState({ activeEpic: epic.id }, p);
    const doc = join(p.root, "legacy.md");
    writeFileSync(doc, "# Goal: Legacy imported goal\n\n## Success criteria\n\n- One verifiable outcome\n");
    const result = cli(p, "import", doc, "--epic", epic.id);
    assert.equal(result.status, 0, result.stderr);
    const task = callTool("tm_goal_import", { content: "# Goal: Another\n\n## Success criteria\n\n- Another outcome\n", epic: epic.id }, p);
    assert.equal(task.ok, true);
    assert.equal(callTool("tm_ac_accept", { id: task.id, index: 1, remove: true }, p).ok, true);
  });
});
