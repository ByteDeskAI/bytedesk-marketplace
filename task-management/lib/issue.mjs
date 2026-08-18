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
import { PRIORITIES, RANK_STEP, list, logEvent, mutate, now, read, update } from "./store.mjs";
import { paths } from "./paths.mjs";

/**
 * Jira's ladder, lowercased. Anything else is a typo, not a new priority. Defined in
 * store.mjs, because that is where the queue order reads it; re-exported here because this
 * module owns the field — validation, the event, the verb.
 */
export { PRIORITIES };

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

/**
 * Issue type, the last Jira system field this store treated as free text.
 *
 * `subtask` is deliberately absent: being a subtask is expressed by `parent`, and conflating the
 * two is the bug this fixes. `toCsv` wrote `t.parent ? "Sub-task" : "Task"` — parentage, not type —
 * so a BUG that happened to be a subtask exported as `Sub-task` and its bug-ness was lost.
 */
export const TYPES = ["task", "bug", "story", "spike", "chore"];


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
  must(id, p);
  // Read-append-write, so it goes through mutate: two concurrent label adds that each
  // read the same list would otherwise keep only the second one's label.
  let labelList = [];
  mutate(
    id,
    (t) => {
      const next = new Set(t.labels || []);
      for (const l of add) if (String(l).trim()) next.add(String(l).trim());
      for (const l of remove) next.delete(String(l).trim());
      labelList = [...next];
      return { labels: labelList.length ? labelList : undefined };
    },
    p,
  );
  logEvent("labels", { id, labels: labelList }, p);
  return labelList;
}

export function prioritise(id, priority, p = paths()) {
  must(id, p);
  // Omit / undefined / empty clears. `null` is not a ladder value — the drawer used to send it
  // and got a 400 — so treat it as a clear rather than as the string "null".
  if (priority === undefined || priority === null || String(priority).trim() === "") {
    update(id, { priority: undefined }, p);
    logEvent("prioritise", { id, priority: null }, p);
    return null;
  }
  const value = String(priority).toLowerCase();
  if (!PRIORITIES.includes(value)) {
    throw new Error(`unknown priority "${priority}" — use one of: ${PRIORITIES.join(", ")}`);
  }
  update(id, { priority: value }, p);
  logEvent("prioritise", { id, priority: value }, p);
  return value;
}

export function estimate(id, points, p = paths()) {
  must(id, p);
  // Clearing must drop the field. Number("") is 0, which is a real estimate, not an empty one.
  if (points === undefined || points === null || points === "") {
    update(id, { estimate: undefined }, p);
    logEvent("estimate", { id, estimate: null }, p);
    return null;
  }
  const value = Number(points);
  if (!Number.isFinite(value) || value < 0) throw new Error(`estimate must be a non-negative number, got "${points}"`);
  update(id, { estimate: value }, p);
  logEvent("estimate", { id, estimate: value }, p);
  return value;
}

export function addComment(id, text, { author, p = paths() } = {}) {
  must(id, p);
  const body = String(text || "").trim();
  if (!body) throw new Error("refusing to store an empty comment");
  // The canonical lost-write shape, and the one measured: 8 concurrent comments on one
  // task stored 5, because each read the same array and appended one item to it.
  let comments = [];
  mutate(
    id,
    (t) => {
      comments = [...(t.comments || []), { author: author || actorLabel(actor()), ts: now(), text: body }];
      return { comments };
    },
    p,
  );
  logEvent("comment", { id, author: comments.at(-1).author }, p);
  return comments;
}

/** Typed link, written to both ends so it is visible from either task. */
/**
 * `owner/repo#TM-007` — a task on another board.
 *
 * Cross-repo work is real: a persona ticket genuinely does relate to a marketplace pull request.
 * What it must not be is a bare id, because a bare id resolves against whichever store the cwd
 * happened to pick, which is how one repo's PRs ended up stapled to another repo's task. Naming
 * the board makes the reference honest and un-resolvable by accident.
 */
const FOREIGN = /^([\w.-]+\/[\w.-]+)#([A-Z]+-\d+)$/;
export const foreignRef = (ref) => {
  const m = FOREIGN.exec(String(ref || ""));
  return m ? { board: m[1].toLowerCase(), id: m[2] } : null;
};

export function addLink(fromId, type, toId, p = paths()) {
  if (fromId === toId) throw new Error("a task cannot link to itself");
  const mirror = LINK_TYPES[type];
  if (!mirror) throw new Error(`unknown link type "${type}" — use one of: ${Object.keys(LINK_TYPES).join(", ")}`);

  // A link to another board is one-sided by nature: the other store is not ours to write, and may
  // not even be on this machine. Recorded here, named, and left at that.
  const foreign = foreignRef(toId);
  if (foreign) {
    const from = must(fromId, p);
    mutate(
      from.id,
      (doc) => {
        const links = [...(doc.links || [])];
        if (!links.some((l) => l.type === type && l.id === toId)) links.push({ type, id: toId, board: foreign.board });
        return { links };
      },
      p,
    );
    return;
  }

  const from = must(fromId, p);
  const to = must(toId, p);

  // Each end is a read-append-write; both go through mutate so two links added at once
  // do not overwrite one another. `from`/`to` above are only existence checks.
  const push = (docId, linkType, otherId) =>
    mutate(
      docId,
      (doc) => {
        const links = [...(doc.links || [])];
        if (!links.some((l) => l.type === linkType && l.id === otherId)) links.push({ type: linkType, id: otherId });
        return { links };
      },
      p,
    );
  push(from.id, type, toId);
  push(to.id, mirror, fromId);
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

/**
 * Dependencies — the one relationship in this file's remit that never had a function here.
 *
 * `issue.mjs` owns assignee, labels, priority, estimate, comments, typed links, subtasks and rank.
 * Dependencies were two inline `mutate()` calls in `bin/tm`, which had three consequences: the
 * dashboard could render `⊘ TM-002` on a card and had no route to change it, nothing logged an
 * event so a dependency appearing or vanishing was invisible in `tm log <id>`, and there was no
 * way to REMOVE one at all — `doctor` could drop a dangling reference, but a valid dependency
 * added by mistake was permanent.
 *
 * Both ends are written, as `addLink` does: `A blockedBy B` gives `B blocks A`, because a one-sided
 * edge is invisible from the end you are usually looking at and `doctor` reports it as a fault.
 *
 * A cycle is REFUSED here rather than reported later. `doctor` finds dep-cycles and deliberately
 * will not repair them — which edge to cut is a judgement — so the cheap moment to say no is
 * before one exists, exactly as `subtasks` refuses a parent loop.
 */
export function dependencies(id, { add = [], remove = [] } = {}, p = paths()) {
  const t = must(id, p);

  for (const dep of add) {
    if (dep === id) throw new Error(`${id} cannot depend on itself`);
    must(dep, p);
    // Walk what `dep` already waits on. If this task is anywhere in there, the edge closes a loop.
    const seen = new Set();
    const stack = [dep];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === id) throw new Error(`${id} depending on ${dep} would create a cycle`);
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(read(cur, p)?.blockedBy || []));
    }
  }

  let blockedBy = [];
  mutate(
    id,
    (doc) => {
      const next = new Set(doc.blockedBy || []);
      for (const d of add) next.add(d);
      for (const d of remove) next.delete(d);
      blockedBy = [...next];
      return {
        blockedBy,
        // Adding the first blocker to open work blocks it; removing the last one does NOT reopen
        // it, because `unblockDependents` owns that transition and it checks whether every blocker
        // is resolved. Two functions deciding one status is how they disagree.
        status: blockedBy.length && doc.status === "open" ? "blocked" : doc.status,
      };
    },
    p,
  );

  // The other end of each edge.
  for (const d of add) {
    if (!read(d, p)) continue;
    mutate(d, (other) => ({ blocks: [...new Set([...(other.blocks || []), id])] }), p);
  }
  for (const d of remove) {
    if (!read(d, p)) continue;
    mutate(d, (other) => ({ blocks: (other.blocks || []).filter((x) => x !== id) }), p);
  }

  if (add.length) logEvent("dep", { id, on: add }, p);
  if (remove.length) logEvent("undep", { id, off: remove }, p);
  void t;
  return blockedBy;
}

/**
 * Set the type. Mirrors `prioritise` exactly, including refusing a value outside the vocabulary —
 * a free-text type is the thing that made the exporters invent one.
 */
export function setType(id, value, p = paths()) {
  must(id, p);
  const v = String(value || "").toLowerCase();
  if (v && !TYPES.includes(v)) throw new Error(`unknown type "${value}" — use one of: ${TYPES.join(", ")}`);
  update(id, { type: v || undefined }, p);
  logEvent("type", { id, type: v || null }, p);
  return v || null;
}

/**
 * The type to report for a task, in order of how much it was actually meant.
 *
 * 1. the stored field, when someone said so;
 * 2. a recognised type worn as a LABEL, because that is how templates encoded it before this field
 *    existed (`labels: ["bug"]`) — so every task already in a store keeps its meaning without a
 *    migration;
 * 3. `task`, the neutral default.
 *
 * Parentage is NOT consulted. `parent` says where a task sits, not what it is, and an exporter
 * that needs the Jira "Sub-task" distinction can read `parent` itself — which is what it means.
 */
export function typeOf(task) {
  if (task?.type && TYPES.includes(task.type)) return task.type;
  const worn = (task?.labels || []).map((l) => String(l).toLowerCase()).find((l) => TYPES.includes(l) && l !== "task");
  return worn || "task";
}
