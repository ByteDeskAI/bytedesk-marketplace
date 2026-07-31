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

/** Bytes of transcript to read from the end. ~200 KB covers a long turn without loading 30 MB. */
const TAIL_BYTES = 200_000;
/** Messages sent to the browser. The panel is a live view, not an archive. */
const MAX_MESSAGES = 40;

/** Claude Code's directory name for a working directory: every `/` AND `.` becomes `-`. */
export const sanitize = (cwd) => String(cwd).replace(/[/.]/g, "-");

export const projectDir = (cwd, home = homedir()) => join(home, ".claude", "projects", sanitize(cwd));

/**
 * The transcript for a session, or the most recently modified one in the project when the session
 * is unknown — a claim written by an older `tm` has no session, and the newest conversation is a
 * better answer than nothing.
 */
export function findTranscript(cwd, session, home = homedir()) {
  const dir = projectDir(cwd, home);
  if (!existsSync(dir)) return null;
  if (session) {
    const exact = join(dir, `${session}.jsonl`);
    if (existsSync(exact)) return exact;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(dir, f))
    .map((f) => ({ f, m: statSync(f).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length ? files[0].f : null;
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
 * `thinking` and `image` parts are dropped: thinking is internal and its signature is opaque, and
 * a base64 image is megabytes of noise in a side panel.
 */
export function toMessage(entry) {
  if (!entry || (entry.type !== "user" && entry.type !== "assistant")) return null;
  const content = entry.message?.content;
  const blocks = Array.isArray(content) ? content : typeof content === "string" ? [{ type: "text", text: content }] : [];
  const parts = [];
  for (const b of blocks) {
    if (b?.type === "text" && b.text?.trim()) parts.push({ type: "text", text: b.text });
    else if (b?.type === "tool_use") parts.push({ type: "tool-call", toolCallId: b.id, toolName: b.name, args: summarize(b.input) });
    else if (b?.type === "tool_result")
      parts.push({
        type: "tool-result",
        toolCallId: b.tool_use_id,
        isError: Boolean(b.is_error),
        result: firstLines(b.content),
      });
  }
  if (!parts.length) return null;
  return {
    id: entry.uuid || `${entry.timestamp || ""}-${parts.length}`,
    role: entry.type,
    parts,
    createdAt: entry.timestamp || null,
    // Not part of UIMessage, but the panel wants it: a sidechain entry is a subagent's work.
    sidechain: Boolean(entry.isSidechain),
  };
}

/** Tool input, flattened to the one or two fields worth showing on a card. */
function summarize(input) {
  if (!input || typeof input !== "object") return {};
  const keep = ["file_path", "path", "command", "pattern", "url", "description", "query"];
  const out = {};
  for (const k of keep) if (typeof input[k] === "string") out[k] = firstLines(input[k], 1, 200);
  return out;
}

function firstLines(value, lines = 3, chars = 400) {
  const text = typeof value === "string" ? value : Array.isArray(value) ? value.map((c) => c?.text ?? "").join("\n") : "";
  const clipped = text.split("\n").slice(0, lines).join("\n");
  return clipped.length > chars ? `${clipped.slice(0, chars)}…` : clipped;
}

/**
 * The work stream for a task: messages, plus enough about the source for the panel to say why it
 * is empty. Never throws — a missing transcript is a normal state, not an error.
 */
export function workStream(task, claim, cwd, home = homedir()) {
  const session = claim?.session || null;
  try {
    const file = findTranscript(cwd, session, home);
    if (!file) return { messages: [], session, file: null, reason: "no transcript for this project yet" };
    const messages = [];
    for (const line of readTail(file)) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // a partial write mid-flush; the next poll gets the whole line
      }
      const m = toMessage(entry);
      if (m) messages.push(m);
    }
    return { messages: messages.slice(-MAX_MESSAGES), session, file, reason: null };
  } catch (err) {
    return { messages: [], session, file: null, reason: `transcript unreadable: ${err.message}` };
  }
}
