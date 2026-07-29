/**
 * `tm export` — four shapes, one board.
 *
 * The bulk of these are about CSV quoting, and that is not padding: a task titled
 * `fix the "done" gate, properly` silently shifts every later column of its row if
 * the escaping is wrong, and the file still opens cleanly in a spreadsheet. A broken
 * export that looks fine is worse than one that fails.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, update } from "../../lib/store.mjs";
import { csvField, exportStore, toCsv, toJson, toMarkdown, toPm } from "../../lib/export.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

/** Minimal RFC 4180 reader, so the tests parse the CSV rather than regex it. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function seed(p) {
  const epic = create("epic", { title: "Ship the thing" }, "Why this epic exists.", p);
  const first = create(
    "task",
    {
      title: 'fix the "done" gate, properly',
      epic: epic.id,
      priority: "high",
      assignee: "ryan",
      estimate: 3,
      labels: ["ui", "urgent"],
      acceptance: [{ text: "it refuses without criteria", done: true }, { text: "and says why", done: false }],
      commits: ["abc1234"],
      blockedBy: [],
      blocks: [],
      evidence: [],
    },
    "A body with\ntwo lines.",
    p,
  );
  const second = create("task", { title: "second", epic: epic.id, blockedBy: [first.id], blocks: [] }, "", p);
  update(second.id, { status: "blocked" }, p);
  return { epic: epic.id, first: first.id, second: second.id };
}

describe("csvField", () => {
  it("leaves an ordinary value alone", () => {
    assert.equal(csvField("plain"), "plain");
    assert.equal(csvField("TM-001"), "TM-001");
  });

  it("quotes a comma", () => {
    assert.equal(csvField("a, b"), '"a, b"');
  });

  it("quotes and doubles an embedded quote", () => {
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
  });

  it("quotes a newline, which is legal inside a quoted field", () => {
    assert.equal(csvField("one\ntwo"), '"one\ntwo"');
    assert.equal(csvField("one\r\ntwo"), '"one\r\ntwo"');
  });

  it("renders null and undefined as empty, not as the word", () => {
    assert.equal(csvField(null), "");
    assert.equal(csvField(undefined), "");
    assert.equal(csvField(0), "0", "and zero is not empty");
  });
});

describe("csv", () => {
  it("keeps a title with a quote and a comma in one field", () => {
    const p = store();
    const ids = seed(p);
    const rows = parseCsv(toCsv({}, p));

    const header = rows[0];
    const row = rows.find((r) => r[0] === ids.first);
    assert.equal(row.length, header.length, "a mis-quoted field shifts every later column");
    assert.equal(row[header.indexOf("Summary")], 'fix the "done" gate, properly');
  });

  it("keeps a multi-line body and multi-line criteria intact", () => {
    const p = store();
    const ids = seed(p);
    const rows = parseCsv(toCsv({}, p));
    const header = rows[0];
    const row = rows.find((r) => r[0] === ids.first);

    assert.equal(row[header.indexOf("Description")], "A body with\ntwo lines.");
    assert.match(row[header.indexOf("Acceptance Criteria")], /\[x\] it refuses without criteria\n\[ \] and says why/);
  });

  it("carries the Jira-shaped fields", () => {
    const p = store();
    const ids = seed(p);
    const rows = parseCsv(toCsv({}, p));
    const header = rows[0];
    const row = rows.find((r) => r[0] === ids.first);
    const cell = (name) => row[header.indexOf(name)];

    assert.equal(cell("Priority"), "high");
    assert.equal(cell("Assignee"), "ryan");
    assert.equal(cell("Story Points"), "3");
    assert.equal(cell("Labels"), "ui urgent");
    assert.equal(cell("Epic Link"), ids.epic);
  });

  it("translates status into Jira's vocabulary", () => {
    const p = store();
    const ids = seed(p);
    const rows = parseCsv(toCsv({}, p));
    const header = rows[0];
    assert.equal(rows.find((r) => r[0] === ids.second)[header.indexOf("Status")], "Blocked");
  });

  it("emits a header even for an empty board", () => {
    const rows = parseCsv(toCsv({}, store()));
    assert.equal(rows.length, 1);
    assert.equal(rows[0][0], "Issue ID");
  });
});

describe("filters", () => {
  it("scopes to one epic", () => {
    const p = store();
    seed(p);
    create("task", { title: "elsewhere", epic: "EP-999" }, "", p);

    const rows = parseCsv(toCsv({ epic: "EP-001" }, p));
    assert.equal(rows.length - 1, 2);
  });

  it("scopes to one status", () => {
    const p = store();
    const ids = seed(p);
    const rows = parseCsv(toCsv({ status: "blocked" }, p));
    assert.deepEqual(rows.slice(1).map((r) => r[0]), [ids.second]);
  });

  it("drops done work with includeDone false", () => {
    const p = store();
    const ids = seed(p);
    update(ids.first, { status: "done" }, p);

    assert.equal(parseCsv(toCsv({ includeDone: false }, p)).length - 1, 1);
    assert.equal(parseCsv(toCsv({}, p)).length - 1, 2);
  });
});

describe("markdown", () => {
  it("files tasks under their epic with progress", () => {
    const p = store();
    seed(p);
    const md = toMarkdown({}, p);

    assert.match(md, /## EP-001 Ship the thing — 0\/2 done/);
    assert.match(md, /### ⊘ TM-002 second/);
    assert.match(md, /Why this epic exists\./);
  });

  it("carries criteria, facts and commits", () => {
    const p = store();
    seed(p);
    const md = toMarkdown({}, p);

    assert.match(md, /- \[x\] it refuses without criteria/);
    assert.match(md, /@ryan · high · 3 pts · 1\/2 AC/);
    assert.match(md, /Commits: abc1234/);
  });

  it("gives tasks with no epic a home rather than dropping them", () => {
    const p = store();
    create("task", { title: "loose", epic: null }, "", p);

    assert.match(toMarkdown({}, p), /## No epic[\s\S]*loose/);
  });

  it("says what a blocked task is waiting on", () => {
    const p = store();
    const ids = seed(p);
    assert.match(toMarkdown({}, p), new RegExp(`blocked by ${ids.first}`));
  });
});

describe("json", () => {
  it("carries every entity without the on-disk file path", () => {
    const p = store();
    seed(p);
    const doc = toJson({}, p);

    assert.equal(doc.tasks.length, 2);
    assert.equal(doc.epics.length, 1);
    assert.ok(doc.metrics, "the metrics block is what makes it a report and not a dump");
    assert.ok(!("file" in doc.tasks[0]), "an absolute path from another machine is noise");
  });

  it("includes the event log only when asked", () => {
    const p = store();
    seed(p);
    assert.equal("events" in toJson({}, p), false);
    assert.ok(toJson({ events: true }, p).events.length > 0);
  });
});

describe("project-management payloads", () => {
  it("emits one create payload per task, in pm's field names", () => {
    const p = store();
    const ids = seed(p);
    const out = toPm({}, p);

    assert.equal(out.tool, "pm_issue_create");
    const first = out.issues.find((i) => i._source === ids.first);
    assert.equal(first.priority, "high");
    assert.equal(first.assignee, "ryan");
    assert.deepEqual(first.acceptance_criteria, ["it refuses without criteria", "and says why"]);
    assert.deepEqual(first.tags, ["ui", "urgent"]);
    assert.equal(first.epic_id, ids.epic);
  });

  it("keeps the tm id traceable in the description, not the title", () => {
    const p = store();
    const ids = seed(p);
    const first = toPm({}, p).issues.find((i) => i._source === ids.first);

    assert.equal(first.title, 'fix the "done" gate, properly', "the title is the title");
    assert.match(first.description, new RegExp(`task-management ${ids.first}`), "an untraceable import is a one-way door");
  });

  it("emits the transitions pm_issue_create cannot express", () => {
    const p = store();
    const ids = seed(p);
    update(ids.first, { status: "in_progress" }, p);
    const out = toPm({}, p);

    // pm always creates at TODO, so anything else needs a second call.
    assert.deepEqual(
      out.transitions.sort((a, b) => a._source.localeCompare(b._source)),
      [
        { _source: ids.first, status: "IN_PROGRESS" },
        { _source: ids.second, status: "NEEDS_INPUT" },
      ],
    );
  });

  it("maps parked to TODO and records it as a tag, since pm has no parked", () => {
    const p = store();
    const ids = seed(p);
    update(ids.second, { status: "parked" }, p);
    const out = toPm({}, p);

    assert.ok(!out.transitions.some((t) => t._source === ids.second), "TODO is the create default");
    assert.ok(out.issues.find((i) => i._source === ids.second).tags.includes("parked"), "or the state is simply lost");
  });

  it("carries which criteria are already met, 1-based like tm accept", () => {
    const p = store();
    const ids = seed(p);
    const met = toPm({}, p).criteriaDone.find((c) => c._source === ids.first);
    assert.deepEqual(met.met, [1]);
  });

  it("drops an epic reference pm could not resolve", () => {
    const p = store();
    create("task", { title: "orphan", epic: "EP-404" }, "", p);
    assert.equal(toPm({}, p).issues[0].epic_id, null);
  });
});

describe("exportStore", () => {
  it("dispatches every advertised format", () => {
    const p = store();
    seed(p);
    for (const format of ["md", "csv", "json", "pm"]) {
      assert.ok(exportStore(format, {}, p).length > 10, `${format} produced nothing`);
    }
  });

  it("refuses a format it does not have, naming the ones it does", () => {
    assert.throws(() => exportStore("xlsx", {}, store()), /unknown format "xlsx".*md, csv, json, pm/s);
  });

  it("ends every format with a newline, so it concatenates and pipes cleanly", () => {
    const p = store();
    seed(p);
    for (const format of ["md", "csv", "json", "pm"]) {
      assert.equal(exportStore(format, {}, p).at(-1), "\n", format);
    }
  });
});
