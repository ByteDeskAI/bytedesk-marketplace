import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { applyHostInstall, parseArgs, planHostInstall, pluginRootFromScript } from "../../skills/install-orchestration-host/scripts/install-host.mjs";

const sourceRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

test("parseArgs defaults to every host", () => {
  const parsed = parseArgs([]);
  assert.deepEqual(parsed.hosts, ["claude", "codex", "grok", "kimi"]);
});

test("pluginRootFromScript walks out of the skill scripts directory", () => {
  const script = path.join(sourceRoot, "skills", "install-orchestration-host", "scripts", "install-host.mjs");
  assert.equal(pluginRootFromScript(script), sourceRoot);
});

test("kimi host wiring merges mcp.json and links skills without dropping other servers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ao-host-"));
  const pluginRoot = path.join(root, "plugin");
  const kimiHome = path.join(root, "kimi");
  try {
    await mkdir(path.join(pluginRoot, "bin"), { recursive: true });
    await mkdir(path.join(pluginRoot, "skills", "agent-orchestrate"), { recursive: true });
    await mkdir(path.join(pluginRoot, "skills", "agent-orchestration-doctor"), { recursive: true });
    await mkdir(path.join(pluginRoot, "skills", "roadmap-orchestrator"), { recursive: true });
    await mkdir(path.join(pluginRoot, "agents"), { recursive: true });
    await writeFile(path.join(pluginRoot, "bin", "agent-orchestration-mcp"), "#!/bin/sh\n");
    await writeFile(path.join(pluginRoot, "skills", "agent-orchestrate", "SKILL.md"), "skill\n");
    await writeFile(path.join(pluginRoot, "skills", "agent-orchestration-doctor", "SKILL.md"), "skill\n");
    await writeFile(path.join(pluginRoot, "skills", "roadmap-orchestrator", "SKILL.md"), "skill\n");
    await writeFile(path.join(pluginRoot, "agents", "cross-provider-orchestrator.md"), "agent\n");
    await mkdir(kimiHome, { recursive: true });
    await writeFile(
      path.join(kimiHome, "mcp.json"),
      `${JSON.stringify({ mcpServers: { keep: { command: "keep-me" } } }, null, 2)}\n`,
    );

    const plan = planHostInstall({ pluginRoot, hosts: ["kimi"], kimiHome });
    const results = applyHostInstall(plan, {
      spawn: () => {
        throw new Error("kimi wiring must not spawn grok");
      },
    });
    assert.equal(results.every((row) => row.status === "ok"), true);
    const mcp = JSON.parse(await readFile(path.join(kimiHome, "mcp.json"), "utf8"));
    assert.equal(mcp.mcpServers.keep.command, "keep-me");
    assert.equal(mcp.mcpServers["agent-orchestration"].command, path.join(pluginRoot, "bin", "agent-orchestration-mcp"));
    const linked = await readFile(path.join(kimiHome, "skills", "agent-orchestrate", "SKILL.md"), "utf8");
    assert.equal(linked, "skill\n");
    const agent = await readFile(path.join(kimiHome, "agents", "cross-provider-orchestrator.md"), "utf8");
    assert.equal(agent, "agent\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("grok host plan uses trusted plugin install and does not run on dry-run", () => {
  const calls = [];
  const plan = planHostInstall({
    pluginRoot: sourceRoot,
    hosts: ["grok"],
    kimiHome: path.join(os.tmpdir(), "unused-kimi"),
  });
  const results = applyHostInstall(plan, {
    dryRun: true,
    spawn: (command, args) => {
      calls.push([command, ...args]);
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(calls.length, 0);
  assert.equal(results.some((row) => row.action.kind === "exec" && row.action.args.includes(sourceRoot)), true);
});
