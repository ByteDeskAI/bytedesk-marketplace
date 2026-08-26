/**
 * Bodies must not carry the agent's own tool-call XML.
 *
 * Eleven records were written that way before this existed: seven EP-002 tasks
 * ended `...verify green.</parameter>` followed by a bare
 * `<parameter name="activeForm">` line, two carried an unclosed opening tag, and
 * one task's body was replaced wholesale by another task's progress note. The
 * store accepted all of it silently, so the corruption surfaced only when a
 * human read the tasks months later.
 *
 * The false-positive half matters as much as the rejection half — a check that
 * blocks legitimate text gets turned off.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, findToolCallMarkup, read, update } from "../../lib/store.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

describe("findToolCallMarkup", () => {
  it("catches a tag alone on a line", () => {
    // TM-069 and TM-072: an unclosed opening tag, no closer anywhere.
    assert.ok(findToolCallMarkup('notes\n<parameter name="activeForm">Doing the thing'));
  });

  it("catches a closer trailing real content", () => {
    // TM-073 through TM-079: the closer ends a line of genuine text, so it never
    // starts one and a line-start scan alone would miss every case.
    assert.ok(findToolCallMarkup("Verify: verify green on the agent.</parameter>"));
  });

  it("catches an invoke wrapper", () => {
    assert.ok(findToolCallMarkup("</invoke>"));
  });

  it("passes ordinary prose", () => {
    assert.equal(findToolCallMarkup("Move images off GitHub Actions.\n\nPhase F."), null);
  });

  it("passes generics, JSX and comparisons", () => {
    // The naive check is "contains a <", which most bodies do.
    assert.equal(findToolCallMarkup("Promise<string> and a < b and <Button disabled />"), null);
  });

  it("passes an example inside a fenced block", () => {
    // Documenting this very rule is the first thing anyone will try.
    const body = [
      "The leak looks like this:",
      "```",
      '<parameter name="activeForm">Doing the thing',
      "```",
      "Send the body only.",
    ].join("\n");
    assert.equal(findToolCallMarkup(body), null);
  });

  it("passes an empty body", () => {
    assert.equal(findToolCallMarkup(""), null);
    assert.equal(findToolCallMarkup(undefined), null);
  });
});

describe("the store refuses to persist it", () => {
  it("rejects on create", () => {
    const p = store();
    assert.throws(
      () => create("task", { title: "leaky" }, 'body\n<parameter name="activeForm">Leaking', p),
      /tool-call markup/,
    );
  });

  it("rejects on update, and leaves the stored body intact", () => {
    // The failure mode being prevented: a good record overwritten by a bad write.
    const p = store();
    const task = create("task", { title: "sound" }, "the real write-up", p);

    assert.throws(
      () => update(task.id, { body: "clobbered</parameter>" }, p),
      /tool-call markup/,
    );
    assert.equal(read(task.id, p).body.trim(), "the real write-up");
  });

  it("names the offending text so the caller can find it", () => {
    const p = store();
    assert.throws(
      () => create("task", { title: "leaky" }, "done.</parameter>", p),
      /<\/parameter>/,
    );
  });

  it("still accepts a body that documents the rule", () => {
    const p = store();
    const body = "Do not do this:\n```\n</parameter>\n```\n";
    const task = create("task", { title: "documented" }, body, p);
    assert.match(read(task.id, p).body, /Do not do this/);
  });
});
