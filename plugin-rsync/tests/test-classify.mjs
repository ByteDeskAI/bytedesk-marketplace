// Classification + rsync -i parsing for plugin-rsync --json (TM-388). Run by test-plugin-rsync.sh.
import { classify, parseItemized } from "../bin/plugin-rsync";

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

const checked = Object.keys(want).length + 4;
if (failures.length) {
  console.log(failures.join("\n"));
  process.exit(1);
}
console.log("checked " + checked);
