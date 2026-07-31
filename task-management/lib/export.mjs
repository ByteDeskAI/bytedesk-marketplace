/**
 * Getting the board out.
 *
 * The README has promised `tm export` since v0.2 ("`tm export` (v1.1) will feed it").
 * Four shapes, because "export" means four different jobs:
 *
 *   md    a report to paste into a PR, a standup or a status doc
 *   csv   a spreadsheet, or a Jira CSV import
 *   json  the whole store as one document, for anything that wants to read it
 *
 * All read-only. Nothing here writes to the store.
 */
import { list, read, readEvents, state } from "./store.mjs";
import { typeOf } from "./issue.mjs";
import { summary as timeSummary, human as humanMs } from "./time.mjs";
import { paths } from "./paths.mjs";

export const FORMATS = ["md", "csv", "json"];

/** Jira's own vocabulary, so a CSV import needs no column remapping for status. */
const JIRA_STATUS = {
  open: "To Do",
  in_progress: "In Progress",
  blocked: "Blocked",
  parked: "To Do",
  done: "Done",
};

function select({ epic = null, status = null, includeDone = true } = {}, p) {
  return list("task", {}, p)
    .filter((t) => !epic || t.epic === epic)
    .filter((t) => !status || t.status === status)
    .filter((t) => includeDone || t.status !== "done")
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.id.localeCompare(b.id));
}

// ── csv ──────────────────────────────────────────────────────────────────────

/**
 * RFC 4180. A field is quoted if it contains a comma, a quote, or a newline, and an
 * embedded quote is doubled.
 *
 * This is the whole correctness surface of a CSV export: a task titled
 * `fix the "done" gate, properly` silently shifts every later column of that row
 * if you get it wrong, and the file still opens.
 */
export function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvRow = (cells) => cells.map(csvField).join(",");

const CSV_COLUMNS = [
  "Issue ID",
  "Summary",
  "Description",
  "Issue Type",
  "Status",
  "Priority",
  "Assignee",
  "Labels",
  "Story Points",
  "Epic Link",
  "Parent",
  "Blocks",
  "Blocked By",
  "Acceptance Criteria",
  "Created",
  "Updated",
  "Resolved",
  "Commits",
];

export function toCsv(opts = {}, p = paths()) {
  const rows = [csvRow(CSV_COLUMNS)];
  for (const t of select(opts, p)) {
    rows.push(
      csvRow([
        t.id,
        t.title,
        // Newlines are legal inside a quoted CSV field, and Jira imports them as-is.
        t.body?.trim() || "",
        // Jira's own vocabulary: capitalise the type, and let `parent` speak for structure —
        // it is a Sub-task only when it actually has a parent, whatever its type is.
        t.parent ? "Sub-task" : typeOf(t).replace(/^./, (c) => c.toUpperCase()),
        JIRA_STATUS[t.status] || t.status,
        t.priority || "",
        t.assignee || "",
        (t.labels || []).join(" "),
        t.estimate ?? "",
        t.epic || "",
        t.parent || "",
        (t.blocks || []).join(" "),
        (t.blockedBy || []).join(" "),
        (t.acceptance || []).map((a) => `[${a.done ? "x" : " "}] ${a.text}`).join("\n"),
        t.created || "",
        t.updated || "",
        t.closed || "",
        (t.commits || []).join(" "),
      ]),
    );
  }
  return `${rows.join("\n")}\n`;
}

// ── markdown ─────────────────────────────────────────────────────────────────

const MARK = { open: "○", in_progress: "◐", blocked: "⊘", parked: "⏸", done: "●" };

export function toMarkdown(opts = {}, p = paths()) {
  const tasks = select(opts, p);
  const epics = list("epic", {}, p).filter((e) => !opts.epic || e.id === opts.epic);
  const adrs = list("adr", {}, p);
  const s = timeSummary(p);
  const out = [`# ${opts.title || "Board"} — ${p.root.split("/").at(-1)}`, "", `Exported ${new Date().toISOString()}`, ""];

  const counts = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] || 0) + 1;
  out.push(
    `**${tasks.length} task${tasks.length === 1 ? "" : "s"}** — ` +
      Object.entries(counts)
        .map(([k, n]) => `${n} ${k.replace("_", " ")}`)
        .join(", "),
    "",
    `Median cycle time ${s.median ?? "—"}, mean ${s.mean ?? "—"}, ${s.completed ?? 0} closed.`,
    "",
  );

  const filed = new Set();
  for (const e of epics) {
    const kids = tasks.filter((t) => t.epic === e.id);
    if (!kids.length && opts.epic !== e.id) continue;
    const done = kids.filter((t) => t.status === "done").length;
    out.push(`## ${e.id} ${e.title} — ${done}/${kids.length} done${e.status === "done" ? " (closed)" : ""}`, "");
    if (e.body?.trim()) out.push(e.body.trim(), "");
    for (const t of kids) {
      filed.add(t.id);
      out.push(...taskBlock(t));
    }
  }
  const loose = tasks.filter((t) => !filed.has(t.id));
  if (loose.length) {
    out.push("## No epic", "");
    for (const t of loose) out.push(...taskBlock(t));
  }

  if (adrs.length) {
    out.push("## Decisions", "");
    for (const a of adrs) out.push(`- **${a.id}** ${a.title} — ${a.status}${a.date ? ` (${a.date})` : ""}`);
    out.push("");
  }
  return out.join("\n");
}

function taskBlock(t) {
  const ac = t.acceptance || [];
  const met = ac.filter((a) => a.done).length;
  const facts = [
    t.assignee ? `@${t.assignee}` : "",
    t.priority || "",
    t.estimate !== undefined ? `${t.estimate} pts` : "",
    ac.length ? `${met}/${ac.length} AC` : "",
    (t.labels || []).join(", "),
    (t.blockedBy || []).length ? `blocked by ${t.blockedBy.join(", ")}` : "",
    t.parkedReason ? `parked: ${t.parkedReason}` : "",
    t.blockedReason ? `blocked: ${t.blockedReason}` : "",
  ].filter(Boolean);
  const rows = [`### ${MARK[t.status] || "?"} ${t.id} ${t.title}`, ""];
  if (facts.length) rows.push(facts.join(" · "), "");
  if (t.body?.trim()) rows.push(t.body.trim(), "");
  if (ac.length) rows.push(...ac.map((a) => `- [${a.done ? "x" : " "}] ${a.text}`), "");
  if ((t.commits || []).length) rows.push(`Commits: ${t.commits.join(", ")}`, "");
  if ((t.evidence || []).length) rows.push(`Evidence: ${t.evidence.join(", ")}`, "");
  return rows;
}

// ── json ─────────────────────────────────────────────────────────────────────

export function toJson(opts = {}, p = paths()) {
  const strip = ({ file, ...rest }) => rest;
  return {
    exported: new Date().toISOString(),
    root: p.root,
    activeEpic: state(p).activeEpic ?? null,
    metrics: timeSummary(p),
    epics: list("epic", {}, p).filter((e) => !opts.epic || e.id === opts.epic).map(strip),
    tasks: select(opts, p).map(strip),
    adrs: list("adr", {}, p).map(strip),
    ...(opts.events ? { events: readEvents(p) } : {}),
  };
}

// ── entry point ──────────────────────────────────────────────────────────────

export function exportStore(format, opts = {}, p = paths()) {
  switch (format) {
    case "csv":
      return toCsv(opts, p);
    case "json":
      return `${JSON.stringify(toJson(opts, p), null, 2)}\n`;
    case "md":
      return `${toMarkdown(opts, p)}\n`;
    default:
      throw new Error(`unknown format "${format}" — use one of: ${FORMATS.join(", ")}`);
  }
}
