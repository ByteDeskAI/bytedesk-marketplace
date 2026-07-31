import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseDoc, serializeDoc, slug } from "../../lib/yaml-doc.mjs";

describe("yaml-doc", () => {
  it("round-trips type title tags and nested generated", () => {
    const data = {
      type: "Architecture",
      title: "Auth",
      tags: ["security"],
      generated: { by: "knowledge-management/0.1.0", at: "2026-07-30T00:00:00Z" },
      custom: "kept",
    };
    const text = serializeDoc(data, "# Body\n\nHello\n");
    assert.match(text, /^---\n/);
    const { data: d, body } = parseDoc(text);
    assert.equal(d.type, "Architecture");
    assert.equal(d.title, "Auth");
    assert.deepEqual(d.tags, ["security"]);
    assert.equal(d.generated.by, "knowledge-management/0.1.0");
    assert.equal(d.custom, "kept");
    assert.match(body, /Hello/);
  });

  it("returns empty data when no frontmatter", () => {
    const { data, body } = parseDoc("# just body");
    assert.deepEqual(data, {});
    assert.equal(body, "# just body");
  });

  it("slugs titles", () => {
    assert.equal(slug("Hello World!"), "hello-world");
  });
});
