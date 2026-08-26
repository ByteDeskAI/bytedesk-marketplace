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
 * The header and item forms below are measured, not guessed — over all **555** docs found
 * RECURSIVELY under bytedesk-platform/docs/goals. The first census counted only the 195 at the
 * top level, which is how two defects shipped: manifests reference nested paths like
 * `docs/goals/autonomous-agency/prerequisites/…`, so the subdirectories are not an edge case.
 *
 *   headers  `## Success criteria (verifiable)` 178 · `## Success criteria` 82 ·
 *            `## Goal (verifiable success criteria)` 8 · the bolded inline form · one-off
 *            qualifiers such as `(verifiable — strict)`
 *   items    dash bullets and NUMBERED `1.` in roughly 2:1, plus mixed lists
 *
 * Two failure modes, and they are not symmetrical:
 *
 *   zero criteria      REFUSED. A task with an empty acceptance list passes `tm done`
 *                      unchallenged, so importing one would have the gate certify a goal nobody
 *                      verified. The caller must honour an empty array.
 *   truncated criteria WORSE, and invisible. A partial list looks like a successful import and
 *                      the gate closes on a fraction of the goal. This is why the fence handling
 *                      in `criteriaFrom` exists rather than being an optimisation.
 */

/**
 * The header, bolded-inline or as a heading, with the phrase anywhere in the line.
 *
 * The first version required "success criteria" to follow the hashes immediately, which reads
 * every `## Success criteria …` correctly and silently misses the nine docs that qualify it
 * first: `## Goal (verifiable success criteria)` (8) and `## Remaining work (success criteria)`
 * (1). Census over the 555 docs under bytedesk-platform/docs/goals — `## Success criteria
 * (verifiable)` 178, `## Success criteria` 82, `## Goal (verifiable success criteria)` 8, plus
 * one-off qualifiers like `(verifiable — strict)`.
 */
const CRITERIA_HEADER = /^(?:\*\*\s*[^*]*success\s+criteria[^*]*\*\*|#{1,6}[^\n]*?success\s+criteria[^\n]*?)\s*:?\s*$/i;

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
  let fenced = false;
  // The indentation of the first item is the list's own level. Anything deeper is that item's
  // detail, not a peer — the line has to be measured BEFORE it is trimmed, which is how the
  // nesting was lost: `- Specifically removed:` has five sub-bullets under it, and flattening
  // them turned one criterion into six tickable ones. Six real criteria became eleven, and each
  // sub-clause became something a gate could be satisfied by on its own.
  let baseIndent = null;
  for (const raw of lines.slice(start + 1)) {
    const indent = /^\s*/.exec(raw)[0].replace(/\t/g, "    ").length;
    const line = raw.trim();

    /**
     * A criterion often embeds the command that verifies it, in a fence. Anything inside that
     * fence is content, not structure — and a shell comment inside one starts with `#`, which
     * SECTION_END reads as a heading.
     *
     * Measured: devproject-cleanup-and-unlocks/t1-sandbox-dead-code-sweep.md parsed to ONE
     * criterion where six exist, because criterion 1 contains a fence holding
     * `# -> must print NOTHING`. That is the worst failure this module can have — a zero-criteria
     * doc is refused, but a TRUNCATED list passes the gate, so `tm done` would certify a goal
     * with a sixth of it verified. Fence handling comes before every other test for that reason.
     */
    if (/^(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    if (!line) continue;
    if (SECTION_END.test(line)) break;
    const m = ITEM.exec(line);
    if (m) {
      if (baseIndent === null) baseIndent = indent;
      if (indent > baseIndent && items.length) {
        // A nested bullet: detail belonging to the criterion above it.
        items[items.length - 1] += ` ${m[1]}`;
      } else {
        items.push(m[1]);
      }
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
    "  ## Goal (verifiable success criteria)",
    "  …or any heading containing the phrase",
    "…followed by `- ` bullets or `1.` numbered items; or a `**Stop when:**` line.",
    "",
    "Add one, or file the task by hand with `.bytedesk/task-management/bin/tm task new` plus `.bytedesk/task-management/bin/tm ac`.",
  ].join("\n");
}

// ── manifests ────────────────────────────────────────────────────────────────

/**
 * A `*.plan.json` manifest: an epic and the goals under it.
 *
 * Measured across the 36 manifests and 506 goals in bytedesk-platform: EVERY goal carries
 * `id`, `doc`, `title`, `dependsOn`, `mode`, `needsHumanGate` and `touches`. 405 have real
 * dependencies and 498 have real touches. No JSON schema file actually exists on disk despite
 * twelve manifests declaring `$schema`, so this validates what it needs and ignores the rest
 * rather than pretending to enforce a contract nobody publishes.
 *
 * Two of those fields land somewhere that already existed and was starving:
 *
 *   dependsOn  → `blockedBy`. It is a LAND dependency in run-goals (a merged PR, per
 *                computeStartable), which is the same shape as tm's "blocker resolved".
 *   touches    → `touches`, the field `tm parallel` batches on. Nothing wrote it until the
 *                Edit/Write hook started observing edits — and a manifest has it DECLARED for
 *                498 goals, so an import makes parallel batching correct before any work starts
 *                rather than after a pass of it.
 */
export function parseManifest(text) {
  let m;
  try {
    m = JSON.parse(text);
  } catch (err) {
    return { error: `not valid JSON: ${err.message}` };
  }
  if (!m || typeof m !== "object") return { error: "not a JSON object" };
  if (!Array.isArray(m.goals)) return { error: "no `goals` array — is this a plan.json manifest?" };

  const epic = m.epic || {};
  return {
    plan: m.plan || null,
    epicTitle: epic.title || m.plan || "Imported goals",
    definitionOfDone: epic.definitionOfDone || null,
    jiraEpicKey: epic.jiraEpicKey || m.jiraEpicKey || null,
    gate: m.integration?.gate || null,
    autoMergeTo: m.integration?.autoMergeTo || null,
    goals: m.goals
      .filter((g) => g && g.id && g.doc)
      .map((g) => ({
        id: String(g.id),
        doc: String(g.doc),
        title: g.title ? String(g.title) : null,
        dependsOn: Array.isArray(g.dependsOn) ? g.dependsOn.map(String) : [],
        touches: Array.isArray(g.touches) ? g.touches.map(String) : [],
        mode: g.mode || null,
        needsHumanGate: Boolean(g.needsHumanGate),
        jiraTaskKey: g.jiraTaskKey || null,
      })),
  };
}

/**
 * The title a goal entry should carry. The manifest's own title is authoritative — it is what the
 * program was planned with — and the doc's heading is the fallback.
 */
export const manifestGoalTitle = (entry, parsedDoc) =>
  (entry.title || parsedDoc?.title || entry.id).replace(/^[A-Z][A-Z0-9]+-\d+:\s*/, "").trim();
