/**
 * The Jira-shaped surface: assignee, labels, priority, estimate, comments,
 * backlog rank, subtasks and typed links.
 *
 * All of it lives in task frontmatter, which was already free-form — so this
 * extends the store rather than migrating it. A task with none of these fields
 * set behaves exactly as it did in v0.2, which the tests pin down.
 *
 * Every write goes through `update()` so the event log, the index and the gates
 * stay authoritative no matter whether the CLI, the dashboard or MCP called it.
 */
import { actor, actorLabel } from "./actor.mjs";
import { list, logEvent, now, read, update } from "./store.mjs";
import { paths } from "./paths.mjs";

/** Jira's ladder, lowercased. Anything else is a typo, not a new priority. */
export const PRIORITIES = ["highest", "high", "medium", "low", "lowest"];

/** Link types and their mirror, so both ends of a relationship stay in sync. */
export const LINK_TYPES = {
  "blocks": "blocked by",
  "blocked by": "blocks",
  "causes": "caused by",
  "caused by": "causes",
  "duplicates": "duplicated by",
  "duplicated by": "duplicates",
  "relates to": "relates to",
};

const RANK_STEP = 1000;

function must(id, p) {
  const doc = read(id, p);
  if (!doc) throw new Error(`not found: ${id}`);
  return doc;
}

export function assign(id, who, p = paths()) {
  must(id, p);
  const assignee = who && String(who).trim() ? String(who).trim() : undefined;
  update(id, { assignee }, p);
  logEvent("assign", { id, assignee: assignee ?? null }, p);
  return assignee ?? null;
}

export function labels(id, { add = [], remove = [] } = {}, p = paths()) {
  const t = must(id, p);
  const next = new Set(t.labels || []);
  for (const l of add) if (String(l).trim()) next.add(String(l).trim());
  for (const l of remove) next.delete(String(l).trim());
  const labelList = [...next];
  update(id, { labels: labelList.length ? labelList : undefined }, p);
  logEvent("labels", { id, labels: labelList }, p);
  return labelList;
}

export function prioritise(id, priority, p = paths()) {
  must(id, p);
  const value = String(priority || "").toLowerCase();
  if (!PRIORITIES.includes(value)) {
    throw new Error(`unknown priority "${priority}" — use one of: ${PRIORITIES.join(", ")}`);
  }
  update(id, { priority: value }, p);
  logEvent("prioritise", { id, priority: value }, p);
  return value;
}

export function estimate(id, points, p = paths()) {
  must(id, p);
  const value = Number(points);
  if (!Number.isFinite(value) || value < 0) throw new Error(`estimate must be a non-negative number, got "${points}"`);
  update(id, { estimate: value }, p);
  logEvent("estimate", { id, estimate: value }, p);
  return value;
}

export function addComment(id, text, { author, p = paths() } = {}) {
  const t = must(id, p);
  const body = String(text || "").trim();
  if (!body) throw new Error("refusing to store an empty comment");
  const comments = [...(t.comments || []), { author: author || actorLabel(actor()), ts: now(), text: body }];
  update(id, { comments }, p);
  logEvent("comment", { id, author: comments.at(-1).author }, p);
  return comments;
}

/** Typed link, written to both ends so it is visible from either task. */
export function addLink(fromId, type, toId, p = paths()) {
  if (fromId === toId) throw new Error("a task cannot link to itself");
  const from = must(fromId, p);
  const to = must(toId, p);
  const mirror = LINK_TYPES[type];
  if (!mirror) throw new Error(`unknown link type "${type}" — use one of: ${Object.keys(LINK_TYPES).join(", ")}`);

  const push = (doc, linkType, otherId) => {
    const links = [...(doc.links || [])];
    if (!links.some((l) => l.type === linkType && l.id === otherId)) links.push({ type: linkType, id: otherId });
    update(doc.id, { links }, p);
  };
  push(from, type, toId);
  push(to, mirror, fromId);
  logEvent("link", { id: fromId, type, to: toId }, p);
  return read(fromId, p).links;
}

/**
 * Read children with `subtasks(parentId, {})`, or nest with `{ parent }`.
 * Refuses a cycle — a parent chain that loops makes every tree render hang.
 */
export function subtasks(id, { parent } = {}, p = paths()) {
  const t = must(id, p);
  if (parent === undefined) return list("task", { parent: id }, p);

  if (parent) {
    must(parent, p);
    if (parent === id) throw new Error("a task cannot be its own parent — that is a cycle");
    let cursor = read(parent, p);
    const seen = new Set([id]);
    while (cursor?.parent) {
      // Cycle check first: `seen` is seeded with `id`, so testing membership
      // before this would break out of the loop instead of reporting the cycle.
      if (cursor.parent === id) throw new Error(`nesting ${id} under ${parent} would create a cycle`);
      if (seen.has(cursor.parent)) break; // pre-existing loop elsewhere; not ours to fix here
      seen.add(cursor.parent);
      cursor = read(cursor.parent, p);
    }
  }
  update(id, { parent: parent || undefined }, p);
  logEvent("subtask", { id, parent: parent || null }, p);
  return list("task", { parent: t.parent }, p);
}

/**
 * Backlog order. Ranks are sparse integers so a drag only rewrites the card that
 * moved; unranked tasks fall back to id order, which is creation order.
 */
export function backlog(p = paths()) {
  return list("task", {}, p)
    .filter((t) => t.status !== "done")
    .map((t, i) => ({ ...t, _fallback: (i + 1) * RANK_STEP }))
    .sort((a, b) => (a.rank ?? a._fallback) - (b.rank ?? b._fallback) || String(a.id).localeCompare(String(b.id)))
    .map(({ _fallback, ...t }) => t);
}

/** Move a task above `before`, below `after`, or to an explicit rank. */
export function rank(id, { before, after, to } = {}, p = paths()) {
  must(id, p);
  const order = backlog(p);
  const rankOf = (task, i) => task.rank ?? (i + 1) * RANK_STEP;

  let value = to;
  if (value === undefined && before) {
    const i = order.findIndex((t) => t.id === before);
    if (i === -1) throw new Error(`not found: ${before}`);
    const target = rankOf(order[i], i);
    const above = i > 0 ? rankOf(order[i - 1], i - 1) : target - RANK_STEP * 2;
    value = (above + target) / 2;
  }
  if (value === undefined && after) {
    const i = order.findIndex((t) => t.id === after);
    if (i === -1) throw new Error(`not found: ${after}`);
    const target = rankOf(order[i], i);
    const below = i < order.length - 1 ? rankOf(order[i + 1], i + 1) : target + RANK_STEP * 2;
    value = (target + below) / 2;
  }
  if (value === undefined) throw new Error("rank needs one of --before, --after or --to");

  update(id, { rank: value }, p);
  logEvent("rank", { id, rank: value }, p);
  return value;
}
