/**
 * The board as MCP resources — context the USER pulls, rather than context the plugin pushes.
 *
 * Everything the plugin put in front of Claude until now was pushed: SessionStart injects a
 * fixed summary once, PreCompact re-injects it, and the tools are the model's judgement to
 * call or not. A user who wants the board, one task's brief, or the dependency graph sitting
 * in context for the next twenty turns had no gesture for it. Resources are that gesture.
 *
 * Three reasons a resource earns its place over the tool that returns the same data:
 *
 *   - **who decides.** `tm_board` fires only if the model chooses to call it mid-turn. A
 *     resource is attached by the user before the first token.
 *   - **shape.** `tools/call` wraps everything as `content:[{type:"text",text:JSON.stringify(…)}]`,
 *     so `tm_board` arrives as a JSON string with escaped newlines inside it. A resource
 *     delivers the same bytes as `text/markdown`.
 *   - **capability.** `tm://graph` has no tool at all — `mermaid()` was reachable from
 *     `tm graph` and nowhere else. Same for the whole-board blocked report.
 *
 * So this file is deliberately SMALL. A resource that merely aliases a markdown file already
 * on disk (a task, an epic, an ADR) is not here: `Read` and `@` reach those directly, and a
 * URI alias for a file path competes with the real file in the picker. Only computed views.
 *
 * Two protocol details that fail SILENTLY if you get them wrong, both pinned in
 * tests/unit/resources.test.mjs:
 *
 *   1. `initialize` must declare the `resources` capability. Implement list and read but
 *      leave `capabilities: {}` and Claude Code never calls resources/list at all — `@`
 *      shows nothing and no error appears anywhere.
 *   2. resources/read returns `contents` (PLURAL, an array). `content` is the tools/call key
 *      and copy-pasting it yields a well-formed success carrying nothing.
 */
import { list, nextTasks, read } from "./store.mjs";
import { board, handoff, sessionContext, standup } from "./render.mjs";
import { mermaid, renderWhy, why } from "./graph.mjs";
import { paths } from "./paths.mjs";

/**
 * A custom scheme, not `file://`. The store's markdown files are already on disk and a client
 * can Read or @-mention those directly; what resources add is the rendered views no file
 * contains. Custom schemes are explicitly sanctioned by the spec.
 */
export const SCHEME = "tm://";
export const HANDOFF = `${SCHEME}handoff/`;

/**
 * Enumerating every task makes the `@` picker unusable, so only work in flight gets a listed
 * row. Reading an unlisted handoff still works — nothing in the protocol says a URI has to
 * have been listed to be readable — so this bounds the *picker*, not the capability.
 */
const MAX_ENUMERATED = 20;

/**
 * A resource is context, and context has a budget. Every renderer here is small on a normal
 * board (the whole board renders in ~500 chars) but they all scale with the store, and
 * silently dropping 100KB of markdown into a context window is a footgun rather than a
 * feature. Truncate loudly instead.
 */
export const MAX_CHARS = 64_000;

const MD = "text/markdown";

function clamp(text) {
  const s = String(text ?? "");
  if (s.length <= MAX_CHARS) return s;
  return `${s.slice(0, MAX_CHARS)}\n\n…truncated at ${MAX_CHARS} characters. Use the CLI (\`tm export\`) for the whole thing.`;
}

/**
 * Everything blocked, each walked to the root of its chain.
 *
 * `tm_why` answers this for ONE task and only when the model thinks to ask. Nothing renders
 * it for the whole board, which is the form the question actually takes: "what is stuck, and
 * what do I have to do about it".
 */
function blockedReport(p) {
  const stuck = list("task", {}, p).filter((t) => t.status === "blocked");
  if (!stuck.length) return "Nothing is blocked.";
  return [`# Blocked (${stuck.length})`, "", ...stuck.flatMap((t) => [renderWhy(why(t.id, p)), ""])].join("\n");
}

/** The standing views. Each carries its own `read`, so there is one list to keep in sync. */
const STATIC = [
  {
    uri: `${SCHEME}board`,
    name: "board",
    description:
      "The whole board: active epic with progress, and every in-progress / blocked / open / parked / stale task, one line each. Attach when you want the model acting on what is tracked rather than what it remembers.",
    mimeType: MD,
    read: (p) => board(p),
  },
  {
    uri: `${SCHEME}session`,
    name: "session brief",
    description:
      "The SessionStart orientation block: active epic, what is in progress and claimed, what is stale, the next unblocked tasks. Attach after a compaction to put the board back in context.",
    mimeType: MD,
    // The one view with no tool behind it and a real loss when it goes: the hook injects
    // this once, compaction eats it, and nothing else renders it.
    read: (p) =>
      sessionContext(p) || "task-management: nothing tracked yet — `tm epic new \"<title>\"` then `tm task new \"<title>\"`.",
  },
  {
    uri: `${SCHEME}graph`,
    name: "dependency graph",
    description:
      "The blocker → blocked graph for unfinished work as Mermaid, with subtask edges and status colours. Attach when the question is about ordering or what unblocks what.",
    mimeType: MD,
    // No tm_graph tool exists, so this is a capability over MCP rather than a wrapper.
    // Fenced markdown rather than a novel mimeType: it renders in strictly more places, and
    // it is the shape `tm graph` already emits.
    read: (p) => `\`\`\`mermaid\n${mermaid({}, p).mermaid}\n\`\`\``,
  },
  {
    uri: `${SCHEME}blocked`,
    name: "blocked, with reasons",
    description:
      "Everything blocked, each walked to the root of its dependency chain with the reason at each hop and the task to actually pick up. Attach when work has stalled and you want the whole picture at once.",
    mimeType: MD,
    read: (p) => blockedReport(p),
  },
  {
    uri: `${SCHEME}standup`,
    name: "standup (last 24h)",
    description:
      "What changed in the last 24 hours, grouped per task, straight off the event log. Attach when starting the day or writing a handover.",
    mimeType: MD,
    read: (p) => standup(new Date(Date.now() - 86_400_000).toISOString(), p),
  },
];

/**
 * resources/list — the four fields protocol 2024-11-05 defines and no others. Later revisions
 * added `title`, `size` and `annotations`; sending those while advertising 2024-11-05 is at
 * best ignored.
 *
 * Never throws. An error on a discovery call is retried and then abandoned for the session,
 * taking the entire resource surface with it and leaving no trace of why.
 */
export function listResources(p = paths()) {
  if (!p.root) return [];
  const rows = [...STATIC.map(({ read: _read, ...def }) => def)];

  try {
    // Work in flight first, then what is startable — the two things you would attach a brief
    // for. Ids live in the PATH, never the authority: RFC 3986 lowercases the authority during
    // normalisation, so `tm://TM-001` becomes `tm://tm-001` and the lookup misses.
    const inFlight = list("task", { status: "in_progress" }, p);
    const startable = nextTasks(p).filter((t) => !inFlight.some((x) => x.id === t.id));
    for (const t of [...inFlight, ...startable].slice(0, MAX_ENUMERATED)) {
      rows.push({
        uri: `${HANDOFF}${t.id}`,
        name: `handoff ${t.id}`,
        description: `Self-contained brief for ${t.id} "${t.title}" (${t.status}): epic context, acceptance criteria with tick state, blockers, evidence, commits.`,
        mimeType: MD,
      });
    }
  } catch {
    /* a broken task file must not cost the standing resources */
  }

  // A duplicate uri collapses in the picker and one resource becomes unreachable.
  const seen = new Set();
  return rows.filter((r) => !seen.has(r.uri) && seen.add(r.uri));
}

/**
 * resources/read. Returns `{ contents: [...] }`, or null when the uri is unknown so the
 * protocol layer can answer -32002 rather than inventing a success.
 *
 * The requested uri is echoed back verbatim, not a normalised form: a client that pairs
 * content blocks back to its request drops anything it cannot match.
 */
export function readResource(uri, p = paths()) {
  if (!p.root || !uri) return null;

  // Exact match against the registry rather than `new URL(uri).pathname` — for `tm://board`
  // that pathname is empty and the host is "board", so URL parsing quietly finds nothing.
  const hit = STATIC.find((r) => r.uri === uri);
  if (hit) return { contents: [{ uri, mimeType: hit.mimeType, text: clamp(hit.read(p)) }] };

  if (uri.startsWith(HANDOFF)) {
    const id = uri.slice(HANDOFF.length);
    // Readable whether or not it was listed: the picker is bounded, the capability is not.
    if (!read(id, p)) return null;
    return { contents: [{ uri, mimeType: MD, text: clamp(handoff(id, p)) }] };
  }
  return null;
}
