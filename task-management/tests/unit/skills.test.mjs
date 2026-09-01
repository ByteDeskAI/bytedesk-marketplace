/** lib/skills — the catalog the board shows, read off the plugin's own SKILL.md files. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills } from "../../lib/skills.mjs";

describe("listSkills", () => {
  it("reads the real catalog", () => {
    const skills = listSkills();
    assert.ok(skills.length >= 20, `found ${skills.length}`);
    const board = skills.find((s) => s.name === "board");
    assert.equal(board.userInvokable, true);
    assert.equal(board.command, "/task-management:board");
    assert.ok(board.argumentHint);
    assert.equal(skills.find((s) => s.name === "enhance-capture").userInvokable, false);
  });
  it("tolerates a skill with no frontmatter and an empty root", () => {
    const root = mkdtempSync(join(tmpdir(), "tm-skills-"));
    assert.deepEqual(listSkills(root), []);
    mkdirSync(join(root, "skills", "bare"), { recursive: true });
    writeFileSync(join(root, "skills", "bare", "SKILL.md"), "# no frontmatter\n");
    assert.deepEqual(listSkills(root), [{ name: "bare", description: "", userInvokable: false, argumentHint: null, command: "/task-management:bare" }]);
  });
});
