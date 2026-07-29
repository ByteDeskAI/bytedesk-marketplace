/**
 * The dependency graph as an answer, not a field.
 *
 * `blockedBy` stores DIRECT blockers, and nothing reads it transitively. So the
 * question people actually ask — "why can't I start this?" — gets answered by
 * hand-walking the chain, and the root cause hides two hops away: a card shows
 * `⊘ TM-005` while the thing genuinely stuck is TM-003, parked a week ago with a
 * reason nobody has re-read.
 *
 * `why` walks to the roots and reports the reason at each hop. `mermaid` draws the
 * same graph, because the store's whole thesis is "readable in a PR diff" and
 * GitHub renders Mermaid there.
 */
import { RESOLVED, config, list, state } from "./store.mjs";
import { claimant } from "./claims.mjs";
import { paths } from "./paths.mjs";

/** A `blocked` status carrying a written reason is a human decision, not a dependency. */
const declared = (t) => t.status === "blocked" && t.blockedReason;

const pending = (t) => t && !RESOLVED.has(t.status);

function index(p) {
  return new Map(list("task", { includeDeleted: true }, p).map((t) => [t.id, t]));
}

/**
 * Every unresolved blocker reachable from `origin`, depth-first, each with its hop
 * count and the path that reached it. Done and deleted blockers are dropped — they
 * are the answer to "is this still blocking", and the answer is no.
 *
 * A blocker reachable by two paths is reported once, at the depth DFS found first.
 * Cycles are collected rather than followed, so a self-referential graph terminates.
 */
function walk(origin, byId) {
  const seen = new Set();
  const cycles = [];
  const chain = [];

  const visit = (id, path) => {
    const task = byId.get(id);
    if (!task) return;
    for (const dep of task.blockedBy || []) {
      if (path.includes(dep)) {
        cycles.push([...path.slice(path.indexOf(dep)), dep]);
        continue;
      }
      const depth = path.length - 1;
      const blocker = byId.get(dep);
      // A dep with no file is a dangling reference, not a resolved one. Reporting it
      // as resolved would call the task startable and hand you a broken graph;
      // `tm doctor` is what removes these.
      if (!blocker) {
        if (!seen.has(dep)) {
          seen.add(dep);
          chain.push({ id: dep, title: "(no such task)", status: "missing", depth, via: [...path] });
        }
        continue;
      }
      if (!pending(blocker) || seen.has(dep)) continue;
      seen.add(dep);
      chain.push({
        id: dep,
        title: blocker.title,
        status: blocker.status,
        reason: blocker.blockedReason || blocker.parkedReason || undefined,
        depth,
        via: [...path],
      });
      visit(dep, [...path, dep]);
    }
  };

  visit(origin, [origin]);
  return { chain, cycles };
}

/**
 * Why this task is not startable — or the confirmation that it is.
 *
 * Reasons are separated into blocking and informational: a parked blocker stops you,
 * a parked *task* does not (`tm start` resumes it), and conflating the two is how a
 * "why" command starts lying.
 */
export function why(id, p = paths()) {
  const byId = index(p);
  const task = byId.get(id);
  if (!task) return null;

  const { chain, cycles } = walk(id, byId);
  const reasons = [];

  if (RESOLVED.has(task.status)) {
    reasons.push({ kind: "resolved", blocking: false, text: `${id} is already ${task.status} — nothing to start.` });
  }
  if (chain.length) {
    const direct = chain.filter((c) => c.depth === 0).map((c) => c.id);
    reasons.push({
      kind: "dependency",
      blocking: true,
      text: `waiting on ${chain.length} unresolved blocker${chain.length === 1 ? "" : "s"} (direct: ${direct.join(", ")})`,
    });
  }
  if (declared(task)) {
    reasons.push({ kind: "declared", blocking: true, text: `blocked by hand: ${task.blockedReason}` });
  }
  const held = claimant(id, p);
  if (held && held.session && held.session !== (process.env.CLAUDE_SESSION_ID || null)) {
    reasons.push({
      kind: "claimed",
      blocking: true,
      text:
        `claimed by ${held.actor || `session ${held.session}`}` +
        (held.worktree ? ` in ${held.worktree}` : "") +
        (held.branch ? ` on ${held.branch}` : "") +
        " — `tm start --steal` takes it",
    });
  }
  const cfg = config(p);
  const wip = [...byId.values()].filter((t) => t.status === "in_progress");
  if (cfg.enforce !== false && cfg.wipLimit && wip.length >= cfg.wipLimit && !wip.some((w) => w.id === id)) {
    reasons.push({
      kind: "wip",
      blocking: true,
      text: `WIP limit ${cfg.wipLimit} reached: ${wip.map((w) => w.id).join(", ")}`,
    });
  }
  if (task.status === "parked") {
    reasons.push({
      kind: "parked",
      blocking: false,
      text: `parked${task.parkedReason ? `: ${task.parkedReason}` : ""} — \`tm start ${id}\` resumes it`,
    });
  }
  if (cycles.length) {
    reasons.push({ kind: "cycle", blocking: true, text: `dependency cycle: ${cycles[0].join(" → ")}` });
  }
  const dangling = chain.filter((c) => c.status === "missing").map((c) => c.id);
  if (dangling.length) {
    reasons.push({
      kind: "dangling",
      blocking: true,
      text: `blocked by ${dangling.join(", ")}, which does not exist — \`tm doctor\` clears these`,
    });
  }
  if (task.epic) {
    const epic = list("epic", {}, p).find((e) => e.id === task.epic);
    if (!epic) reasons.push({ kind: "orphan", blocking: false, text: `epic ${task.epic} does not exist` });
  }

  // The roots are what you can actually pick up: unresolved blockers that are not
  // themselves waiting on anything unresolved. A missing blocker is excluded — it is
  // a broken reference, and offering "start here: TM-777" sends you after a ghost.
  const inChain = new Set(chain.map((c) => c.id));
  const roots = chain.filter(
    (c) =>
      c.status !== "missing" &&
      !(byId.get(c.id)?.blockedBy || []).some((d) => inChain.has(d) || pending(byId.get(d))),
  );

  return {
    id,
    title: task.title,
    status: task.status,
    startable: !reasons.some((r) => r.blocking),
    reasons,
    chain,
    roots,
    cycles,
  };
}

const MARK = { open: "○", in_progress: "◐", blocked: "⊘", parked: "⏸", done: "●", missing: "✕" };

export function renderWhy(w) {
  const out = [`${w.id}  ${w.title}`, `status: ${w.status}   startable: ${w.startable ? "yes" : "no"}`, ""];
  if (!w.reasons.length) return [...out, "nothing is holding this up — `tm start " + w.id + "`"].join("\n");

  for (const r of w.reasons) out.push(`${r.blocking ? "✗" : "·"} ${r.text}`);

  if (w.chain.length) {
    out.push("", "chain:");
    for (const c of w.chain) {
      out.push(
        `${"  ".repeat(c.depth + 1)}${MARK[c.status] || "?"} ${c.id} ${c.title}` +
          `  ${c.status}${c.reason ? ` — "${c.reason}"` : ""}`,
      );
    }
  }
  if (w.roots.length) {
    out.push("", `start here: ${w.roots.map((r) => r.id).join(", ")}`);
  }
  return out.join("\n");
}

// ── the whole graph ──────────────────────────────────────────────────────────

/** Mermaid ids cannot carry the hyphen our ids are built from. */
const node = (id) => String(id).replace(/-/g, "_");
/** Mermaid has no escape for `"` inside a label; the HTML entity is the documented way. */
const label = (s) => String(s).replace(/"/g, "&quot;").replace(/[[\]{}()]/g, " ").slice(0, 60).trim();

const CLASS = {
  done: "fill:#dcfff1,stroke:#1f845a,color:#164b35",
  in_progress: "fill:#e9f2ff,stroke:#0c66e4,color:#09326c",
  blocked: "fill:#ffecec,stroke:#c9372c,color:#5d1f1a",
  parked: "fill:#f1f2f4,stroke:#8590a2,color:#44546f",
  open: "fill:#ffffff,stroke:#8590a2,color:#172b4d",
  missing: "fill:#fff7d6,stroke:#946f00,color:#533f04",
};

/**
 * The dependency graph as Mermaid. Edges point blocker → blocked, so the arrows
 * run in the direction work actually flows.
 *
 * ponytail: whole-graph render with an --epic filter. If a store ever gets big
 * enough that this is unreadable, add `--from <id>` to draw one subtree.
 */
export function mermaid({ epic = null, includeDone = false, subtasks = true } = {}, p = paths()) {
  const tasks = list("task", {}, p)
    .filter((t) => !epic || t.epic === epic)
    .filter((t) => includeDone || t.status !== "done");
  const ids = new Set(tasks.map((t) => t.id));
  const byId = new Map(list("task", { includeDeleted: true }, p).map((t) => [t.id, t]));

  const lines = ["flowchart TD"];
  for (const t of tasks) {
    lines.push(`  ${node(t.id)}["${label(`${t.id} ${t.title}`)}"]:::${t.status}`);
  }
  const edges = [];
  for (const t of tasks) {
    for (const dep of t.blockedBy || []) {
      // A blocker outside the filter still explains the block — draw it, marked.
      if (!ids.has(dep)) {
        const outside = byId.get(dep);
        lines.push(`  ${node(dep)}["${label(`${dep} ${outside?.title || "(no such task)"}`)}"]:::${outside?.status || "missing"}`);
        ids.add(dep);
      }
      edges.push(`  ${node(dep)} --> ${node(t.id)}`);
    }
    if (subtasks && t.parent && ids.has(t.parent)) edges.push(`  ${node(t.parent)} -.-> ${node(t.id)}`);
  }
  lines.push(...edges);
  for (const [status, style] of Object.entries(CLASS)) lines.push(`  classDef ${status} ${style}`);
  return { mermaid: lines.join("\n"), tasks: tasks.length, edges: edges.length };
}

/** Nodes and edges as data, for `--json` and anything that wants to draw its own. */
export function graphData({ epic = null, includeDone = false } = {}, p = paths()) {
  const tasks = list("task", {}, p)
    .filter((t) => !epic || t.epic === epic)
    .filter((t) => includeDone || t.status !== "done");
  return {
    nodes: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, epic: t.epic ?? null, parent: t.parent ?? null })),
    edges: tasks.flatMap((t) => (t.blockedBy || []).map((from) => ({ from, to: t.id, type: "blocks" }))),
    activeEpic: state(p).activeEpic ?? null,
  };
}
