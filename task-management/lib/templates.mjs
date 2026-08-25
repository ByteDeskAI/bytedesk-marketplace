/**
 * Task templates — recurring work starts with the same shape every time.
 *
 * A template is just another entity file: `<store>/templates/<name>.md`,
 * frontmatter + body, same parseDoc/serializeDoc as everything else. The
 * frontmatter is defaults merged into the new task; the body is the task's
 * body skeleton. `description` is the one reserved key — it describes the
 * template for `tm task new --template`, and never reaches the task.
 *
 * Seeding is deliberately additive: a template a human has edited is theirs,
 * so we only ever write a name that doesn't exist yet.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths.mjs";
import { parseDoc, serializeDoc } from "./store.mjs";

/** The starters. Written to be usable as-is — a checklist someone would actually fill in. */
const STARTERS = {
  bug: [
    {
      description: "a defect with a known repro, closed by a regression test",
      acceptance: ["a regression test fails before the fix and passes after"],
      type: "bug",
      labels: ["bug"],
    },
    `## Repro

1.
2.

## Expected

## Actual

## Notes

Where it was first seen (log line, session, commit), and anything already ruled out.
`,
  ],
  spike: [
    {
      description: "a timeboxed investigation that ends in a written answer",
      acceptance: ["the question is answered in writing, in this task or an ADR"],
      type: "spike",
      labels: ["spike"],
    },
    `## Question

The one thing this spike exists to answer. If it needs two, it is two spikes.

## Timebox

e.g. 2h — when it is spent, write down what you learned and stop.

## Ends when

The artifact that closes this: an ADR, a benchmark number, a working throwaway
branch, or a written "no, because".

## Findings
`,
  ],
  interview: [
    {
      description: "HITL interview that records a decision on the task",
      acceptance: ["the answer is written on this task under ## Answer"],
      type: "spike",
      labels: ["decision:interview"],
    },
    `## Question

The decision this interview settles.

## Answer

`,
  ],
  research: [
    {
      description: "AFK research whose findings are attached as evidence",
      acceptance: [
        "the question is answered in writing",
        "findings are attached as evidence under .bytedesk/task-management/research/",
      ],
      type: "spike",
      labels: ["decision:research"],
    },
    `## Question

The fact this research must surface.

## Answer

`,
  ],
  prototype: [
    {
      description: "HITL prototype; a human chooses the variant",
      acceptance: ["a human chose a variant and the pointer is stored as evidence"],
      type: "spike",
      labels: ["decision:prototype"],
    },
    `## Question

What should this look like, or how should it behave?

The agent must not pick the variant. Record the human's choice and the throwaway path under ## Answer.

## Answer

`,
  ],
  unblock: [
    {
      description: "manual work that unblocks a decision, not a slice of the build",
      acceptance: ["the blocking work is done and any resulting facts are recorded under ## Answer"],
      type: "chore",
      labels: ["decision:unblock"],
    },
    `## Question

What must happen before a decision can be made (access, signup, data move).

## Answer

`,
  ],
  chore: [
    {
      description: "maintenance with no user-visible behaviour change",
      acceptance: ["the existing test suite passes unchanged"],
      type: "chore",
      labels: ["chore"],
    },
    `## Scope

Exactly what is being changed, and what is explicitly out of scope.

## Blast radius

What breaks if this goes wrong, who notices, and how it gets reverted.

## Notes
`,
  ],
};

/** Names are filenames. Anything that could escape the templates dir is refused outright. */
function safeName(name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(name)) || String(name).includes("..")) {
    throw new Error(`unsafe template name: ${name}`);
  }
  return String(name);
}

function file(name, p) {
  return join(p.templates, `${safeName(name)}.md`);
}

/** Writes any starter that isn't there yet. Returns the names it created. */
export function seedTemplates(p = paths()) {
  mkdirSync(p.templates, { recursive: true });
  const created = [];
  for (const [name, [data, body]] of Object.entries(STARTERS)) {
    const target = file(name, p);
    if (existsSync(target)) continue;
    writeFileSync(target, serializeDoc(data, body));
    created.push(name);
  }
  return created;
}

export function listTemplates(p = paths()) {
  if (!p.templates || !existsSync(p.templates)) return [];
  return readdirSync(p.templates)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .sort()
    .map((name) => ({ name, description: readTemplate(name, p)?.fields.description || "" }));
}

/** `{ name, fields, body }`, or null when there is no such template. */
export function readTemplate(name, p = paths()) {
  const target = file(name, p);
  if (!existsSync(target)) return null;
  const { data, body } = parseDoc(readFileSync(target, "utf8"));
  return { name: safeName(name), fields: data, body };
}

/**
 * Template defaults + caller fields → `{ fields, body }` for `create()`.
 *
 * The caller always wins, with one exception: an empty array counts as absent.
 * `tm task new` hands create() `acceptance: []`, `labels: []` and friends as
 * defaults, and those must not silently erase what the template supplied.
 */
export function applyTemplate(name, fields = {}, p = paths()) {
  const tpl = readTemplate(name, p);
  if (!tpl) throw new Error(`no such template: ${name}`);
  const { description, acceptance, ...defaults } = tpl.fields;
  const merged = { ...fields };
  for (const [key, value] of Object.entries({ ...defaults, acceptance: normalize(acceptance) })) {
    if (value === undefined) continue;
    if (!supplied(merged[key])) merged[key] = value;
  }
  return { fields: merged, body: tpl.body };
}

const supplied = (v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

/** Acceptance is written as plain strings in a template; the store wants {text,done}. */
function normalize(acceptance) {
  if (!Array.isArray(acceptance)) return undefined;
  return acceptance.map((a) => (typeof a === "string" ? { text: a, done: false } : a));
}
