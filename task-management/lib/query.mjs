/**
 * `field:value` search for `tm find` and `tm_find`.
 *
 * The board in the browser could always ask a field question — filter by epic, assignee, actor,
 * priority or label, and save the combination as a named view. The terminal and the agent got a
 * substring match over titles and bodies, so "what is assigned to me and still open" was a
 * question only one of the three surfaces could answer, and it was the surface an agent cannot
 * use.
 *
 * Deliberately NOT JQL. No operators, no precedence, no parentheses, no ORDER BY — the syntax is
 * `key:value` tokens the way `gh search` and GitHub's own search box work, because that is the
 * syntax people already have in their fingers, and a query language needs a parser, an error
 * surface and a manual. Bare words keep meaning exactly what they meant before.
 *
 *   tm find status:in_progress priority:highest
 *   tm find assignee:ryan -label:stale
 *   tm find epic:EP-002 type:bug "the half-remembered title"
 *
 * Every filter ANDs, including a repeated key: `label:ui label:perf` is "has both". That is the
 * predictable reading, and OR is available by running the search twice.
 *
 * The browser keeps its own copy of this in `dashboard/src/filters.ts`, which also drives the
 * dropdown options and the saved views — the SPA imports nothing from `lib/`. The two field sets
 * are pinned together by a test rather than by hope.
 */

/**
 * How each field is read off a document. A function rather than a key name because `label` is
 * membership in an array and `kind` is derived from the id, not stored.
 */
export const FIELDS = {
  status: (d) => d.status,
  epic: (d) => d.epic,
  assignee: (d) => d.assignee,
  actor: (d) => d.actor,
  priority: (d) => d.priority,
  type: (d) => d.type,
  label: (d) => d.labels || [],
  kind: (d) => d.kind,
  id: (d) => d.id,
  /** The doc a task was imported from, so `goal:` finds everything a goal produced. */
  goal: (d) => d.goalDoc,
  sprint: (d) => d.sprint,
};

export const FIELD_NAMES = Object.keys(FIELDS);

/**
 * A token is a filter when it has a known field before the colon.
 *
 * `(?!\/\/)` keeps a URL a search term: `tm find https://github.com/…/pull/73` has a colon and
 * would otherwise parse as a filter on the field `https`, and searching for the PR that closed a
 * task is an ordinary thing to want.
 */
const TOKEN = /^(-?)([a-z_]+):(?!\/\/)(.*)$/;

/**
 * Split raw argv-ish tokens into a text needle and a list of filters.
 *
 * An unrecognised field is REFUSED rather than quietly demoted to text. `assigne:ryan` returning
 * every task whose body happens to contain that string is a wrong answer that looks like a right
 * one — the same reason `tm priority` refuses an unknown level and `tm export` refuses an unknown
 * format instead of substituting a default.
 */
export function parseQuery(tokens = []) {
  const words = [];
  const filters = [];

  for (const raw of tokens) {
    const token = String(raw);
    const m = TOKEN.exec(token);
    if (!m) {
      words.push(token);
      continue;
    }
    const [, neg, field, value] = m;
    if (!(field in FIELDS)) {
      throw new Error(`unknown search field "${field}" — use one of: ${FIELD_NAMES.join(", ")}`);
    }
    // `label:` with nothing after it is a question nobody means to ask; treat the empty value as
    // "the field is set at all", which is what `-label:` then usefully negates.
    filters.push({ field, value: value.toLowerCase(), negate: neg === "-" });
  }

  return { text: words.join(" ").toLowerCase(), filters };
}

function fieldMatches(doc, { field, value }) {
  const actual = FIELDS[field](doc);
  if (Array.isArray(actual)) {
    const lowered = actual.map((v) => String(v).toLowerCase());
    return value ? lowered.includes(value) : lowered.length > 0;
  }
  if (actual === undefined || actual === null) return false;
  return value ? String(actual).toLowerCase() === value : true;
}

/**
 * Does one document satisfy a parsed query?
 *
 * The text half searches title and body, which is what `find` always did. Labels are reachable
 * through `label:` now, so the needle is not quietly widened to cover them — a substring search
 * that sometimes matches metadata and sometimes does not is worse than one with a stated scope.
 */
export function matchesQuery(doc, { text = "", filters = [] } = {}) {
  for (const f of filters) {
    if (fieldMatches(doc, f) === f.negate) return false;
  }
  if (!text) return true;
  return `${doc.title ?? ""} ${doc.body ?? ""}`.toLowerCase().includes(text);
}

/** A one-line description of what was searched, for a "no match" that explains itself. */
export function describeQuery({ text = "", filters = [] } = {}) {
  const parts = filters.map((f) => `${f.negate ? "-" : ""}${f.field}:${f.value}`);
  if (text) parts.push(`"${text}"`);
  return parts.join(" ") || "everything";
}
