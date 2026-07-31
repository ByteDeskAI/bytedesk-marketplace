import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createConcept } from "../../lib/store.mjs";
import { diagnose, repairAll } from "../../lib/doctor.mjs";
import { exportStore } from "../../lib/export.mjs";
import { writeViz } from "../../lib/viz.mjs";
import { withBundle } from "./helpers.mjs";
import { reindex } from "../../lib/index.mjs";

describe("doctor export viz", () => {
  it("doctor --fix rebuilds missing index", () => {
    withBundle((p) => {
      createConcept({ type: "Reference", title: "Note" }, p);
      reindex(p);
      unlinkSync(p.indexJson);
      const before = diagnose(p);
      assert.ok(before.problems.some((x) => x.code === "no_index"));
      const fixed = repairAll(p);
      assert.ok(fixed.fixed.includes("reindex"));
      assert.ok(existsSync(p.indexJson));
    });
  });

  it("export md and json include concepts", () => {
    withBundle((p) => {
      createConcept({ type: "API", title: "Health", description: "health check" }, p);
      const md = exportStore("md", p);
      assert.match(md, /Health/);
      const js = JSON.parse(exportStore("json", p));
      assert.ok(js.concepts.length >= 1);
    });
  });

  it("viz writes html with mermaid and concepts", () => {
    withBundle((p) => {
      createConcept({ type: "Module", title: "Core" }, p);
      const out = join(p.base, "viz.html");
      writeViz(out, p);
      assert.ok(existsSync(out));
      const html = readFileSync(out, "utf8");
      assert.match(html, /flowchart|Knowledge graph/i);
      assert.match(html, /Core/);
    });
  });
});
