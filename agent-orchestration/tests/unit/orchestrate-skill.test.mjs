// TM-376: the /orchestrate router names verbs, flags, MCP tools and skills from BOTH plugins. Each one
// must exist, so a renamed or removed verb fails here instead of sending an agent to nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ao = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const tmPlugin = (p) => fileURLToPath(new URL(`../../../task-management/${p}`, import.meta.url));
const read = (path) => readFileSync(path, "utf8");
const SKILL = read(ao("skills/orchestrate/SKILL.md"));

/** The object literal `const <name> = {` … the first top-level `};`. */
function block(source, name) {
  const start = source.indexOf(`const ${name} = {`);
  assert.ok(start >= 0, `const ${name} not found`);
  return source.slice(start, source.indexOf("\n};\n", start));
}
const keys = (text) => new Set([...text.matchAll(/^  (?:async )?["']?([a-z][a-z-]*)["']?\(/gm)].map((m) => m[1]));

const tmSource = read(tmPlugin("bin/tm"));
const topologySource = read(ao("topology/cli.mjs"));
const aoSource = read(ao("src/cli.mjs")) + read(ao("src/services/cli.mjs"));
const CLIS = {
  tm: { verbs: keys(block(tmSource, "VERBS")), source: tmSource },
  "ao-topology": {
    verbs: new Set([...keys(block(topologySource, "commands")), ...[...topologySource.matchAll(/^commands\.([a-z-]+) =/gm)].map((m) => m[1])]),
    source: topologySource + read(ao("topology/lib/addressing.mjs")),
  },
  "agent-orchestration": { verbs: new Set([...aoSource.matchAll(/command === "([a-z-]+)"/g)].map((m) => m[1])), source: aoSource },
};

const mentioned = (source, word) => [`'${word}'`, `"${word}"`, `--${word}`, `.${word}`].some((form) => source.includes(form));

test("TM-376: every CLI verb, sub-verb and flag the router names exists", () => {
  const spans = [...SKILL.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
  let checked = 0;
  for (const span of spans) {
    const [cli, verb, sub, ...rest] = span.split(/\s+/);
    const table = CLIS[cli];
    if (!table || !verb) continue;
    assert.ok(table.verbs.has(verb), `${cli} has no verb "${verb}" (from \`${span}\`)`);
    if (sub && /^[a-z][a-z-]*$/.test(sub)) assert.ok(mentioned(table.source, sub), `${cli} ${verb} has no sub-verb "${sub}" (from \`${span}\`)`);
    for (const token of [sub, ...rest].filter(Boolean)) {
      if (/^--[a-z][a-z0-9-]*$/.test(token)) assert.ok(mentioned(table.source, token.slice(2)), `${cli} has no flag ${token} (from \`${span}\`)`);
      if (/^@[a-z-]+$/.test(token)) assert.ok(table.source.includes(`"${token}"`), `${cli} has no audience ${token} (from \`${span}\`)`);
    }
    checked++;
  }
  // Coverage, so an empty parse cannot pass: the router names many commands from all three CLIs.
  assert.ok(checked >= 20, `only ${checked} CLI references parsed`);
  for (const cli of Object.keys(CLIS)) assert.ok(spans.some((s) => s.startsWith(`${cli} `)), `no ${cli} reference parsed`);
});

test("TM-376: every MCP tool the router names is registered", () => {
  const registered = read(ao("src/mcp.mjs")) + read(tmPlugin("lib/mcp.mjs"));
  const tools = [...new Set([...SKILL.matchAll(/\b((?:orchestration|tm)_[a-z_]+)\b/g)].map((m) => m[1]))];
  assert.ok(tools.length >= 6, `only ${tools.length} MCP tools parsed`);
  for (const tool of tools) assert.ok(registered.includes(`"${tool}"`) || registered.includes(`'${tool}'`), `MCP tool ${tool} is not registered`);
});

test("TM-376: every skill the router names exists, and task-management's route points here", () => {
  const skills = [...SKILL.matchAll(/\/(agent-orchestration|task-management):([a-z-]+)/g)];
  assert.ok(skills.length >= 10, `only ${skills.length} skill references parsed`);
  for (const [, plugin, name] of skills) {
    const path = plugin === "agent-orchestration" ? ao(`skills/${name}/SKILL.md`) : tmPlugin(`skills/${name}/SKILL.md`);
    assert.ok(existsSync(path), `/${plugin}:${name} does not exist`);
  }
  assert.match(read(tmPlugin("skills/route/SKILL.md")), /\/agent-orchestration:orchestrate/);
});
