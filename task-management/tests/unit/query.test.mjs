/**
 * `field:value` search.
 *
 * The board in the browser could always filter by epic, assignee, actor, priority and label, and
 * save the combination as a named view. `tm find` was a substring match over titles and bodies —
 * so "what is assigned to me and still open" was answerable only on the surface an agent cannot
 * use.
 *
 * The last test in this file is the one that matters in a year: it pins this module's field set to
 * the browser's, read out of `filters.ts` at test time, so the two implementations cannot drift
 * apart in silence. Same technique as the ntfy catalog test, which has caught a missing event
 * twice.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FIELDS, FIELD_NAMES, describeQuery, matchesQuery, parseQuery } from "../../lib/query.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const task = (extra = {}) => ({ id: "TM-001", kind: "task", title: "login form", body: "", status: "open", ...extra });
const hit = (doc, ...tokens) => matchesQuery(doc, parseQuery(tokens));

describe("parseQuery", () => {
  it("keeps bare words as the text needle", () => {
    assert.deepEqual(parseQuery(["the", "Half", "Remembered"]), { text: "the half remembered", filters: [] });
  });

  it("reads a field:value token", () => {
    assert.deepEqual(parseQuery(["status:open"]).filters, [{ field: "status", value: "open", negate: false }]);
  });

  it("reads a leading - as negation, the convention tm label and tm dep already use", () => {
    assert.deepEqual(parseQuery(["-label:stale"]).filters, [{ field: "label", value: "stale", negate: true }]);
  });

  it("mixes words and filters in any order", () => {
    const q = parseQuery(["epic:EP-002", "auth", "type:bug"]);
    assert.equal(q.text, "auth");
    assert.deepEqual(q.filters.map((f) => f.field), ["epic", "type"]);
  });

  it("refuses an unknown field instead of quietly searching for the text", () => {
    // `assigne:ryan` returning every task whose body contains that string is a wrong answer that
    // looks like a right one. Same stance as tm priority and tm export take on bad input.
    assert.throws(() => parseQuery(["assigne:ryan"]), /unknown search field "assigne"/);
    assert.throws(() => parseQuery(["assigne:ryan"]), /status, epic, assignee/, "the refusal has to list the fields");
  });

  it("leaves a url as a search term", () => {
    // `https:` has a colon and would otherwise parse as a field. Searching for the PR that closed
    // a task is an ordinary thing to want.
    const q = parseQuery(["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/73"]);
    assert.deepEqual(q.filters, []);
    assert.match(q.text, /pull\/73/);
  });
});

describe("matching", () => {
  it("matches a scalar field exactly, not as a substring", () => {
    assert.equal(hit(task({ status: "open" }), "status:open"), true);
    assert.equal(hit(task({ status: "in_progress" }), "status:open"), false, "`open` must not match `in_progress`");
  });

  it("is case-insensitive on the value", () => {
    assert.equal(hit(task({ assignee: "Ryan" }), "assignee:ryan"), true);
  });

  it("treats label as membership", () => {
    assert.equal(hit(task({ labels: ["ui", "perf"] }), "label:perf"), true);
    assert.equal(hit(task({ labels: ["ui"] }), "label:perf"), false);
  });

  it("ANDs every filter, including a repeated key", () => {
    const t = task({ labels: ["ui", "perf"] });
    assert.equal(hit(t, "label:ui", "label:perf"), true, "`label:a label:b` is has-both — the predictable reading");
    assert.equal(hit(t, "label:ui", "label:missing"), false);
  });

  it("negates", () => {
    assert.equal(hit(task({ labels: ["stale"] }), "-label:stale"), false);
    assert.equal(hit(task({ labels: ["ui"] }), "-label:stale"), true);
    assert.equal(hit(task({}), "-label:stale"), true, "a task with no labels does not have that label");
  });

  it("does not match a field the document has not set", () => {
    assert.equal(hit(task({}), "assignee:ryan"), false);
    assert.equal(hit(task({}), "-assignee:ryan"), true);
  });

  it("reads a bare field: as 'is set at all', which negation then makes useful", () => {
    assert.equal(hit(task({ assignee: "anyone" }), "assignee:"), true);
    assert.equal(hit(task({}), "assignee:"), false);
    assert.equal(hit(task({}), "-assignee:"), true, "`-assignee:` is the unassigned queue");
  });

  it("searches title and body for bare words, and not labels", () => {
    assert.equal(hit(task({ title: "login form" }), "login"), true);
    assert.equal(hit(task({ body: "notes about tokens" }), "tokens"), true);
    // Labels are reachable through `label:` now, so the needle keeps a stated scope rather than
    // sometimes matching metadata.
    assert.equal(hit(task({ labels: ["urgent"] }), "urgent"), false);
  });

  it("combines the text half with the filter half", () => {
    const t = task({ title: "login form", status: "open" });
    assert.equal(hit(t, "status:open", "login"), true);
    assert.equal(hit(t, "status:done", "login"), false);
    assert.equal(hit(t, "status:open", "logout"), false);
  });

  it("matches everything when given nothing, as find always did", () => {
    assert.equal(hit(task({}), ), true);
  });
});

describe("describeQuery", () => {
  it("says what was searched, so a no-match explains itself", () => {
    assert.equal(describeQuery(parseQuery(["status:open", "-label:stale", "auth"])), 'status:open -label:stale "auth"');
    assert.equal(describeQuery(parseQuery([])), "everything");
  });
});

describe("the browser and the terminal ask the same questions", () => {
  it("covers every field the dashboard filters on", () => {
    // Read out of the SPA's source at test time. The two implementations are separate because the
    // SPA imports nothing from lib/, so the only thing keeping them honest is this assertion.
    const src = readFileSync(join(HERE, "../../dashboard/src/filters.ts"), "utf8");
    const block = src.slice(src.indexOf("export interface Filters"), src.indexOf("}", src.indexOf("export interface Filters")));
    const browser = [...block.matchAll(/^\s*(\w+)\s*[?:]/gm)].map((m) => m[1]).filter((k) => k !== "text");

    assert.ok(browser.length >= 5, `parsed too few fields out of filters.ts (${browser.join(", ")}) — the parse is wrong, not the code`);
    const missing = browser.filter((k) => !(k in FIELDS));
    assert.deepEqual(missing, [], `the CLI cannot ask what the board can: ${missing.join(", ")}`);
  });

  it("exposes the field list for the help text, so the two cannot disagree", () => {
    assert.deepEqual(FIELD_NAMES, Object.keys(FIELDS));
  });
});
