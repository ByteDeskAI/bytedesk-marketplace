/**
 * Capabilities — the discovery layer above tasks.
 *
 * A capability is a *proposed* product enhancement: a problem worth solving, sized and
 * ranked, with acceptance criteria, before anyone commits to building it. Tasks are the
 * execution layer; a capability becomes work by being accepted, which mints a task.
 *
 * This used to be a parallel store — docs/capabilities/ with its own INDEX.yaml, its own
 * id allocator and a python script to check the two agreed. All of that is what store.mjs
 * already does for epics, tasks and ADRs, so a capability is just a fourth kind: ids,
 * status, evidence, search, events, dashboard and MCP come for free.
 *
 * ponytail: status stays the store's vocabulary (open/in_progress/done/deleted) rather
 * than a private proposed/accepted/shipped one — `tm board`, `tm find`, `tm doctor` and
 * the dashboard all read status, and a fourth vocabulary would have meant teaching each
 * of them a translation. "Proposed" is `open`, "shipped" is `done`.
 */
import { KINDS } from "./paths.mjs";
import { create, list, logEvent, now, read, update } from "./store.mjs";
import { gateTaskCreate } from "./enforce.mjs";

/**
 * Two vocabularies, deliberately: impact and confidence are High/Medium/Low, effort is
 * Small/Medium/Large. That is how people already write these on a card, and inventing one
 * uniform scale would have meant rewriting the meaning of every card ever imported —
 * `impact: L` means *low* in the world this came from, not *large*.
 */
export const LEVELS = ["H", "M", "L"];
export const EFFORTS = ["S", "M", "L"];
const IMPACT = { L: 1, M: 2, H: 3 };
const EFFORT = { S: 3, M: 2, L: 1 };
const CONFIDENCE = { L: 1, M: 2, H: 3 };

export function assertLevel(field, value, allowed = LEVELS) {
  if (value && !allowed.includes(value)) throw new Error(`${field} must be one of ${allowed.join("/")} (got ${value})`);
  return value;
}

/**
 * Do-this-first score: impact × ease × confidence, so a large win that is cheap and
 * well understood outranks a large win that is speculative and expensive. Deliberately
 * a product of three small integers (1–27) — a number a person can sanity-check, not a
 * weighting model nobody can argue with.
 */
export function score(cap) {
  return (IMPACT[cap.impact] || 2) * (EFFORT[cap.effort] || 2) * (CONFIDENCE[cap.confidence] || 2);
}

const CARD = ({ problem = "", current = "", proposal = "", criteria = [], nonGoals = [] }) =>
  [
    "## Problem / job-to-be-done",
    "",
    problem,
    "",
    "## Current state",
    "",
    current,
    "",
    "## Proposed enhancement",
    "",
    proposal,
    "",
    "## Acceptance criteria",
    "",
    ...(criteria.length ? criteria.map((c) => `- [ ] ${c}`) : ["- [ ] "]),
    "",
    "## Non-goals",
    "",
    ...(nonGoals.length ? nonGoals.map((n) => `- ${n}`) : ["- "]),
    "",
  ].join("\n");

/** A new capability card. `open` means proposed — nobody has agreed to build it yet. */
export function propose(fields, p) {
  const { title, area = "product", impact = "M", effort = "M", confidence = "M", source = "research", ...card } = fields;
  if (!title) throw new Error("a capability needs a title");
  assertLevel("impact", impact);
  assertLevel("effort", effort, EFFORTS);
  assertLevel("confidence", confidence);
  return create(
    "capability",
    { title, status: "open", area, impact, effort, confidence, source, evidence: [], related: [] },
    card.body || CARD(card),
    p,
  );
}

/**
 * Accept a capability: mint the task that will build it, and point each at the other.
 *
 * The link is what keeps the two layers honest — `tm cap list` can say which proposals
 * are actually being worked, and the task carries the card that justifies it, so the
 * reason for the work survives past the session that proposed it.
 *
 * Minting is an explicit create, so it answers gateTaskCreate like `tm task new` does:
 * an active epic, the WIP limit, and the completeness draft. Until recently accept
 * skipped the gate entirely — the one creator that could mint work with no epic and
 * no criteria. The draft's criteria are the card's own `- [ ]` lines, so a card that
 * has none cannot become work; the refusal says where to write them.
 */
export function accept(id, p, { create: createTask } = {}) {
  const cap = read(id, p);
  if (!cap) throw new Error(`not found: ${id}`);
  if (cap.task) return { cap, task: read(cap.task, p), existing: true };
  const body = `Implements [[${cap.id}]].\n\n${cap.body || ""}`;
  const acceptance = acceptanceOf(cap);
  const gate = gateTaskCreate(p, { body, acceptance });
  if (!gate.allow) {
    const err = new Error(
      acceptance.length
        ? gate.reason
        : `${gate.reason}\nThe minted task's criteria come from the card — add \`- [ ] <criterion>\` lines under ## Acceptance criteria in ${id} (\`.bytedesk/task-management/bin/tm edit ${id} --body -\`), then re-run \`tm cap accept ${id}\`.`,
    );
    err.status = 2;
    throw err;
  }
  const mint = createTask || create;
  const task = mint(
    "task",
    {
      title: cap.title,
      status: "open",
      capability: cap.id,
      acceptance,
      evidence: [],
      commits: [],
      blockedBy: [],
      blocks: [],
    },
    body,
    p,
  );
  const updated = update(cap.id, { status: "in_progress", task: task.id }, p);
  logEvent("cap-accept", { id: cap.id, task: task.id }, p);
  return { cap: updated, task };
}

/** `- [ ] criterion` lines from the card become the task's gate. */
export function acceptanceOf(cap) {
  return [...(cap.body || "").matchAll(/^- \[[ x]\] +(.+)$/gm)]
    .map((m) => ({ text: m[1].trim(), done: false }))
    .filter((c) => c.text);
}

/** Shipped, with something to show for it. */
export function ship(id, { evidence, task } = {}, p) {
  const cap = read(id, p);
  if (!cap) throw new Error(`not found: ${id}`);
  const refs = [...(cap.evidence || []), ...(evidence ? [evidence] : [])];
  if (!refs.length) throw new Error(`${id} has no evidence — a capability is not shipped on assertion (\`.bytedesk/task-management/bin/tm evidence ${id} <path>\`)`);
  const doc = update(id, { status: "done", shipped: now().slice(0, 10), ...(task ? { task } : {}) }, p);
  logEvent("cap-ship", { id, evidence: refs.length }, p);
  return doc;
}

export function drop(id, why, p) {
  const doc = update(id, { status: "deleted", droppedReason: why || "" }, p);
  logEvent("cap-drop", { id, why: why || "" }, p);
  return doc;
}

/** Open proposals, best bet first. Ties break on id so the order is stable between runs. */
export function ranked(p, { status } = {}) {
  return list("capability", status ? { status } : {}, p)
    .filter((c) => (status ? true : c.status !== "done"))
    .sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
}

export function capLine(cap) {
  const bits = [
    cap.id,
    `[${cap.status}]`,
    cap.title,
    `(${cap.area} · I${cap.impact}/E${cap.effort}/C${cap.confidence} · score ${score(cap)})`,
  ];
  if (cap.task) bits.push(`→ ${cap.task}`);
  return bits.join(" ");
}

export const PREFIX = KINDS.capability.prefix;
