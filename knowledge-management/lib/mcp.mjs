/**
 * Knowledge store as MCP tools. handleRequest is pure for tests.
 */
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { paths, PLUGIN_VERSION } from "./paths.mjs";
import { createConcept, listConcepts, readConcept, readEvents, writeConcept } from "./store.mjs";
import { find } from "./query.mjs";
import { validateBundle, trustTier } from "./validate.mjs";
import { lintBundle } from "./lint.mjs";
import { backlinks, graphData, mermaid } from "./graph.mjs";
import { reindex } from "./index.mjs";
import { humanActor, now } from "./actor.mjs";

const PLUGIN_ROOT = fileURLToPath(new URL("..", import.meta.url));

const serverVersion = () => {
  try {
    const v = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8")).version;
    if (v != null && String(v).length > 0) return String(v);
  } catch {
    /* fall through */
  }
  const dir = basename(PLUGIN_ROOT);
  if (/^[0-9a-f]{7,40}$/i.test(dir)) return dir;
  return PLUGIN_VERSION;
};

export const SERVER_INFO = { name: "knowledge-management", version: serverVersion() };

const ok = (fields = {}) => ({ ok: true, ...fields });
const fail = (error) => ({ ok: false, error });
const str = (description) => ({ type: "string", description });

export const TOOLS = [
  {
    name: "km_search",
    description:
      "Search OKF knowledge concepts (type:, tag:, trust:, stale: filters). Use before inventing domain knowledge.",
    inputSchema: {
      type: "object",
      properties: { query: str("Words and/or field:value tokens") },
      required: ["query"],
    },
    run: ({ query }, p) => {
      const hits = find(String(query).split(/\s+/).filter(Boolean), p).map((c) => ({
        id: c.id,
        type: c.type,
        title: c.title,
        description: c.description,
        trust: trustTier(c.data),
      }));
      return ok({ hits });
    },
  },
  {
    name: "km_show",
    description: "Full concept by id (path without .md), including frontmatter and body.",
    inputSchema: { type: "object", properties: { id: str("Concept id, e.g. architecture/auth") }, required: ["id"] },
    run: ({ id }, p) => {
      const doc = readConcept(id, p);
      return doc
        ? ok({
            id: doc.id,
            type: doc.type,
            title: doc.title,
            description: doc.description,
            data: doc.data,
            body: doc.body,
            trust: trustTier(doc.data),
          })
        : fail(`not found: ${id}`);
    },
  },
  {
    name: "km_validate",
    description: "OKF v0.2 conformance check for the project knowledge bundle.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, p) => {
      const r = validateBundle(p);
      return ok(r);
    },
  },
  {
    name: "km_lint",
    description: "Lint: orphans, broken links, stale concepts.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, p) => ok(lintBundle(p)),
  },
  {
    name: "km_graph",
    description: "Concept link graph as nodes/edges and mermaid.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, p) => {
      const g = graphData(p);
      return ok({ ...g, mermaid: mermaid(p) });
    },
  },
  {
    name: "km_backlinks",
    description: "Inbound links to a concept.",
    inputSchema: { type: "object", properties: { id: str("Concept id") }, required: ["id"] },
    run: ({ id }, p) => ok({ id, backlinks: backlinks(id, p) }),
  },
  {
    name: "km_verify",
    description: "Append a human verification stamp to a concept.",
    inputSchema: { type: "object", properties: { id: str("Concept id") }, required: ["id"] },
    run: ({ id }, p) => {
      const doc = readConcept(id, p);
      if (!doc) return fail(`not found: ${id}`);
      const prev = doc.data.verified;
      const list = prev == null ? [] : Array.isArray(prev) ? [...prev] : [prev];
      list.push({ by: humanActor(), at: now() });
      const updated = writeConcept(id, { ...doc.data, verified: list }, doc.body, p);
      return ok({ id: updated.id, verified: list, trust: trustTier(updated.data) });
    },
  },
  {
    name: "km_write_concept",
    description: "Create a new OKF concept (type, title, optional dir/description/body).",
    inputSchema: {
      type: "object",
      properties: {
        type: str("OKF type"),
        title: str("Title"),
        description: str("One-line description"),
        dir: str("Subdirectory e.g. architecture"),
        body: str("Markdown body"),
      },
      required: ["title"],
    },
    run: (args, p) => {
      const doc = createConcept(
        {
          type: args.type,
          title: args.title,
          description: args.description || "",
          dir: args.dir || "",
          body: args.body || "",
        },
        p,
      );
      reindex(p);
      return ok({ id: doc.id, path: doc.path, type: doc.type });
    },
  },
  {
    name: "km_list",
    description: "List all concept ids/titles/types.",
    inputSchema: { type: "object", properties: {} },
    run: (_a, p) =>
      ok({
        concepts: listConcepts(p).map((c) => ({ id: c.id, type: c.type, title: c.title })),
      }),
  },
];

export function toolDefinitions() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export function handleRequest(msg, p = paths()) {
  if (!msg || typeof msg !== "object") return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid" } };

  if (msg.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    };
  }

  if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") {
    return null;
  }

  if (msg.method === "tools/list") {
    return { jsonrpc: "2.0", id: msg.id, result: { tools: toolDefinitions() } };
  }

  if (msg.method === "tools/call") {
    const name = msg.params?.name;
    const args = msg.params?.arguments || {};
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: { content: [{ type: "text", text: JSON.stringify(fail(`unknown tool: ${name}`)) }], isError: true },
      };
    }
    try {
      const result = tool.run(args, p);
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: result.ok === false,
        },
      };
    } catch (e) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(fail(e.message)) }],
          isError: true,
        },
      };
    }
  }

  return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } };
}

/** Direct dispatch for unit tests (no JSON-RPC envelope). */
export function callTool(name, args = {}, p = paths()) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`unknown tool: ${name}`);
  return tool.run(args, p);
}
