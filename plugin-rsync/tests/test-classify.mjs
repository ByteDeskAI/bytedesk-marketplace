// Classification + rsync -i parsing for plugin-rsync --json (TM-388). Run by test-plugin-rsync.sh.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classify, parseItemized, pluginRel, processEntries } from "../bin/plugin-rsync";

const failures = [];
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(label + ": got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

const mcp = new Set(["bin/a-mcp"]);
const want = {
  "hooks/h.sh": "needs-reload", "hooks/hooks.json": "needs-reload", "skills/x/SKILL.md": "needs-reload",
  "commands/c.md": "needs-reload", "agents/a.md": "needs-reload", "monitors/monitors.json": "needs-reload",
  ".claude-plugin/plugin.json": "needs-reload", ".codex-plugin/plugin.json": "needs-reload",
  ".grok-plugin/plugin.json": "needs-reload", ".mcp.json": "needs-reload", ".codex-mcp.json": "needs-reload",
  "bin/a-mcp": "needs-reload", "lib/x.js": "needs-reload", "dist/s.cjs": "needs-reload", "src/m.mjs": "needs-reload",
  "bin/a": "live", "README.md": "live", "data/p.md": "live", "docs/hooks/x.md": "live",
};
for (const [p, c] of Object.entries(want)) eq("with mcp " + p, classify(p, mcp), c);
// Without an MCP server, shared code is CLI code: it runs fresh per call.
for (const [p, c] of [["lib/x.js", "live"], ["bin/a-mcp", "live"], ["hooks/h.sh", "needs-reload"]]) eq("no mcp " + p, classify(p), c);

const items = ["cd+++++++++ hooks/", ">f+++++++++ hooks/h.sh", "*deleting   gone file", "cL+++++++++ bin/l -> ../x", ".d..t...... ./", ""];
eq("parseItemized", parseItemized(items.join("\n")), [
  { path: "hooks/h.sh", change: "updated" },
  { path: "gone file", change: "deleted" },
  { path: "bin/l", change: "updated" },
]);

// Long-running process entries, using the real config shapes from this marketplace.
const R = (v) => "${" + v + "}";
for (const [v, want] of [
  ["./bin/x", "bin/x"], [R("CODEX_PLUGIN_ROOT") + "/bin/x", "bin/x"], [R("CLAUDE_PLUGIN_ROOT") + "/bin/x", "bin/x"],
  [R("PLUGIN_ROOT") + "/bin/x", "bin/x"], ["node", null], ["--interval", null], [R("HOME") + "/x", null],
]) eq("pluginRel " + v, pluginRel(v), want);

const tmp = mkdtempSync(join(tmpdir(), "plugin-rsync-classify-"));
const plugin = (name, files) => {
  const dir = join(tmp, name);
  for (const [rel, doc] of Object.entries(files)) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), JSON.stringify(doc));
  }
  return [...processEntries(dir)].sort();
};
const CR = R("CLAUDE_PLUGIN_ROOT");
const mon = (...cmds) => cmds.map((command, i) => ({ name: "m" + i, command, when: "always" }));
try {
  eq("task-management monitors + mcp", plugin("tm", {
    "monitors/monitors.json": mon(CR + "/bin/tm-dashboard", CR + "/bin/tm pool ensure"),
    ".mcp.json": { mcpServers: { "task-management": { command: CR + "/bin/tm-mcp" } } },
    ".codex-mcp.json": { mcpServers: { "task-management": { command: "./bin/tm-mcp" } } },
  }), ["bin/tm", "bin/tm-dashboard", "bin/tm-mcp"]);
  const fleet = plugin("fleet", {
    "monitors/monitors.json": mon(CR + "/bin/claude-sessions notify --interval 5", CR + "/bin/claude-sessions-web"),
  });
  eq("fleet monitors only", fleet, ["bin/claude-sessions", "bin/claude-sessions-web"]);
  const procs = new Set(fleet);
  eq("fleet bin/claude-sessions-web", classify("bin/claude-sessions-web", procs), "needs-reload");
  eq("fleet bin/claude-sessions", classify("bin/claude-sessions", procs), "needs-reload");
  eq("fleet other bin is live", classify("bin/spawn-claude-feature", procs), "live");
  eq("fleet lib/ with a monitor", classify("lib/x.sh", procs), "needs-reload");
  eq("codex-only ./ entry", plugin("cx", { ".codex-mcp.json": { mcpServers: { x: { command: "./bin/x-mcp" } } } }), ["bin/x-mcp"]);
  eq("codex-only CODEX_PLUGIN_ROOT entry", plugin("sz", {
    ".codex-mcp.json": { mcpServers: { structurizr: { command: R("CODEX_PLUGIN_ROOT") + "/bin/structurizr-mcp" } } },
  }), ["bin/structurizr-mcp"]);
  eq("codex node + ./dist args", plugin("ao", {
    ".codex-mcp.json": { mcpServers: { ao: { command: "node", args: ["./dist/host-launcher.cjs"] } } },
  }), ["dist/host-launcher.cjs"]);
  eq("no servers, no monitors", plugin("none", { "README.json": {} }), []);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const checked = Object.keys(want).length + 4 + 7 + 11;
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
console.log("checked " + checked);
