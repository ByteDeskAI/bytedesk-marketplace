/**
 * The task body's block model.
 *
 * A body arrives from a goal doc, a plan, an agent or a teammate's PR, so it is untrusted. This
 * produces BLOCKS, never markup — the renderer walks them into React elements, so there is no
 * `dangerouslySetInnerHTML` and no injection surface. The last describe here pins that: whatever
 * a body contains, it comes back as text.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { blocks, excerpt, inlines } from "../../dashboard/src/lib/markdown.mjs";

const kinds = (md) => blocks(md).map((b) => b.kind);
const text = (spans) => spans.map((s) => s.text).join("");

describe("blocks", () => {
  it("reads headings at every level", () => {
    const bs = blocks("# one\n\n### three");
    assert.deepEqual(bs.map((b) => b.level), [1, 3]);
    assert.equal(text(bs[0].spans), "one");
  });

  it("joins a wrapped paragraph into one block", () => {
    const bs = blocks("first line\nsecond line\n\nnew para");
    assert.deepEqual(kinds("first line\nsecond line\n\nnew para"), ["p", "p"]);
    assert.equal(text(bs[0].spans), "first line second line");
  });

  it("reads bullets and numbers as separate lists", () => {
    const bs = blocks("- a\n- b\n\n1. one\n2. two");
    assert.deepEqual(bs.map((b) => b.ordered), [false, true]);
    assert.equal(bs[0].items.length, 2);
    assert.equal(bs[1].items.length, 2);
  });

  it("does not merge a bullet list into a numbered one", () => {
    const bs = blocks("- a\n1. one");
    assert.equal(bs.length, 2);
  });

  it("reads a task list's checked state, which criteria and goal docs both use", () => {
    const bs = blocks("- [x] done one\n- [ ] not done");
    assert.deepEqual(bs[0].items.map((i) => i.checked), [true, false]);
    assert.equal(text(bs[0].items[0].spans), "done one");
  });

  it("folds a continuation line into the item above it", () => {
    const bs = blocks("- the first part\n  and its continuation\n- second");
    assert.equal(text(bs[0].items[0].spans), "the first part and its continuation");
    assert.equal(bs[0].items.length, 2);
  });

  it("takes a fenced block verbatim, markup and blank lines included", () => {
    const bs = blocks("before\n\n```sh\n# not a heading\n\n- not a bullet\n```\n\nafter");
    const code = bs.find((b) => b.kind === "code");
    assert.equal(code.lang, "sh");
    assert.equal(code.text, "# not a heading\n\n- not a bullet");
    // A body documenting markdown must not have it rendered.
    assert.deepEqual(kinds("before\n\n```sh\n# not a heading\n```\n\nafter"), ["p", "code", "p"]);
  });

  it("survives an unterminated fence instead of dropping the rest of the body", () => {
    const bs = blocks("intro\n\n```\nstill code\nmore code");
    assert.equal(bs.at(-1).kind, "code");
    assert.match(bs.at(-1).text, /still code/);
  });

  it("reads quotes and rules", () => {
    assert.deepEqual(kinds("> quoted\n\n---\n\nafter"), ["quote", "rule", "p"]);
    assert.equal(text(blocks("> quoted line\n> and more").spans ?? blocks("> a\n> b")[0].spans), "a b");
  });

  it("treats blank input as nothing at all", () => {
    assert.deepEqual(blocks(""), []);
    assert.deepEqual(blocks("   \n\n  "), []);
    assert.deepEqual(blocks(null), []);
    assert.deepEqual(blocks(undefined), []);
  });

  it("normalises CRLF, because a body can arrive from anywhere", () => {
    assert.deepEqual(kinds("# h\r\n\r\n- a\r\n"), ["h", "list"]);
  });
});

describe("inlines", () => {
  it("reads bold and inline code", () => {
    assert.deepEqual(inlines("a **bold** and `code` here").map((s) => s.kind), [
      "text", "strong", "text", "code", "text",
    ]);
  });

  it("leaves an unmatched marker as literal text", () => {
    assert.deepEqual(inlines("2 ** 3 is not bold").map((s) => s.kind), ["text"]);
    assert.deepEqual(inlines("a ` lone backtick").map((s) => s.kind), ["text"]);
  });

  it("keeps the text when there is no markup at all", () => {
    const spans = inlines("just words");
    assert.equal(spans.length, 1);
    assert.equal(spans[0].text, "just words");
  });

  it("does not treat an empty emphasis as bold", () => {
    assert.deepEqual(inlines("**** ").map((s) => s.kind), ["text"]);
  });
});

describe("excerpt", () => {
  it("takes the first prose block", () => {
    assert.equal(excerpt("# A heading\n\nthe first paragraph"), "A heading");
    assert.equal(excerpt("- a list first\n\nthen prose"), "then prose");
  });

  it("truncates with an ellipsis rather than mid-word forever", () => {
    const e = excerpt("x".repeat(400), 40);
    assert.equal(e.length, 40);
    assert.match(e, /…$/);
  });

  it("is empty when there is no prose", () => {
    assert.equal(excerpt(""), "");
    assert.equal(excerpt("```\ncode only\n```"), "");
  });
});

describe("nothing becomes markup", () => {
  // The whole reason this returns blocks instead of HTML: the renderer builds React elements, so
  // a body cannot inject anything. These assert the model never carries markup as a structure.
  const hostile = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '[click](javascript:alert(1))',
    '<div onclick="steal()">text</div>',
    '**bold<script>x</script>**',
  ];

  it("keeps every hostile construct as plain text", () => {
    for (const src of hostile) {
      const bs = blocks(src);
      const all = bs.flatMap((b) => b.spans ?? b.items?.flatMap((i) => i.spans) ?? [{ text: b.text ?? "" }]);
      for (const span of all) {
        assert.equal(typeof span.text, "string");
        // Only three span kinds exist, and none of them is "html".
        if (span.kind) assert.ok(["text", "strong", "code"].includes(span.kind), `unexpected kind ${span.kind}`);
      }
    }
  });

  it("produces only the block kinds the renderer knows how to draw", () => {
    const known = new Set(["h", "p", "list", "code", "quote", "rule"]);
    const src = hostile.join("\n\n") + "\n\n# h\n- a\n> q\n---\n```\nc\n```";
    for (const b of blocks(src)) assert.ok(known.has(b.kind), `unknown block kind ${b.kind}`);
  });
});
