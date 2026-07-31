import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createConcept, writeConcept } from "../../lib/store.mjs";
import { find } from "../../lib/query.mjs";
import { backlinks, graphData, mermaid } from "../../lib/graph.mjs";
import { lintBundle } from "../../lib/lint.mjs";
import { migrateBundle } from "../../lib/migrate.mjs";
import { withBundle, loadFixture } from "./helpers.mjs";
import { readConcept } from "../../lib/store.mjs";

describe("query graph lint migrate", () => {
  it("find filters by type and words", () => {
    withBundle((p) => {
      createConcept({ type: "API", title: "Orders API", dir: "apis", description: "orders endpoint" }, p);
      createConcept({ type: "Runbook", title: "Deploy", dir: "runbooks", description: "ship it" }, p);
      const apis = find(["type:API"], p);
      assert.equal(apis.length, 1);
      assert.equal(apis[0].title, "Orders API");
      const orders = find(["orders"], p);
      assert.ok(orders.some((c) => c.title.includes("Orders")));
    });
  });

  it("graph and backlinks from body links", () => {
    withBundle((p) => {
      const a = createConcept(
        { type: "Architecture", title: "Core", dir: "architecture", body: "# Core\n\nSee [ops](/runbooks/ops.md).\n" },
        p,
      );
      createConcept({ type: "Runbook", title: "Ops", dir: "runbooks", body: "# Ops\n" }, p);
      const g = graphData(p);
      assert.ok(g.nodes.length >= 2);
      assert.ok(g.edges.some((e) => e.from === a.id && e.to === "runbooks/ops"));
      const bl = backlinks("runbooks/ops", p);
      assert.ok(bl.some((b) => b.from === a.id));
      assert.match(mermaid(p), /flowchart/);
    });
  });

  it("lint reports broken links", () => {
    withBundle((p) => {
      createConcept(
        {
          type: "Reference",
          title: "Broken",
          body: "# X\n\n[missing](/no/such.md)\n",
        },
        p,
      );
      const r = lintBundle(p);
      assert.ok(r.issues.some((i) => i.code === "broken_link"));
    });
  });

  it("migrate v0.1 timestamp and citations", () => {
    const fx = loadFixture("v01");
    try {
      const results = migrateBundle(fx.paths);
      assert.ok(results.some((r) => r.migrated));
      const doc = readConcept("legacy", fx.paths);
      assert.ok(doc.data.generated?.at);
      assert.ok(!doc.data.timestamp);
      assert.ok(Array.isArray(doc.data.sources));
      assert.ok(doc.data.sources.length >= 1);
      assert.ok(!/#\s*Citations/i.test(doc.body));
    } finally {
      fx.restore();
    }
  });
});
