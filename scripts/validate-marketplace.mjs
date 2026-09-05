#!/usr/bin/env node
// Gate for .claude-plugin/marketplace.json and every plugin it lists.
//
// Local entries ("./name") must be a directory with .claude-plugin/plugin.json whose name matches
// the entry. External entries (github, git-subdir, url) must carry the keys their source needs.
// No plugin may declare a version: these are internal plugins, resolved by commit SHA, and a
// version pins consumers to a stale copy.
//
// An agent may also not declare an mcp__<server>__ tool for a server no plugin here provides.
// The four design-system specialist agents did exactly that for months: the consolidation that
// replaced the fat design-system plugin with a skills-only one deleted its MCP server, the agents
// kept declaring its tools, and nothing said so. An agent with tools that do not resolve still
// runs, just without the evidence it was built to cite.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const problems = [];
const fail = (m) => problems.push(m);
const read = (p, label) => {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch (e) { fail(`${label}: ${e.message}`); return null; }
};

const manifest = read(path.join(root, ".claude-plugin/marketplace.json"), "marketplace.json");
if (!manifest) { console.error(problems.join("\n")); process.exit(1); }
if (!Array.isArray(manifest.plugins) || !manifest.plugins.length) fail("marketplace.json lists no plugins");

const seen = new Set();
for (const entry of manifest.plugins ?? []) {
  const name = entry.name ?? "(unnamed)";
  if (!entry.name) fail("a plugin entry has no name");
  if (seen.has(name)) fail(`${name}: listed twice`);
  seen.add(name);
  if (!entry.description) fail(`${name}: no description`);
  if (entry.version) fail(`${name}: marketplace entry declares version ${entry.version}; internal plugins resolve by commit SHA`);

  const source = entry.source;
  if (typeof source === "string") {
    if (!source.startsWith("./")) { fail(`${name}: string source must be a relative path, got ${source}`); continue; }
    const dir = path.join(root, source);
    if (!existsSync(dir)) { fail(`${name}: ${source} does not exist`); continue; }
    const file = path.join(dir, ".claude-plugin/plugin.json");
    if (!existsSync(file)) { fail(`${name}: ${source} has no .claude-plugin/plugin.json`); continue; }
    const plugin = read(file, `${name}/plugin.json`);
    if (!plugin) continue;
    if (plugin.name !== name) fail(`${name}: plugin.json says name "${plugin.name}"`);
    if (plugin.version) fail(`${name}: plugin.json declares version ${plugin.version}; remove it so every commit is a new version`);
    for (const [key, value] of Object.entries(plugin)) {
      if (!["skills", "agents", "commands", "hooks", "mcpServers"].includes(key)) continue;
      for (const rel of [value].flat()) {
        if (typeof rel !== "string" || !rel.startsWith("./")) continue;
        if (!existsSync(path.join(dir, rel))) fail(`${name}: plugin.json ${key} points at ${rel}, which does not exist`);
      }
    }
  } else if (source && typeof source === "object") {
    const kind = source.source;
    if (kind === "github" && !source.repo) fail(`${name}: github source needs "repo"`);
    else if (kind === "git-subdir" && !(source.url && source.path)) fail(`${name}: git-subdir source needs "url" and "path"`);
    else if (!["github", "git-subdir", "url", "npm", "command"].includes(kind)) fail(`${name}: unknown source type ${JSON.stringify(kind)}`);
  } else {
    fail(`${name}: no source`);
  }
}

// Every mcp__<server>__ tool an agent declares must come from a server some plugin provides.
const servers = new Set();
for (const entry of manifest.plugins ?? []) {
  const source = entry.source;
  if (typeof source !== "string" || !source.startsWith("./")) continue;
  const dir = path.join(root, source);
  const plugin = existsSync(path.join(dir, ".claude-plugin/plugin.json"))
    ? read(path.join(dir, ".claude-plugin/plugin.json"), `${entry.name}/plugin.json`) : null;
  const declared = plugin?.mcpServers;
  if (!declared) continue;
  if (typeof declared === "string") {
    const file = path.join(dir, declared);
    const config = existsSync(file) ? read(file, `${entry.name}/${declared}`) : null;
    for (const key of Object.keys(config?.mcpServers ?? config ?? {})) servers.add(key);
  } else if (typeof declared === "object") {
    for (const key of Object.keys(declared)) servers.add(key);
  }
}

const agentDirs = readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(root, e.name, "agents")))
  .map((e) => path.join(root, e.name, "agents"));
for (const dir of agentDirs) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(path.join(dir, file), "utf8");
    const rel = path.relative(root, path.join(dir, file));
    for (const [, server] of new Set([...text.matchAll(/mcp__([a-z0-9-]+)__/gi)].map((m) => [m[0], m[1]]))) {
      if (!servers.has(server)) fail(`${rel}: declares mcp__${server}__ tools, but no plugin here provides a "${server}" MCP server`);
    }
  }
}

if (problems.length) { console.error(problems.map((p) => `marketplace: ${p}`).join("\n")); process.exit(1); }
console.log(`marketplace: ${manifest.plugins.length} plugins valid (${[...seen].join(", ")})`);
