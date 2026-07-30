/**
 * Importing a goal doc, so a goal's own success criteria become the gate that closes it.
 *
 * `/goal` demands a "verifiable stop condition"; `tm done` refuses until every acceptance
 * criterion is ticked. Those are the same requirement, and a goal doc has already written it
 * down — so the only real work here is parsing, and the only real risk is parsing WRONG.
 *
 * Measured over all **555** docs found RECURSIVELY under bytedesk-platform/docs/goals. The first
 * census counted only the 195 at the top level, and that mistake shipped three defects — manifests
 * reference nested paths, so subdirectories were never an edge case.
 *
 * Two failure modes, asymmetrical:
 *   zero criteria      REFUSED, because a task with an empty acceptance list passes `tm done`
 *                      unchallenged and the gate would certify a goal nobody verified.
 *   truncated/inflated WORSE, because both look like a successful import. A fence inside a
 *                      criterion used to end the list (1 criterion where 6 existed) and nested
 *                      sub-bullets used to become peers (11 where 6 existed).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { goalBody, manifestGoalTitle, parseGoalDoc, parseManifest, refusal } from "../../lib/goals.mjs";

const doc = (body) => `# Goal: Do the thing (BDP-1234)\n\n${body}\n`;

describe("the three header forms, all of which exist in the wild", () => {
  it("reads the bolded inline form — 107 of 195 docs", () => {
    const p = parseGoalDoc(doc("**Success criteria (verifiable):**\n- first thing is true\n- second thing is true\n"));
    assert.deepEqual(p.criteria, ["first thing is true", "second thing is true"]);
  });

  it("reads the heading form with the parenthetical — 49 docs", () => {
    const p = parseGoalDoc(doc("## Success criteria (verifiable)\n\n- only thing is true\n"));
    assert.deepEqual(p.criteria, ["only thing is true"]);
  });

  it("reads the bare heading form — 16 docs", () => {
    const p = parseGoalDoc(doc("## Success criteria\n\n- only thing is true\n"));
    assert.deepEqual(p.criteria, ["only thing is true"]);
  });

  it("is case-insensitive about the header", () => {
    assert.equal(parseGoalDoc(doc("## SUCCESS CRITERIA\n\n- a thing\n")).criteria.length, 1);
  });
});

describe("both item forms", () => {
  it("reads numbered items — 46 of 195 docs, which a dash-only parser drops entirely", () => {
    const p = parseGoalDoc(doc("**Success criteria (verifiable):**\n1. first thing\n2. second thing\n3. third thing\n"));
    assert.deepEqual(p.criteria, ["first thing", "second thing", "third thing"]);
  });

  it("reads a mixed list — 7 docs", () => {
    const p = parseGoalDoc(doc("## Success criteria\n- dashed one\n2. numbered one\n"));
    assert.deepEqual(p.criteria, ["dashed one", "numbered one"]);
  });

  it("accepts asterisk bullets and `1)` numbering", () => {
    const p = parseGoalDoc(doc("## Success criteria\n* starred one\n2) parenthesised one\n"));
    assert.deepEqual(p.criteria, ["starred one", "parenthesised one"]);
  });

  it("joins a wrapped criterion instead of splitting it in two", () => {
    // Real criteria are paragraphs and wrap. A continuation line is not a new criterion.
    const p = parseGoalDoc(doc("## Success criteria\n- the first part of a long one\n  and its continuation\n- the second\n"));
    assert.deepEqual(p.criteria, ["the first part of a long one and its continuation", "the second"]);
  });

  it("stops at the next section rather than swallowing the rest of the doc", () => {
    const p = parseGoalDoc(doc("## Success criteria\n- a real one\n\n## Why / the problem to solve\n\n- not a criterion\n"));
    assert.deepEqual(p.criteria, ["a real one"]);
  });

  it("stops at the next bolded label too", () => {
    const p = parseGoalDoc(doc("**Success criteria (verifiable):**\n- a real one\n\n**Context already in place:**\n- not a criterion\n"));
    assert.deepEqual(p.criteria, ["a real one"]);
  });
});

describe("the title and the Jira key", () => {
  it("takes the title from the # Goal: heading and lifts the Jira key out of it", () => {
    const p = parseGoalDoc(doc("## Success criteria\n- a thing\n"));
    assert.equal(p.title, "Do the thing");
    assert.equal(p.jiraKey, "BDP-1234");
  });

  it("copes with a heading that has no Jira key", () => {
    const p = parseGoalDoc("# Goal: Just a title\n\n## Success criteria\n- a thing\n");
    assert.equal(p.title, "Just a title");
    assert.equal(p.jiraKey, null);
  });

  it("copes with a plain # heading that does not say Goal:", () => {
    assert.equal(parseGoalDoc("# Something else\n\n## Success criteria\n- a thing\n").title, "Something else");
  });
});

describe("the /goal composer contract, which is a different shape entirely", () => {
  const contract = [
    "**Objective:** Migrate this project from Pydantic v1 to v2.",
    "**Read first:** pyproject.toml, src/, tests/",
    "**Constraints:** no public API changes; no new dependencies",
    "**Validate:** `pytest -q` after each change",
    "**Stop when:** pytest -q is green with no deprecation warnings",
  ].join("\n");

  it("is recognised as a contract rather than a doc", () => {
    assert.equal(parseGoalDoc(contract).shape, "contract");
    assert.equal(parseGoalDoc(doc("## Success criteria\n- a thing\n")).shape, "doc");
  });

  it("takes its title from Objective, since it has no heading", () => {
    assert.equal(parseGoalDoc(contract).title, "Migrate this project from Pydantic v1 to v2.");
  });

  it("turns `Stop when` into the acceptance criterion, because that IS the verifiable condition", () => {
    assert.deepEqual(parseGoalDoc(contract).criteria, ["pytest -q is green with no deprecation warnings"]);
  });

  it("keeps the validate command, which is what evidence gets attached from", () => {
    assert.equal(parseGoalDoc(contract).validate, "pytest -q after each change");
  });

  it("prefers a real criteria list over Stop when, when a doc has both", () => {
    const both = `${contract}\n\n## Success criteria\n- the explicit one\n`;
    assert.deepEqual(parseGoalDoc(both).criteria, ["the explicit one"]);
  });
});

describe("what must be refused", () => {
  it("finds nothing in a doc with no criteria section — 23 of 195", () => {
    const p = parseGoalDoc("# Goal: A goal with no criteria\n\n## Why\n\nBecause.\n");
    assert.deepEqual(p.criteria, []);
  });

  it("finds nothing when the header has no items under it — 1 of 195", () => {
    const p = parseGoalDoc(doc("## Success criteria\n\n## Why / the problem to solve\n\nprose only\n"));
    assert.deepEqual(p.criteria, []);
  });

  it("drops an item too short to be a criterion", () => {
    assert.deepEqual(parseGoalDoc(doc("## Success criteria\n- ok\n- a real criterion here\n")).criteria, ["a real criterion here"]);
  });

  it("names every header it looked for, so a user can fix the doc", () => {
    const text = refusal("docs/goals/x.md");
    assert.match(text, /docs\/goals\/x\.md/);
    assert.match(text, /\*\*Success criteria \(verifiable\):\*\*/);
    assert.match(text, /## Success criteria/);
    assert.match(text, /numbered/);
    // The reason matters more than the rule: an empty acceptance list is not challenged.
    assert.match(text, /certify a goal nobody verified/);
  });
});

describe("normalising a criterion", () => {
  it("strips bold and backticks so it reads as a sentence", () => {
    const p = parseGoalDoc(doc("## Success criteria\n- **zero** missed wakes per `run_ledger` query\n"));
    assert.deepEqual(p.criteria, ["zero missed wakes per run_ledger query"]);
  });

  it("collapses whitespace", () => {
    assert.deepEqual(parseGoalDoc(doc("## Success criteria\n- a    spaced     out    thing\n")).criteria, ["a spaced out thing"]);
  });
});

describe("the body it stores", () => {
  it("carries what a fresh session needs, and the provenance", () => {
    const p = parseGoalDoc(`# Goal: T (BDP-9)\n\n**Objective:** do it\n**Constraints:** touch nothing else\n**Validate:** \`make test\`\n\n## Success criteria\n- a thing\n`);
    const body = goalBody(p, "docs/goals/t.md");

    assert.match(body, /\*\*Objective:\*\* do it/);
    assert.match(body, /\*\*Constraints:\*\* touch nothing else/);
    assert.match(body, /make test/);
    assert.match(body, /Jira: BDP-9/);
    // bytedesk-goals DELETES a goal doc when it is done, so the store cannot merely reference it.
    assert.match(body, /Imported from docs\/goals\/t\.md/);
  });

  it("omits sections a doc does not have, rather than printing empty labels", () => {
    const body = goalBody(parseGoalDoc(doc("## Success criteria\n- a thing\n")), "x.md");
    assert.ok(!body.includes("**Constraints:**"));
    assert.ok(!body.includes("**Validate:**"));
  });

  it("survives an empty document without throwing", () => {
    const p = parseGoalDoc("");
    assert.equal(p.title, null);
    assert.deepEqual(p.criteria, []);
    assert.equal(goalBody(p, null), "");
  });
});

describe("manifests", () => {
  const manifest = (goals, extra = {}) =>
    JSON.stringify({
      plan: "a-program",
      epic: { title: "A Program", definitionOfDone: "everything lands", jiraEpicKey: "BDP-1" },
      integration: { gate: "make ci", autoMergeTo: "develop" },
      goals,
      ...extra,
    });

  it("reads the epic, the gate and the goals", () => {
    const m = parseManifest(manifest([{ id: "a", doc: "docs/goals/a.md", title: "Do A" }]));
    assert.equal(m.epicTitle, "A Program");
    assert.equal(m.definitionOfDone, "everything lands");
    assert.equal(m.gate, "make ci");
    assert.equal(m.autoMergeTo, "develop");
    assert.equal(m.jiraEpicKey, "BDP-1");
    assert.equal(m.goals.length, 1);
  });

  it("carries the four fields every one of 506 real goals has", () => {
    const m = parseManifest(
      manifest([
        { id: "a", doc: "d/a.md", title: "A", dependsOn: ["b"], mode: "sequential", needsHumanGate: true, touches: ["src/x.ts"] },
      ]),
    );
    const g = m.goals[0];
    assert.deepEqual(g.dependsOn, ["b"]);
    assert.deepEqual(g.touches, ["src/x.ts"]);
    assert.equal(g.mode, "sequential");
    assert.equal(g.needsHumanGate, true);
  });

  it("defaults the absent ones rather than throwing", () => {
    const g = parseManifest(manifest([{ id: "a", doc: "d/a.md" }])).goals[0];
    assert.deepEqual(g.dependsOn, []);
    assert.deepEqual(g.touches, []);
    assert.equal(g.needsHumanGate, false);
    assert.equal(g.title, null);
  });

  it("drops a goal with no id or no doc, since neither can be recovered", () => {
    const m = parseManifest(manifest([{ id: "a", doc: "d/a.md" }, { id: "b" }, { doc: "d/c.md" }]));
    assert.deepEqual(m.goals.map((g) => g.id), ["a"]);
  });

  it("refuses a file that is not a manifest, by name", () => {
    assert.match(parseManifest("{}").error, /no `goals` array/);
    assert.match(parseManifest("not json").error, /not valid JSON/);
    assert.match(parseManifest("[]").error, /no `goals` array/);
  });

  it("falls back to plan for the epic title when epic.title is absent", () => {
    const m = parseManifest(JSON.stringify({ plan: "just-a-plan", goals: [{ id: "a", doc: "d/a.md" }] }));
    assert.equal(m.epicTitle, "just-a-plan");
  });
});

describe("manifestGoalTitle", () => {
  it("prefers the manifest's own title — it is what the program was planned with", () => {
    assert.equal(manifestGoalTitle({ id: "x", title: "Manifest title" }, { title: "Doc title" }), "Manifest title");
  });

  it("falls back to the doc heading, then the id", () => {
    assert.equal(manifestGoalTitle({ id: "x" }, { title: "Doc title" }), "Doc title");
    assert.equal(manifestGoalTitle({ id: "x" }, null), "x");
  });

  it("strips a leading Jira key, which the store keeps as a field instead", () => {
    assert.equal(manifestGoalTitle({ id: "x", title: "BDP-3077: Contain the exposure" }, null), "Contain the exposure");
  });
});


describe("the three defects that shipped in the first version", () => {
  it("reads a heading that qualifies the phrase instead of leading with it", () => {
    // `## Goal (verifiable success criteria)` — 8 docs — plus `## Remaining work (success
    // criteria)`. The first regex required the phrase immediately after the hashes.
    for (const header of [
      "## Goal (verifiable success criteria)",
      "## Remaining work (success criteria)",
      "## Success criteria (verifiable — strict)",
      "#### Success criteria",
    ]) {
      const p = parseGoalDoc(`# Goal: T\n\n${header}\n- a real criterion here\n`);
      assert.deepEqual(p.criteria, ["a real criterion here"], `missed: ${header}`);
    }
  });

  it("does not let a fence inside a criterion end the list", () => {
    // The measured case: a criterion embeds the command that verifies it, and the command has a
    // `#` comment, which SECTION_END read as a heading. One criterion survived out of six — and a
    // truncated list passes the gate, which is worse than refusing.
    const md = [
      "# Goal: T",
      "",
      "**Success criteria (verifiable):**",
      "- first, prove it with:",
      "  ```bash",
      "  grep -rn thing src/",
      "  # → must print NOTHING",
      "  ```",
      "- second criterion",
      "- third criterion",
      "",
      "## Why / the problem to solve",
      "",
      "- not a criterion",
    ].join("\n");

    const p = parseGoalDoc(md);
    assert.equal(p.criteria.length, 3, `truncated or over-read: ${JSON.stringify(p.criteria)}`);
    assert.match(p.criteria[0], /^first, prove it with/);
    // The fence body must not become criterion text either.
    assert.ok(!p.criteria.join(" ").includes("grep -rn"));
    assert.ok(!p.criteria.join(" ").includes("must print NOTHING"));
  });

  it("still stops at a real section boundary, so the fence fix did not disable SECTION_END", () => {
    const p = parseGoalDoc("# Goal: T\n\n## Success criteria\n- a real one\n\n**Definition of done:**\n- not a criterion\n");
    assert.deepEqual(p.criteria, ["a real one"]);
  });

  it("folds a nested sub-bullet into its parent instead of promoting it to a peer", () => {
    // `- Specifically removed:` with five sub-bullets turned 6 criteria into 11, and each
    // sub-clause became something a gate could be satisfied by on its own.
    const md = [
      "# Goal: T",
      "",
      "## Success criteria",
      "- parent criterion:",
      "  - first detail",
      "  - second detail",
      "- sibling criterion",
    ].join("\n");

    const p = parseGoalDoc(md);
    assert.equal(p.criteria.length, 2);
    assert.match(p.criteria[0], /parent criterion.*first detail.*second detail/);
    assert.equal(p.criteria[1], "sibling criterion");
  });

  it("treats tabs as indentation too", () => {
    const p = parseGoalDoc("# Goal: T\n\n## Success criteria\n- parent\n\t- detail\n- sibling\n");
    assert.equal(p.criteria.length, 2);
  });
});

describe("the real corpus", () => {
  // A census in a comment goes stale silently — that is exactly how the first version shipped
  // with the wrong number. This asserts it against the documents themselves, and is a no-op
  // anywhere the corpus is absent, which is every machine but this one.
  const CORPUS = "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-platform/docs/goals";

  it("parses the overwhelming majority, and refuses only non-goals", (t) => {
    if (!existsSync(CORPUS)) return t.skip("corpus not present");
    const files = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (e.name.endsWith(".md")) files.push(join(dir, e.name));
      }
    };
    walk(CORPUS);

    assert.ok(files.length > 400, `expected the recursive corpus, found ${files.length} — is this only the top level?`);

    const zero = files.filter((f) => !parseGoalDoc(readFileSync(f, "utf8")).criteria.length);
    assert.ok(zero.length / files.length < 0.08, `${zero.length}/${files.length} parse to zero`);

    // Every refusal should be something that is not a goal.
    const suspicious = zero.filter((f) => !/README|CONTEXT|CONTINUATION|JIRA|EPIC|design-brief|audit|sweep|loop|baseline|coverage|surface|foundation|decomposition|preview|hardening|dashboard|agent\.md/i.test(f));
    assert.ok(suspicious.length <= 4, `unexpected refusals:\n${suspicious.join("\n")}`);
  });

  it("finds a plausible number of criteria per doc", (t) => {
    if (!existsSync(CORPUS)) return t.skip("corpus not present");
    const counts = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(dir, e.name));
        else if (e.name.endsWith(".md")) {
          const n = parseGoalDoc(readFileSync(join(dir, e.name), "utf8")).criteria.length;
          if (n) counts.push(n);
        }
      }
    };
    walk(CORPUS);
    counts.sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)];
    // A truncating parser drops this toward 1; a flattening one inflates it.
    assert.ok(median >= 4 && median <= 10, `median ${median} criteria per doc looks wrong`);
  });
});
