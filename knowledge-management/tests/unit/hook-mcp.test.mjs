import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleHook } from "../../lib/enforce.mjs";
import { callTool, handleRequest, SERVER_INFO, toolDefinitions } from "../../lib/mcp.mjs";
import { createConcept, initBundle } from "../../lib/store.mjs";
import { reindex } from "../../lib/index.mjs";
import { withBundle, loadFixture } from "./helpers.mjs";

describe("hooks", () => {
  it("session-start injects summary-sized context not full bodies", () => {
    withBundle((p) => {
      createConcept(
        {
          type: "Architecture",
          title: "Big",
          description: "one line",
          body: "# Big\n\n" + "x".repeat(5000),
        },
        p,
      );
      reindex(p);
      const r = handleHook("session-start", "{}", p);
      const ctx = r.hookSpecificOutput?.additionalContext || "";
      assert.match(ctx, /progressive disclosure|concepts:/i);
      assert.match(ctx, /Big/);
      // Must not dump the huge body
      assert.ok(ctx.length < 2000, `context too large: ${ctx.length}`);
      assert.ok(!ctx.includes("x".repeat(100)));
    });
  });

  it("pre-compact always continues", () => {
    withBundle((p) => {
      const r = handleHook("pre-compact", "{}", p);
      assert.equal(r.continue, true);
      assert.ok(r.hookSpecificOutput?.additionalContext);
    });
  });

  it("KM_ENFORCE=off short-circuits", () => {
    const prev = process.env.KM_ENFORCE;
    process.env.KM_ENFORCE = "off";
    try {
      const r = handleHook("session-start", "{}", undefined);
      assert.equal(r.continue, true);
    } finally {
      if (prev === undefined) delete process.env.KM_ENFORCE;
      else process.env.KM_ENFORCE = prev;
    }
  });
});

describe("mcp", () => {
  it("serverInfo has non-empty version and tool list", () => {
    assert.ok(SERVER_INFO.name);
    assert.ok(String(SERVER_INFO.version).length > 0);
    assert.ok(toolDefinitions().some((t) => t.name === "km_search"));
    assert.ok(toolDefinitions().some((t) => t.name === "km_validate"));
  });

  it("search show validate against fixture", () => {
    const fx = loadFixture("good");
    try {
      const search = callTool("km_search", { query: "auth" }, fx.paths);
      assert.equal(search.ok, true);
      assert.ok(search.hits.some((h) => /auth/i.test(h.id) || /auth/i.test(h.title)));

      const show = callTool("km_show", { id: "architecture/auth" }, fx.paths);
      assert.equal(show.ok, true);
      assert.equal(show.type, "Architecture");

      const val = callTool("km_validate", {}, fx.paths);
      assert.equal(val.ok, true);
      assert.equal(val.ok === true && val.errors?.length === 0, true);
    } finally {
      fx.restore();
    }
  });

  it("handleRequest tools/call km_search", () => {
    const fx = loadFixture("good");
    try {
      const res = handleRequest(
        { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "km_search", arguments: { query: "login" } } },
        fx.paths,
      );
      assert.equal(res.id, 1);
      const text = res.result.content[0].text;
      assert.match(text, /login|Runbook/i);
    } finally {
      fx.restore();
    }
  });

  it("km_verify writes trust", () => {
    withBundle((p) => {
      const doc = createConcept({ type: "Decision", title: "Use OKF", dir: "decisions" }, p);
      const r = callTool("km_verify", { id: doc.id }, p);
      assert.equal(r.ok, true);
      assert.equal(r.trust, "human-reviewed");
    });
  });
});
