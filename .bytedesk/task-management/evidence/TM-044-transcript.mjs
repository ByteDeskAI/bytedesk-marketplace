/**
 * The work behind an in-progress task: the claiming session's Claude Code transcript, read as
 * TanStack AI `UIMessage`s.
 *
 * The store knows which session holds a claim; Claude Code writes that session's conversation to
 * ~/.claude/projects/<sanitized-cwd>/<session-id>.jsonl. Joining those two is the whole trick —
 * everything else here is the defensive reading the format demands.
 *
 * Rules this obeys (.claude/rules/parsing-claude-jsonl.md, catalogued in
 * fleet/docs/research/0002-claude-code-jsonl-format.md):
 *   - sanitize BOTH `/` and `.` to `-`; a worktree path has dots in it and a `/`-only sanitizer
 *     looks in a directory that does not exist
 *   - tolerate unknown `type` values and unparseable lines — new event types arrive between minor
 *     versions, and a tailer reads partial writes mid-flush
 *   - `tool_result` blocks live inside `user.message.content`, paired by `tool_use_id`
 *   - never read the whole file: a long session is 30+ MB
 *
 * Read-only by construction: this module opens files and returns data. Nothing here can change a
 * run, which is what the panel promises.
 */
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { currentHarness } from "./harness/sessions.mjs";

/** Bytes of transcript to read from the end. ~200 KB covers a long turn without loading 30 MB. */
const TAIL_BYTES = 200_000;
/** Messages sent to the browser. The panel is a live view, not an archive. */
const MAX_MESSAGES = 40;
/** Raw lines shown when the format stopped making sense. Fewer: they are long and unstructured. */
const RAW_FALLBACK = 12;

/** Claude Code's directory name for a working directory: every `/` AND `.` becomes `-`. */
export const sanitize = (cwd) => String(cwd).replace(/[/.]/g, "-");

export const projectDir = (cwd, home = homedir()) => join(home, ".claude", "projects", sanitize(cwd));

/**
 * The transcript for a session, and which harness wrote it.
 *
 * Claude Code is no longer assumed. The harness is whichever one's session variable is set; each
 * knows its own layout (see lib/harness/sessions.mjs), and a harness nobody recognises is a real
 * answer the panel can say out loud instead of rendering an empty box forever.
 */
export function findTranscript(cwd, session, home = homedir(), env = process.env) {
  const harness = currentHarness(env);
  if (!harness) return { harness: null, file: null };
  return { harness, file: harness.transcript(cwd, session, home) };
}

/**
 * The last whole lines of a file, read as a byte range — a long session's transcript is tens of
 * megabytes and must never be slurped to read its tail.
 *
 * When the window starts mid-file its first line is dropped: it is half a line, and it is also
 * where a multi-byte character can be cut in two.
 */
export function readTail(file, bytes = TAIL_BYTES) {
  const { size } = statSync(file);
  const from = Math.max(0, size - bytes);
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - from);
    readSync(fd, buf, 0, buf.length, from);
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    return from === 0 ? lines : lines.slice(1);
  } finally {
    closeSync(fd);
  }
}

/**
 * One transcript entry → one UIMessage, or null when it carries nothing a reader wants.
 *
 * `thinking`/`reasoning` and images are dropped: internal, and megabytes of base64 respectively.
 */
export function toMessage(entry, format = "claude-jsonl", root = null) {
  here = root; // the project this stream belongs to, for shortening the paths it mentions
  if (format === "codex-rollout") return fromCodex(entry);
  if (format === "grok-chat") return fromGrok(entry);
  return fromClaude(entry);
}

/**
 * The board's own directory, so a tool call can say `lib/store.mjs` instead of repeating forty
 * characters of absolute path that are identical on every line. Module-scoped rather than threaded
 * through four call sites for one cosmetic concern.
 */
let here = null;

function fromClaude(entry) {
  if (!entry || (entry.type !== "user" && entry.type !== "assistant")) return null;
  const content = entry.message?.content;
  const blocks = Array.isArray(content) ? content : typeof content === "string" ? [{ type: "text", text: content }] : [];
  const parts = [];
  for (const b of blocks) {
    if (b?.type === "text" && b.text?.trim()) parts.push({ type: "text", text: capped(b.text) });
    else if (b?.type === "tool_use") parts.push({ type: "tool-call", toolCallId: b.id, toolName: b.name, args: summarize(b.input) });
    else if (b?.type === "tool_result")
      parts.push({ type: "tool-result", toolCallId: b.tool_use_id, isError: Boolean(b.is_error), result: firstLines(b.content) });
  }
  if (!parts.length) return null;
  return {
    id: entry.uuid || `${entry.timestamp || ""}-${parts.length}`,
    role: entry.type,
    parts,
    createdAt: entry.timestamp || null,
    sidechain: Boolean(entry.isSidechain),
  };
}

/**
 * Codex writes a rollout: every line is `{type, payload}` and the ones worth reading are
 * `response_item`s whose payload is a message, a function_call, or its output. `developer` and
 * `system` roles are the harness talking to itself.
 */
function fromCodex(entry) {
  if (entry?.type !== "response_item") return null;
  const pl = entry.payload || {};
  const at = entry.timestamp || null;
  if (pl.type === "message") {
    if (pl.role !== "user" && pl.role !== "assistant") return null;
    const text = (pl.content || [])
      .filter((c) => c?.type === "input_text" || c?.type === "output_text")
      .map((c) => c.text)
      .join("\n")
      .trim();
    if (!text || isPreamble(text)) return null;
    return { id: pl.id || at, role: pl.role, parts: [{ type: "text", text: capped(text) }], createdAt: at, sidechain: false };
  }
  if (pl.type === "function_call" || pl.type === "custom_tool_call") {
    let args = {};
    try {
      args = summarize(JSON.parse(pl.arguments || "{}"));
    } catch {
      args = {}; // arguments are a JSON *string*; a half-written one is not worth a crash
    }
    return {
      id: pl.id || at,
      role: "assistant",
      parts: [{ type: "tool-call", toolCallId: pl.call_id || pl.id, toolName: pl.name || "tool", args }],
      createdAt: at,
      sidechain: false,
    };
  }
  if (pl.type === "function_call_output" || pl.type === "custom_tool_call_output") {
    const result = firstLines(typeof pl.output === "string" ? pl.output : pl.output?.content);
    return result
      ? { id: pl.id || at, role: "user", parts: [{ type: "tool-result", toolCallId: pl.call_id, isError: false, result }], createdAt: at, sidechain: false }
      : null;
  }
  return null;
}

/** Grok's chat_history.jsonl: role plus content, with tool calls alongside. */
function fromGrok(entry) {
  const role = entry?.role || entry?.type;
  if (role !== "user" && role !== "assistant") return null;
  const parts = [];
  const text = typeof entry.content === "string" ? entry.content : (entry.content || []).map((c) => c?.text ?? "").join("\n");
  if (text?.trim() && !isPreamble(text)) parts.push({ type: "text", text: capped(text) });
  for (const call of entry.tool_calls || []) {
    const raw = call.function?.arguments ?? call.arguments;
    let args = raw;
    if (typeof raw === "string") {
      try {
        args = JSON.parse(raw);
      } catch {
        args = { command: raw }; // not JSON after all — show it rather than dropping it
      }
    }
    parts.push({ type: "tool-call", toolCallId: call.id, toolName: call.function?.name || call.name || "tool", args: summarize(args) });
  }
  if (!parts.length) return null;
  return { id: entry.id || entry.timestamp || String(parts.length), role, parts, createdAt: entry.timestamp || null, sidechain: false };
}

/**
 * The harness talking to itself, not the agent working.
 *
 * Codex opens a turn by injecting the instruction file, the plugin catalogue and the environment
 * block as a `user` message — thousands of characters that arrive before any work happens and
 * would otherwise be the first, largest thing in the panel. It is a preamble the operator wrote
 * and already knows; showing it buries the run inside it.
 */
const PREAMBLE = /^\s*(<recommended_plugins>|<environment_context>|<INSTRUCTIONS>|# AGENTS\.md instructions|<user_instructions>)/;
const isPreamble = (text) => PREAMBLE.test(String(text || ""));

/** Tool input, flattened to the one or two fields worth showing on a card. */
function summarize(input) {
  if (!input || typeof input !== "object") return {};
  // One list across three harnesses, because the panel shows them side by side and the reader
  // should not have to know which CLI named the field. `cmd` is Codex's exec_command; `command` is
  // Claude Code's Bash; Grok passes its own arguments JSON through the same path.
  const keep = [
    "file_path", "target_file", "target_directory", "path",  // what is being touched
    "command", "cmd", "pattern", "query", "url", "prompt", "description", // what is being asked
  ];
  const out = {};
  for (const k of keep) if (typeof input[k] === "string") out[k] = firstLines(relative(input[k]), 1, 200);
  return out;
}

/** A live view, not an archive: no single message may push the rest of the stream off screen. */
const capped = (text) => firstLines(text, 14, 900);

/** An absolute path inside this project, shortened to what distinguishes it. */
const relative = (text) => {
  if (!here || !text.startsWith(here)) return text;
  return text === here ? "." : text.slice(here.length).replace(/^\//, "");
};

function firstLines(value, lines = 3, chars = 400) {
  const text = typeof value === "string" ? value : Array.isArray(value) ? value.map((c) => c?.text ?? "").join("\n") : "";
  const clipped = text.split("\n").slice(0, lines).join("\n");
  return clipped.length > chars ? `${clipped.slice(0, chars)}…` : clipped;
}

/**
 * The work stream for a task: messages, plus enough about the source for the panel to say why it
 * is empty. Never throws — a missing transcript is a normal state, not an error.
 */
export function workStream(task, claim, cwd, home = homedir(), env = process.env) {
  const session = claim?.session || null;
  try {
    const { harness, file } = findTranscript(cwd, session, home, env);
    if (!harness) {
      return { messages: [], session, file: null, harness: null, reason: "no agent CLI is running this board — the work stream needs one" };
    }
    if (!file) return { messages: [], session, file: null, harness: harness.id, reason: `${harness.label} has written no transcript for this project yet` };
    const lines = readTail(file);
    const messages = [];
    let parsed = 0;
    for (const line of lines) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // a partial write mid-flush; the next poll gets the whole line
      }
      parsed += 1;
      const m = toMessage(entry, harness.format, cwd);
      if (m) messages.push(m);
    }
    /**
     * A transcript we can read but no longer understand.
     *
     * These formats are not APIs — they are one tool's internal record, and they will change under
     * us without notice. When that happens every line maps to null and the panel would show
     * "nothing yet" over a file full of work, which reads as *idle* rather than as *broken*: the
     * one lie this panel must not tell.
     *
     * Falling back to raw text is ugly and true. You can still see what the agent is doing, and the
     * reason says why it looks like that, so the fix is obvious rather than mysterious.
     */
    if (!messages.length && parsed) {
      return {
        messages: lines.slice(-RAW_FALLBACK).map((line, i) => ({
          id: `raw-${i}`,
          role: "assistant",
          parts: [{ type: "text", text: line.length > 400 ? `${line.slice(0, 400)}…` : line }],
          createdAt: null,
          sidechain: false,
        })),
        session,
        file,
        harness: harness.id,
        reason: `${harness.label}'s transcript format has changed — showing it raw`,
      };
    }
    return { messages: messages.slice(-MAX_MESSAGES), session, file, harness: harness.id, reason: null };
  } catch (err) {
    return { messages: [], session, file: null, harness: null, reason: `transcript unreadable: ${err.message}` };
  }
}
