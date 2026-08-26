#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const payloadRoot = existsSync(path.join(pluginRoot, "payload")) ? path.join(pluginRoot, "payload") : pluginRoot;
const auditRoot = await realpath(path.resolve(process.env.BYTEDESK_DESIGN_AUDIT_ROOT ?? process.cwd()));
const manifest = JSON.parse(await readFile(path.join(pluginRoot, "design-system.manifest.json"), "utf8"));
const categories = ["tokens", "profiles", "assets", "rules", "skills", "agents", "bundles", "provenance"];
const skipDirectories = new Set([".git", "node_modules", "vendor", "dist", "build", ".next", "out"]);
const scanExtensions = new Set([".css", ".go", ".html", ".js", ".json", ".jsx", ".md", ".mjs", ".rs", ".ts", ".tsx", ".yaml", ".yml"]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function boundedRoot(requested = ".") {
  const resolved = await realpath(path.resolve(auditRoot, requested));
  if (!(await stat(resolved)).isDirectory()) throw new Error("repositoryPath must be a directory");
  if (!isInside(auditRoot, resolved)) {
    throw new Error(`repositoryPath escapes configured audit root: ${requested}`);
  }
  return resolved;
}

async function readBounded(root, relative, required = false) {
  const target = path.resolve(root, relative);
  if (!isInside(root, target)) throw new Error(`path escapes repository boundary: ${relative}`);
  if (!existsSync(target)) {
    if (required) throw new Error(`required file is missing: ${relative}`);
    return null;
  }
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new Error(`symlink reads are forbidden: ${relative}`);
  if (!info.isFile()) throw new Error(`expected a file: ${relative}`);
  return readFile(target, "utf8");
}

async function walkBounded(root, relative = "", limit = 1000) {
  if (limit <= 0) return [];
  const directory = path.resolve(root, relative);
  if (!isInside(root, directory)) throw new Error("scan escaped repository boundary");
  const output = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && skipDirectories.has(entry.name)) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) output.push(...(await walkBounded(root, child, limit - output.length)));
    else if (entry.isFile()) output.push(child);
    if (output.length >= limit) break;
  }
  return output;
}

function flattenTokens(value, prefix = [], output = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  if (Object.hasOwn(value, "$value")) {
    output.push({ id: `token:${prefix.join(".")}`, path: prefix.join("."), value: value.$value, type: value.$type ?? null, sourcePath: "tokens/bytedesk.tokens.json" });
    return output;
  }
  for (const key of Object.keys(value).sort()) flattenTokens(value[key], [...prefix, key], output);
  return output;
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sections(markdown, sourcePath, authority, profile = null) {
  const matches = [...markdown.matchAll(/^(#{1,3})\s+(.+)$/gm)];
  return matches.map((match, index) => {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? markdown.length;
    const title = match[2].trim();
    const scope = profile ? `${authority}:${profile}` : authority;
    return {
      id: `rule:${scope}:${slug(title)}`,
      title,
      authority,
      profile,
      sourcePath,
      headingLevel: match[1].length,
      body: markdown.slice(bodyStart, bodyEnd).trim(),
    };
  });
}

let cachedTokens;
let cachedRules;
async function tokens() {
  cachedTokens ??= flattenTokens(JSON.parse(await readFile(path.join(payloadRoot, "tokens", "bytedesk.tokens.json"), "utf8")));
  return cachedTokens;
}

async function rules() {
  if (cachedRules) return cachedRules;
  const output = sections(await readFile(path.join(payloadRoot, "DESIGN.md"), "utf8"), "DESIGN.md", "shared");
  for (const profile of manifest.profiles.filter((item) => !item.slug.startsWith("_"))) {
    for (const name of ["DESIGN.md", "PRODUCT.md"]) {
      const sourcePath = `profiles/${profile.slug}/${name}`;
      const absolute = path.join(payloadRoot, sourcePath);
      if (existsSync(absolute)) output.push(...sections(await readFile(absolute, "utf8"), sourcePath, "profile", profile.slug));
    }
  }
  cachedRules = output;
  return output;
}

function provenance() {
  const payloadSha = existsSync(path.join(payloadRoot, ".source-sha")) ? "payload/.source-sha" : null;
  return [
    { id: "provenance:catalog", sourcePath: manifest.catalog.sourcePath, sha256: manifest.catalog.sha256 },
    { id: "provenance:plugin", version: manifest.version, sourcePath: "design-system.manifest.json", sourceShaPath: payloadSha },
    ...manifest.skillSources.map((item) => ({ ...item, id: `provenance:${item.id}` })),
    ...manifest.profiles.filter((item) => item.sourceCommit).map((item) => ({ id: `provenance:${item.id}`, sourceRepository: item.sourceRepository, sourceCommit: item.sourceCommit, sourcePath: item.files })),
  ];
}

async function items(category) {
  if (category === "tokens") return tokens();
  if (category === "rules") return rules();
  if (category === "provenance") return provenance();
  return manifest[category] ?? [];
}

async function listDesignItems(args) {
  const category = args.category ?? null;
  if (category && !categories.includes(category)) throw new Error(`unknown category: ${category}`);
  if (category) return { category, count: (await items(category)).length, items: await items(category) };
  const counts = {};
  for (const name of categories) counts[name] = (await items(name)).length;
  return { version: manifest.version, categories: counts };
}

function searchableText(item) {
  return JSON.stringify(item).toLowerCase();
}

async function searchDesignSystem(args) {
  const query = String(args.query ?? "").trim().toLowerCase();
  if (!query) throw new Error("query is required");
  const requested = args.categories ?? categories;
  if (!Array.isArray(requested) || requested.some((item) => !categories.includes(item))) throw new Error("categories contains an unknown value");
  const words = query.split(/\s+/).filter(Boolean);
  const results = [];
  for (const category of requested) {
    for (const item of await items(category)) {
      const haystack = searchableText(item);
      const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
      if (score === words.length) results.push({ category, score, item });
    }
  }
  results.sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)));
  return { query, count: Math.min(results.length, args.limit ?? 20), results: results.slice(0, args.limit ?? 20) };
}

async function getDesignItem(args) {
  const id = String(args.id ?? "").trim();
  if (!id) throw new Error("id is required");
  for (const category of categories) {
    const match = (await items(category)).find((item) => [item.id, item.name, item.slug, item.path].includes(id));
    if (match) return { category, item: match };
  }
  throw new Error(`design item not found: ${id}`);
}

async function explainRule(args) {
  const query = String(args.query ?? "").trim().toLowerCase();
  if (!query) throw new Error("query is required");
  let candidates = await rules();
  if (args.profile) candidates = candidates.filter((item) => item.authority === "shared" || item.profile === args.profile);
  if (args.repositoryPath) {
    const root = await boundedRoot(args.repositoryPath);
    const local = await readBounded(root, "DESIGN.md");
    if (local) candidates = [...candidates, ...sections(local, "DESIGN.md", "consumer", args.profile ?? null)];
  }
  const words = query.split(/\s+/).filter(Boolean);
  const ranked = candidates.map((item) => ({
    item,
    score: words.reduce((sum, word) => sum + (item.title.toLowerCase().includes(word) ? 4 : item.body.toLowerCase().includes(word) ? 1 : 0), 0),
  })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
  if (ranked.length === 0) throw new Error(`no rule matches: ${query}`);
  const rule = ranked[0].item;
  return {
    query,
    authority: rule.authority,
    profile: rule.profile,
    title: rule.title,
    citation: rule.sourcePath,
    excerpt: rule.body.slice(0, 800),
    inheritanceOrder: ["shared", "profile", "consumer"],
    explanation: `${rule.authority} authority from ${rule.sourcePath}; later inheritance layers may specialize it only through an explicit local exception.`,
  };
}

async function auditRepository(args) {
  const root = await boundedRoot(args.repositoryPath ?? ".");
  const before = [];
  const findings = [];
  const add = (severity, code, relativePath, message) => findings.push({ severity, code, path: relativePath, message });
  const configText = await readBounded(root, ".bytedesk/design-system.json");
  const managedStateText = await readBounded(root, ".context/design-system/.design-system.json");
  let config = null;
  try { config = JSON.parse(configText ?? managedStateText ?? "null"); } catch { add("error", "invalid-config", ".bytedesk/design-system.json", "Design-system configuration is invalid JSON."); }
  const app = args.app ?? config?.app ?? null;
  if (!app) add("error", "missing-profile", ".bytedesk/design-system.json", "No product profile is configured.");
  else if (!manifest.profiles.some((item) => item.slug === app)) add("error", "unknown-profile", ".bytedesk/design-system.json", `Configured profile is not in the design kit: ${app}`);

  const managedText = await readBounded(root, ".context/design-system/.managed-files.json");
  if (!managedText) add("error", "missing-managed-state", ".context/design-system/.managed-files.json", "Managed payload integrity state is missing.");
  else {
    try {
      const managed = JSON.parse(managedText);
      for (const file of managed.files ?? []) {
        try {
          const content = await readBounded(root, `.context/design-system/${file.path}`, true);
          if (sha256(Buffer.from(content)) !== file.sha256) add("error", "managed-drift", `.context/design-system/${file.path}`, "Managed file checksum does not match.");
        } catch (error) {
          add("error", "managed-file-error", `.context/design-system/${file.path}`, error.message);
        }
      }
    } catch { add("error", "invalid-managed-state", ".context/design-system/.managed-files.json", "Managed integrity state is invalid JSON."); }
  }

  const localDesign = await readBounded(root, "DESIGN.md");
  const agents = await readBounded(root, "AGENTS.md");
  if (!localDesign?.includes(".context/design-system/DESIGN.md") || (app && !localDesign.includes(`profiles/${app}/DESIGN.md`))) add("warning", "design-inheritance", "DESIGN.md", "Shared and profile design inheritance is incomplete.");
  if (!agents?.includes(".context/design-system/DESIGN.md") || (app && !agents.includes(`profiles/${app}/DESIGN.md`))) add("warning", "agent-inheritance", "AGENTS.md", "Agent reading order is incomplete.");

  const files = await walkBounded(root);
  const workflowFiles = files.filter((item) => item.startsWith(".github/workflows/") && /\.ya?ml$/.test(item));
  let ciWired = false;
  for (const file of workflowFiles) if ((await readBounded(root, file))?.includes("design-system-check.mjs")) ciWired = true;
  if (!ciWired) add("warning", "missing-ci-gate", ".github/workflows", "No standalone design-system drift gate was found.");

  const runtime = existsSync(path.join(root, "package.json")) ? "web" : existsSync(path.join(root, "go.mod")) ? "go" : existsSync(path.join(root, "Cargo.toml")) ? "native" : "unknown";
  if (runtime === "unknown") add("warning", "unknown-runtime", ".", "No supported runtime marker was detected.");
  if (runtime === "web") {
    let imported = false;
    for (const file of files.filter((item) => scanExtensions.has(path.extname(item)))) {
      if ((await readBounded(root, file))?.includes("tokens/css/bytedesk.css")) { imported = true; break; }
    }
    if (!imported) add("error", "missing-token-adapter", ".", "Web runtime does not import the managed ByteDesk token CSS.");
  }
  findings.sort((a, b) => a.severity.localeCompare(b.severity) || a.code.localeCompare(b.code) || a.path.localeCompare(b.path));
  before.push(...files);
  return {
    repository: root,
    app,
    runtime,
    status: findings.some((item) => item.severity === "error") ? "error" : findings.some((item) => item.severity === "warning") ? "warning" : "healthy",
    counts: { errors: findings.filter((item) => item.severity === "error").length, warnings: findings.filter((item) => item.severity === "warning").length },
    findings,
    inspectedFileCount: before.length,
    mutated: false,
  };
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const tools = [
  { name: "list_design_items", title: "List design-kit items", description: "List counts or complete items for tokens, profiles, assets, rules, skills, agents, bundles, and provenance.", inputSchema: { type: "object", properties: { category: { type: "string", enum: categories } }, additionalProperties: false }, annotations: readOnly },
  { name: "search_design_system", title: "Search the design system", description: "Search the offline design-kit manifest, tokens, rules, profiles, assets, skills, and provenance.", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 }, categories: { type: "array", items: { type: "string", enum: categories } }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["query"], additionalProperties: false }, annotations: readOnly },
  { name: "get_design_item", title: "Get a design-kit item", description: "Get one exact design item by namespaced id, name, slug, or token path.", inputSchema: { type: "object", properties: { id: { type: "string", minLength: 1 } }, required: ["id"], additionalProperties: false }, annotations: readOnly },
  { name: "explain_rule", title: "Explain a design rule", description: "Find the strongest matching design rule, identify its shared/profile/consumer authority, and cite its repository path.", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 }, profile: { type: "string" }, repositoryPath: { type: "string" } }, required: ["query"], additionalProperties: false }, annotations: readOnly },
  { name: "audit_repository", title: "Audit a design-system consumer", description: "Read-only audit of managed checksums, profile selection, design/agent inheritance, runtime token wiring, and CI drift protection.", inputSchema: { type: "object", properties: { repositoryPath: { type: "string" }, app: { type: "string" } }, additionalProperties: false }, annotations: readOnly },
];

const handlers = { list_design_items: listDesignItems, search_design_system: searchDesignSystem, get_design_item: getDesignItem, explain_rule: explainRule, audit_repository: auditRepository };
function response(id, result) { return { jsonrpc: "2.0", id, result }; }
function error(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function toolResult(data, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, ...(isError ? { isError: true } : {}) };
}

async function dispatch(message) {
  if (!message || message.jsonrpc !== "2.0") return error(message?.id ?? null, -32600, "Invalid Request");
  if (message.method === "initialize") return response(message.id, { protocolVersion: message.params?.protocolVersion ?? "2025-11-25", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "bytedesk-design-system", version: manifest.version, description: "Offline read-only ByteDesk design-kit server" } });
  if (message.method === "ping") return response(message.id, {});
  if (message.method === "tools/list") return response(message.id, { tools });
  if (message.method === "tools/call") {
    const handler = handlers[message.params?.name];
    if (!handler) return response(message.id, toolResult({ error: `unknown tool: ${message.params?.name}` }, true));
    try { return response(message.id, toolResult(await handler(message.params?.arguments ?? {}))); }
    catch (caught) { return response(message.id, toolResult({ error: caught.message }, true)); }
  }
  if (message.method?.startsWith("notifications/")) return null;
  return error(message.id, -32601, "Method not found");
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let output;
  try { output = await dispatch(JSON.parse(line)); }
  catch (caught) { output = error(null, -32700, `Parse error: ${caught.message}`); }
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}
