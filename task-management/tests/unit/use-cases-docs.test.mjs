/** TM-075 — use-cases.md is a catalog of 20 real surfaces, not invented flags. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../../lib/mcp.mjs";

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(join(PLUGIN, rel), "utf8");

const SECTIONS = [
  "**Scenario**",
  "**When to use**",
  "**Usage**",
  "**Natural language prompts**",
  "**Expected outcome**",
];

describe("use-cases catalog (TM-075)", () => {
  const doc = read("docs/use-cases.md");
  const headings = [...doc.matchAll(/^## (\d{2})\. /gm)].map((m) => m[1]);

  it("has exactly 20 numbered use cases with the five-section format", () => {
    assert.deepEqual(headings, [...Array(20)].map((_, i) => String(i + 1).padStart(2, "0")));
    const parts = doc.split(/^## \d{2}\. /m).slice(1);
    assert.equal(parts.length, 20);
    for (const [i, part] of parts.entries()) {
      for (const s of SECTIONS) {
        assert.ok(part.includes(s), `use case ${i + 1} missing ${s}`);
      }
    }
  });

  it("names only MCP tools that exist", () => {
    const names = new Set(TOOLS.map((t) => t.name));
    const mentioned = new Set([...doc.matchAll(/`?(tm_[a-z0-9_]+)`?/g)].map((m) => m[1]));
    const unknown = [...mentioned].filter((n) => !names.has(n));
    assert.deepEqual(unknown, [], `invented MCP tools: ${unknown.join(", ")}`);
  });

  it("names HTTP routes that exist in dashboard-api.md", () => {
    const api = read("docs/dashboard-api.md");
    const routes = [...doc.matchAll(/\/api\/[A-Za-z0-9_/:?=-]+/g)].map((m) => m[0].replace(/\?.*$/, ""));
    const missing = [...new Set(routes)].filter((r) => {
      const core = r.replace(/:id/g, ":id");
      return !api.includes(core) && !api.includes(r.replace(/TM-014|EP-002|CAP-0046|SP-001/g, ":id"));
    });
    // Parameterised paths in the catalog use concrete ids; accept :id in the contract.
    const still = missing.filter((r) => {
      const asParam = r
        .replace(/\/TM-\d+/g, "/:id")
        .replace(/\/EP-\d+/g, "/:id")
        .replace(/\/CAP-\d+/g, "/:id")
        .replace(/\/SP-\d+/g, "/:id");
      return !api.includes(asParam) && !api.includes(r);
    });
    assert.deepEqual(still, [], `HTTP paths not in dashboard-api.md: ${still.join(", ")}`);
  });

  it("covers agent-first surfaces and README links the catalog", () => {
    for (const needle of [
      "tm caps",
      "--backend orchestration",
      "--backend topology",
      "--backend tmux",
      "--backend manual",
      "tm pool",
      "tm agent reap",
      "tm collect",
      "tm events",
      "webhooks",
    ]) {
      assert.ok(doc.includes(needle), `missing ${needle}`);
    }
    assert.match(read("README.md"), /docs\/use-cases\.md/);
  });
});
