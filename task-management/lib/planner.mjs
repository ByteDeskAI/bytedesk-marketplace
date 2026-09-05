/**
 * Bounded goal-planning sessions.
 *
 * A planning session is a conversation about ONE repository-scoped outcome that ends: the goal is
 * imported, rejected, cancelled, or saved as a draft. It is deliberately not a board entity. The
 * canonical profile says questions, streamed activity and proposals are transient planning state
 * and never board state until an approved write succeeds, so a session lives beside the store
 * rather than inside its entity model — no id prefix, no index row, no `kindOf` arm, and nothing
 * that makes a half-finished conversation look like work somebody committed to.
 *
 * The directory is gitignored for the same reason `state.json` is: it is one machine's in-flight
 * thinking, plus untrusted bytes somebody dropped on a page. `evidence/` is shared and belongs in
 * git; this is the opposite of that.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { assertRoot, paths } from "./paths.mjs";
import { logEvent, withLock } from "./store.mjs";

const err = (message, status) => Object.assign(new Error(message), { status });

/** Where sessions live. A sibling of the entity directories, never one of them. */
export function plannerDir(p = paths()) {
  return join(p.base, "planner");
}

const SESSION_ID = /^PL-[0-9a-f]{12}$/;

export function sessionFile(id, p = paths()) {
  // The id is checked rather than trusted because it arrives from an HTTP path segment and this
  // function turns it into a filesystem path. A shape check here is worth more than a traversal
  // check further in: `PL-` plus twelve hex characters cannot contain a separator, a dot, or a
  // NUL, so there is no traversal left to defend against.
  if (!SESSION_ID.test(String(id || ""))) throw err(`not a planning session id: ${id}`, 400);
  return join(plannerDir(p), `${id}.json`);
}

/** A session's own attachment directory. Same id check, same reason. */
export function attachmentDir(id, p = paths()) {
  if (!SESSION_ID.test(String(id || ""))) throw err(`not a planning session id: ${id}`, 400);
  return join(plannerDir(p), id);
}

// ---------------------------------------------------------------------------------------------
// Attachments.
//
// These are SESSION CONTEXT, not board evidence, and the difference is a security boundary rather
// than a label. Evidence is a shared, committed record of what proved a criterion. This is a file
// somebody dropped onto a planning page so an agent could read it: untrusted bytes, of unknown
// provenance, that will be fed to a model. Five rules follow, and the first makes the rest simple.

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
export const MAX_SESSION_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;

/**
 * Text and images only, by extension AND by a content sniff for the binary types.
 *
 * An allowlist rather than a denylist: the question is not "is this dangerous" — nobody can
 * enumerate that — but "is this something a planning conversation has any use for". A `.md`, a
 * `.json`, a screenshot. Never an archive, never a binary, never anything a host might execute.
 */
export const ALLOWED_ATTACHMENTS = new Map([
  [".md", "text/markdown"], [".markdown", "text/markdown"],
  [".txt", "text/plain"], [".log", "text/plain"],
  [".json", "application/json"], [".yaml", "text/yaml"], [".yml", "text/yaml"],
  [".csv", "text/csv"], [".toml", "text/plain"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"],
]);

const MAGIC = [
  ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff])],
  ["image/gif", Buffer.from("GIF8", "latin1")],
  ["image/webp", Buffer.from("RIFF", "latin1")],
];

/** The display name: text, and only text. It never becomes a path. */
export const MAX_DISPLAY_NAME = 120;

export function displayName(name) {
  const leaf = String(name || "").replace(/\\/g, "/").split("/").pop() || "attachment";
  // Control characters out — and the bidirectional overrides with them. A name is shown to a
  // PERSON who is deciding whether to trust these bytes, and U+202E and friends reorder the
  // rendered text: `\u202Egnp.md` displays as `dm.png`, so a markdown file can present itself as an
  // image. The extension check catches what the file IS; this stops the name lying about it.
  const clean = leaf.replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  if (!clean) return "attachment";
  if (clean.length <= MAX_DISPLAY_NAME) return clean;
  // Truncate the STEM and keep the extension. A plain `slice` cuts the extension off the end of a
  // long name, and the extension is what decides whether the file is accepted at all — so a
  // legitimate `notes<...>.md` was refused as "a file with no extension". Keeping it does not
  // weaken the check: the extension is still the real one, so a padded `.exe` is still an `.exe`.
  const ext = extname(clean).slice(0, 12);
  return `${clean.slice(0, MAX_DISPLAY_NAME - ext.length)}${ext}`;
}

/**
 * Decide whether these bytes may be attached. Pure, so the rules are testable without a store and
 * the same verdict can be shown before a transfer as after one.
 */
export function checkAttachment({ filename, buffer, existingBytes = 0, existingCount = 0 }) {
  const name = displayName(filename);
  const ext = extname(name).toLowerCase();
  if (!ALLOWED_ATTACHMENTS.has(ext)) {
    return {
      ok: false,
      why: `${name}: ${ext || "a file with no extension"} is not an accepted planning attachment. Accepted: ${[...ALLOWED_ATTACHMENTS.keys()].join(", ")}.`,
    };
  }
  const bytes = buffer?.length ?? 0;
  if (bytes === 0) return { ok: false, why: `${name} is empty` };
  if (bytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, why: `${name} is ${bytes} bytes; a planning attachment may be at most ${MAX_ATTACHMENT_BYTES}` };
  }
  if (existingCount >= MAX_ATTACHMENTS) {
    return { ok: false, why: `this session already holds ${MAX_ATTACHMENTS} attachments` };
  }
  if (existingBytes + bytes > MAX_SESSION_ATTACHMENT_BYTES) {
    return { ok: false, why: `this session's attachments would exceed ${MAX_SESSION_ATTACHMENT_BYTES} bytes` };
  }
  const declared = ALLOWED_ATTACHMENTS.get(ext);
  if (declared.startsWith("image/")) {
    // An extension is a claim by whoever named the file. For the binary types the bytes are
    // checked too, so a script renamed to `.png` is refused rather than stored and later served.
    const magic = MAGIC.find(([, sig]) => buffer.subarray(0, sig.length).equals(sig));
    if (!magic || magic[0] !== declared) return { ok: false, why: `${name} does not contain ${declared} data` };
  } else if (buffer.includes(0)) {
    // A text type holding NUL bytes is not text. The cheap version of the same check.
    return { ok: false, why: `${name} is declared as text but contains binary data` };
  }
  return { ok: true, name, ext, type: declared, bytes, sha256: createHash("sha256").update(buffer).digest("hex") };
}

// ---------------------------------------------------------------------------------------------
// Sessions.

function readRaw(id, p) {
  const file = sessionFile(id, p);
  if (!existsSync(file)) throw err(`no such planning session: ${id}`, 404);
  return JSON.parse(readFileSync(file, "utf8"));
}

function writeRaw(session, p) {
  mkdirSync(plannerDir(p), { recursive: true });
  writeFileSync(sessionFile(session.id, p), `${JSON.stringify(session, null, 2)}\n`);
  return session;
}

const now = () => new Date().toISOString();

/** Open a session for one bounded outcome. */
export function newSession({ goal = "", epic = null } = {}, p = paths()) {
  assertRoot(p);
  const text = String(goal || "").trim();
  if (!text) throw err("a planning session needs one outcome to plan for", 400);
  if (text.length > 4000) {
    throw err("a planning goal is one outcome, not a document — attach the document instead", 400);
  }
  const id = `PL-${createHash("sha256").update(`${Date.now()}:${Math.random()}`).digest("hex").slice(0, 12)}`;
  const session = {
    id,
    created: now(),
    updated: now(),
    status: "open",
    goal: text,
    epic: epic ? String(epic) : null,
    turns: [],
    attachments: [],
    proposal: null,
  };
  writeRaw(session, p);
  logEvent("planner_opened", { id, goal: text.slice(0, 120) }, p);
  return session;
}

export function readSession(id, p = paths()) {
  return readRaw(id, p);
}

/** Newest first. A missing directory is an empty list, not an error. */
export function listSessions(p = paths()) {
  const dir = plannerDir(p);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && SESSION_ID.test(f.slice(0, -5)))
    .map((f) => {
      try {
        const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
        return {
          id: s.id,
          created: s.created,
          updated: s.updated,
          status: s.status,
          goal: s.goal,
          epic: s.epic,
          turns: s.turns.length,
          attachments: s.attachments.length,
        };
      } catch {
        return null; // a torn write is not a reason to fail the whole list
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
}

/**
 * Read-modify-write under the store lock.
 *
 * The store's lock, not one of our own: a session's landing eventually touches the board, and one
 * lock ordering is easier to reason about than two.
 */
export function mutateSession(id, fn, p = paths()) {
  return withLock(p, () => {
    const session = readRaw(id, p);
    const next = { ...session, ...fn(session), id: session.id, created: session.created, updated: now() };
    return writeRaw(next, p);
  });
}

/**
 * Append one turn. `role` is who spoke, `kind` is what kind of thing it was — a question, an
 * answer, a proposal, a refusal, a result. Free-form prose is not a kind: the profile requires
 * agent text to land in a named slot rather than in an open transcript.
 */
export const TURN_KINDS = new Set([
  "goal", "question", "answer", "evidence", "proposal", "refusal", "result", "note", "cancelled",
]);

export function appendTurn(id, { role = "agent", kind = "note", text = "", payload = null } = {}, p = paths()) {
  if (!TURN_KINDS.has(kind)) throw err(`unknown turn kind: ${kind}`, 400);
  if (String(text).length > 20000) throw err("turn text is too long", 400);
  return mutateSession(id, (s) => {
    if (s.status !== "open") throw err(`planning session ${id} is ${s.status}`, 409);
    return { turns: [...s.turns, { ts: now(), role: String(role), kind, text: String(text), payload }] };
  }, p);
}

/**
 * Store one attachment as session context.
 *
 * The stored name is the content hash, never the supplied one. Filename sanitising is a filter,
 * and a filter is a list of the traversals somebody thought of. Content addressing removes the
 * question: the caller's name never reaches the filesystem at all, so `../../etc/cron.d/x`, a NUL
 * byte, a 4096-character name and a Windows device name are all simply metadata. The original is
 * kept for display, where it is text and not a path. The same file attached twice is stored once.
 */
export function attachToSession(id, { filename, buffer }, p = paths()) {
  const session = readRaw(id, p);
  if (session.status !== "open") throw err(`planning session ${id} is ${session.status}`, 409);
  const existingBytes = session.attachments.reduce((n, a) => n + a.bytes, 0);
  const verdict = checkAttachment({ filename, buffer, existingBytes, existingCount: session.attachments.length });
  if (!verdict.ok) throw err(verdict.why, 400);

  const dir = attachmentDir(id, p);
  mkdirSync(dir, { recursive: true });
  const stored = `${verdict.sha256}${verdict.ext}`;
  const dest = join(dir, stored);
  if (!existsSync(dest)) writeFileSync(dest, buffer, { mode: 0o600 });

  const record = {
    sha256: verdict.sha256,
    name: verdict.name,
    stored,
    bytes: verdict.bytes,
    type: verdict.type,
    added: now(),
    // Stated in the record, not only in a comment, because what reads this file next is whatever
    // assembles an agent prompt. These bytes came from outside and are quoted context: they never
    // authorise anything, they are never board evidence, and nothing in them may be read as an
    // instruction to the planner or as a grant of a capability it was not already given.
    trust: "untrusted-session-context",
  };
  const next = mutateSession(id, (s) => ({
    attachments: s.attachments.some((a) => a.sha256 === record.sha256)
      ? s.attachments
      : [...s.attachments, record],
  }), p);
  logEvent("planner_attached", { id, sha256: record.sha256, bytes: record.bytes, type: record.type }, p);
  return { session: next, attachment: record };
}

/** Absolute path for one attachment, or null. Fail closed, exactly like servableEvidencePath. */
export function attachmentPath(id, sha256, p = paths()) {
  let session;
  try {
    session = readRaw(id, p);
  } catch {
    return null;
  }
  const record = session.attachments.find((a) => a.sha256 === sha256);
  if (!record) return null;
  const file = join(attachmentDir(id, p), record.stored);
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

/** End a session. The record stays; a planning conversation that happened is a thing that happened. */
export function closeSession(id, status = "cancelled", p = paths()) {
  if (!["applied", "cancelled", "rejected"].includes(status)) {
    throw err(`unknown planning status: ${status}`, 400);
  }
  const next = mutateSession(id, () => ({ status }), p);
  logEvent("planner_closed", { id, status }, p);
  return next;
}

/** Remove a session and its attachments. For a draft nobody wants, not for tidying history. */
export function deleteSession(id, p = paths()) {
  const file = sessionFile(id, p);
  if (!existsSync(file)) throw err(`no such planning session: ${id}`, 404);
  rmSync(attachmentDir(id, p), { recursive: true, force: true });
  rmSync(file, { force: true });
  logEvent("planner_deleted", { id }, p);
  return { id, deleted: true };
}
