/**
 * Goals, imported rather than retyped.
 *
 * `/goal` is a built-in Claude Code slash command: it turns a prompt into a persistent agent
 * looping plan → act → test → review → iterate, auto-continuing when a turn ends and the goal is
 * not met. It is a loop DRIVER with nowhere durable to keep state — which is exactly the hole
 * this store fills.
 *
 * The two halves fit because they are the same idea written twice. `/goal` requires a
 * "verifiable stop condition"; `tm done` refuses to close a task until every acceptance criterion
 * is ticked. A goal doc's success-criteria list and a task's acceptance list are the same
 * sentences. So importing one into the other makes the gate enforce the goal's own definition of
 * done instead of a restatement of its title.
 *
 * Two input shapes, both real:
 *
 *   doc      `docs/goals/*.md` as written by bytedesk-goals' plan_goal — a `# Goal: …` heading
 *            and a success-criteria list. 195 of these exist in bytedesk-platform.
 *   contract the 5-part block a user pastes into the `/goal` composer — **Objective:**,
 *            **Read first:**, **Constraints:**, **Validate:**, **Stop when:**. Zero of these are
 *            on disk, because it is a composer form rather than a file format.
 *
 * The header and item forms below are not guesses. Measured across all 195 docs:
 *   headers  `**Success criteria (verifiable):**` 107 · `## Success criteria (verifiable)` 49 ·
 *            `## Success criteria` 16
 *   items    dash bullets 118 · NUMBERED `1.` 46 · mixed 7
 *   coverage 171 parse · 24 do not (23 have no criteria section, 1 has a header with nothing
 *            under it)
 *
 * A dash-only parser under a bolded-only header — the obvious first cut — misses 46 docs, and
 * those 24 unparseable ones are why `importable()` returns criteria and lets the caller REFUSE.
 * A task created with an empty acceptance list passes `tm done` unchallenged, so a silent
 * zero-criteria import would have the gate certify a goal nobody verified. That is worse than
 * not importing at all.
 */

/** All three header forms seen in the wild, bolded-inline or as a heading. */
const CRITERIA_HEADER = /^(?:\*\*\s*success\s+criteria[^*]*\*\*|#{1,4}\s*success\s+criteria.*?)\s*:?\s*$/i;

/** Dash, asterisk or numbered. 46 of 195 docs use numbers, so this is not optional. */
const ITEM = /^\s*(?:[-*]\s+|\d+[.)]\s+)(.*)$/;

/** A new `## ` heading or a new `**Bolded:**` label ends the list. */
const SECTION_END = /^(?:#{1,6}\s|\*\*[A-Z])/;

/** `# Goal: <title> (BDP-1234)` — the heading plan_goal writes. */
const GOAL_HEADING = /^#\s*(?:goal\s*:\s*)?(.+?)\s*$/i;

const LABEL = (name) => new RegExp(`^\\*\\*\\s*${name}\\s*:\\*\\*\\s*(.*)$`, "i");

const JIRA_KEY = /\(([A-Z][A-Z0-9]+-\d+)\)\s*$/;

/** Strip markdown emphasis and backticks so a criterion reads as a sentence, not source. */
const plain = (s) =>
  String(s)
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Pull the criteria list out of a goal doc.
 *
 * Items may wrap across lines — a criterion is often a paragraph — so a continuation line that is
 * neither a new item nor a section break is appended to the item it follows.
 */
function criteriaFrom(lines) {
  const start = lines.findIndex((l) => CRITERIA_HEADER.test(l.trim()));
  if (start === -1) return [];

  const items = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (!line) continue;
    if (SECTION_END.test(line) && items.length) break;
    if (SECTION_END.test(line)) break;
    const m = ITEM.exec(line);
    if (m) {
      items.push(m[1]);
    } else if (items.length) {
      // A wrapped criterion, not a new one.
      items[items.length - 1] += ` ${line}`;
    }
  }
  return items.map(plain).filter((t) => t.length > 3);
}

function label(lines, name) {
  const re = LABEL(name);
  const hit = lines.map((l) => re.exec(l.trim())).find(Boolean);
  return hit ? plain(hit[1]) : null;
}

/**
 * Parse either shape. Returns criteria as plain strings; an empty array means "do not import",
 * which the caller must honour rather than paper over.
 */
export function parseGoalDoc(text) {
  const lines = String(text || "").split("\n");

  const objective = label(lines, "objective");
  const stopWhen = label(lines, "stop when");
  const validate = label(lines, "validate");
  const constraints = label(lines, "constraints");
  const readFirst = label(lines, "read first");

  const heading = lines.map((l) => (l.startsWith("# ") ? GOAL_HEADING.exec(l) : null)).find(Boolean);
  const headingText = heading ? plain(heading[1]) : null;

  const shape = objective || stopWhen ? "contract" : "doc";
  const rawTitle = headingText || objective || null;
  const jira = rawTitle ? JIRA_KEY.exec(rawTitle) : null;

  let criteria = criteriaFrom(lines);
  // The contract shape has no criteria list — its "Stop when" IS the verifiable condition, which
  // is precisely what an acceptance criterion is.
  if (!criteria.length && stopWhen) criteria = [stopWhen];

  return {
    shape,
    title: rawTitle ? rawTitle.replace(JIRA_KEY, "").trim() : null,
    jiraKey: jira ? jira[1] : null,
    objective,
    constraints,
    readFirst,
    validate,
    stopWhen,
    criteria,
  };
}

/**
 * The body to store on the task: what a fresh session needs, in the order it needs it, and
 * nothing that is already a first-class field.
 */
export function goalBody(parsed, source) {
  const out = [];
  if (parsed.objective) out.push(`**Objective:** ${parsed.objective}`, "");
  if (parsed.readFirst) out.push(`**Read first:** ${parsed.readFirst}`, "");
  if (parsed.constraints) out.push(`**Constraints:** ${parsed.constraints}`, "");
  if (parsed.validate) out.push(`**Validate:** \`${parsed.validate}\``, "");
  if (parsed.jiraKey) out.push(`Jira: ${parsed.jiraKey}`, "");
  if (source) out.push(`Imported from ${source}.`, "");
  // The doc is the durable statement and bytedesk-goals DELETES it when the goal is done, so the
  // criteria and the context have to survive here rather than being referenced.
  return out.join("\n").trim();
}

/**
 * Why an import was refused, in the caller's words. Naming the headers it looked for is the
 * difference between a user fixing their doc and a user filing a bug.
 */
export function refusal(source) {
  return [
    `${source} has no parseable success criteria, so importing it would create a task with an`,
    "empty acceptance list — and `tm done` does not challenge an empty list, so the gate would",
    "certify a goal nobody verified.",
    "",
    "Looked for a list under any of:",
    "  **Success criteria (verifiable):**",
    "  ## Success criteria (verifiable)",
    "  ## Success criteria",
    "…followed by `- ` bullets or `1.` numbered items; or a `**Stop when:**` line.",
    "",
    "Add one, or file the task by hand with `tm task new` plus `tm ac`.",
  ].join("\n");
}
