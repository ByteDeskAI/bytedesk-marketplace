/**
 * Which AskUserQuestion is worth an ADR, and what that ADR says.
 *
 * A day of normal work asks dozens of questions; two or three of them decide
 * something. Capturing all of them buries the ones that matter, so the default
 * ("smart") keeps only questions that offered real alternatives and got one of
 * them picked. Every skip carries a reason string meant for a log line — when an
 * ADR doesn't appear, that string is the whole explanation.
 */
import { createHash } from "node:crypto";
import { create, list, now, read, update } from "./store.mjs";
import { paths } from "./paths.mjs";

/** Options that are just a confirmation dressed as a choice. */
const YES_NO = new Set(["yes", "no", "y", "n", "ok", "cancel", "confirm", "abort"]);

const norm = (s) => String(s ?? "").trim();

/**
 * Answers arrive keyed by question text, and only in tool_response on a real
 * hook — but the older payloads carried them inline, so accept both.
 */
function answersOf(hookInput) {
  return hookInput?.tool_response?.answers || hookInput?.tool_input?.answers || {};
}

const questionsOf = (hookInput) => hookInput?.tool_input?.questions || [];

/** The answer for a question, as an array — multiSelect gives several. */
function picksFor(question, answers) {
  const raw = answers[question.question] ?? answers[question.header];
  if (raw === undefined || raw === null) return [];
  return (Array.isArray(raw) ? raw : [raw]).map(norm).filter(Boolean);
}

const labels = (question) => (question.options || []).map((o) => norm(o.label));

/** A question is decided when every pick is one of the options it offered. */
function isDecided(question, answers) {
  const picks = picksFor(question, answers);
  if (!picks.length) return false;
  const offered = new Set(labels(question));
  return picks.every((pick) => offered.has(pick));
}

const isYesNo = (question) => labels(question).every((l) => YES_NO.has(l.toLowerCase()));

/**
 * The question this ADR is about: the first one that actually decided something,
 * falling back to the first asked so rendering never comes up empty.
 */
function primary(hookInput) {
  const questions = questionsOf(hookInput);
  const answers = answersOf(hookInput);
  return questions.find((q) => isDecided(q, answers)) || questions[0] || null;
}

export function shouldCapture(hookInput, config = {}) {
  const mode = config.captureDecisions ?? "smart";
  if (mode === false) return { capture: false, reason: "captureDecisions is false — capture disabled" };

  const questions = questionsOf(hookInput);
  const answers = answersOf(hookInput);
  if (!questions.length) return { capture: false, reason: "no questions in the payload" };
  if (!Object.keys(answers).length) return { capture: false, reason: "no answer recorded — question was cancelled or the response is missing" };

  if (mode === true) return { capture: true, reason: "captureDecisions is true — capturing every question" };

  // ponytail: any value other than true/false means the smart rules; "smart" is
  // the documented spelling, and a typo failing safe (capture) beats it failing silent.
  const substantive = questions.filter((q) => (q.options || []).length >= 2 && !isYesNo(q));
  if (!substantive.length) {
    const only = questions[0];
    const reason = isYesNo(only)
      ? `"${norm(only.header) || norm(only.question)}" was a yes/no confirmation, not a decision`
      : `"${norm(only.header) || norm(only.question)}" offered fewer than 2 options — a clarification, not a decision`;
    return { capture: false, reason };
  }

  const decided = substantive.find((q) => isDecided(q, answers));
  if (!decided) {
    return {
      capture: false,
      reason: `"${norm(substantive[0].header) || norm(substantive[0].question)}" was answered with free-text ("Other") — no offered option was chosen`,
    };
  }
  return { capture: true, reason: `"${norm(decided.header) || norm(decided.question)}" chose between ${labels(decided).length} alternatives` };
}

/**
 * A stable id for the *question set*, not the answer — asking the same thing
 * again after changing your mind must land on the same ADR.
 */
export function decisionKey(hookInput) {
  const material = questionsOf(hookInput)
    .map((q) => [norm(q.question) || norm(q.header), ...labels(q).sort()].join("|").toLowerCase())
    .sort()
    .join("\n");
  return createHash("sha256").update(material).digest("hex").slice(0, 12);
}

/** "→ chose X" as the ADR title: the decision, never the topic. */
function titleFor(question, answers) {
  const picks = picksFor(question, answers);
  const chosen = picks.length ? picks.join(" + ") : "an unrecorded option";
  const topic = norm(question?.header);
  return topic ? `${topic}: use ${chosen}` : `Use ${chosen}`;
}

function decisionLines(question, answers) {
  const picks = new Set(picksFor(question, answers));
  const lines = [`**${norm(question.question) || norm(question.header)}** → chose **${[...picks].join(" + ") || "(no option)"}**.`];
  const rejected = (question.options || []).filter((o) => !picks.has(norm(o.label)));
  if (rejected.length) {
    lines.push("", "Rejected:", ...rejected.map((o) => `- **${norm(o.label)}** — ${norm(o.description) || "no rationale given"}`));
  }
  return lines;
}

export function renderDecision(hookInput) {
  const answers = answersOf(hookInput);
  const questions = questionsOf(hookInput);
  const lead = primary(hookInput);
  const body = [
    "## Context",
    "",
    `Captured from an AskUserQuestion during a Claude Code session on ${now().slice(0, 10)}.`,
    lead ? `The question asked was: ${norm(lead.question) || norm(lead.header)}` : "",
    "",
    "## Decision",
    "",
    ...questions.flatMap((q, i) => (i ? ["", ...decisionLines(q, answers)] : decisionLines(q, answers))),
    "",
    "## Consequences",
    "",
    "_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._",
  ]
    .filter((l, i, all) => !(l === "" && all[i - 1] === ""))
    .join("\n");

  return { title: titleFor(lead || {}, answers), body };
}

/** The new answer, appended to an existing ADR rather than written as a twin. */
function revision(hookInput) {
  const answers = answersOf(hookInput);
  return [
    "",
    `### Revision ${now()}`,
    "",
    ...questionsOf(hookInput).flatMap((q) => decisionLines(q, answers)),
  ].join("\n");
}

/**
 * Create the ADR, or revise the one that already answers this question set.
 * Returns {action: "created"|"updated"|"skipped", id, reason} — the reason is
 * the log line either way.
 */
export function upsertDecision(hookInput, { p = paths(), config = {}, epic = null } = {}) {
  const verdict = shouldCapture(hookInput, config);
  if (!verdict.capture) return { action: "skipped", reason: verdict.reason };

  const key = decisionKey(hookInput);
  const existing = list("adr", {}, p).find((a) => a.decisionKey === key);
  if (existing) {
    update(existing.id, { body: `${read(existing.id, p).body.trimEnd()}\n${revision(hookInput)}\n` }, p);
    return { action: "updated", id: existing.id, reason: `${verdict.reason} — revised ${existing.id}` };
  }

  const { title, body } = renderDecision(hookInput);
  const doc = create("adr", { title, status: "proposed", epic, decisionKey: key, date: now().slice(0, 10) }, body, p);
  return { action: "created", id: doc.id, reason: verdict.reason };
}
