/**
 * Evidence files live in p.evidence. The task only stores a string ref — no extra
 * frontmatter. Dest naming matches `tm evidence`: a copied file is
 * `<id>-<basename>`, stdin/text is `<id>-<ts>.log`. The stored ref is dest
 * relative to p.root, the same string the CLI has always written.
 *
 * Serving a file (the dashboard GET) is a different question from recording one.
 * A ref may be a URL, a `browser:` handle, or a path outside the store; those
 * stay on the task (doctor must not treat them as missing files) but they are
 * never served. 200 only if the ref is on that task.evidence AND realpath is
 * inside p.evidence.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve, sep } from "node:path";
import { mutate } from "./store.mjs";

/**
 * Same scheme test doctor uses: two-or-more characters before the colon, so a
 * Windows drive letter is a path. See lib/doctor.mjs.
 */
const URI = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

export const PREVIEWABLE = new Set([
  ".log",
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".diff",
  ".out",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

/**
 * `.svg` was in that list and had to come out.
 *
 * SVG is a document, not an image: served inline as `image/svg+xml` it executes its own script in
 * the dashboard's origin, and evidence is attached by whoever can reach the board with no
 * extension allowlist and no content sniff on the way in. `<svg onload="fetch('/api/…')">` reached
 * every board write, the dispatch route that spawns a worker, and the planner's approve-and-apply
 * pair. It is still attachable and still downloadable — it is no longer rendered.
 */

/**
 * Provenance — where an attached file came from, and what it said when it was taken.
 *
 * `attachEvidence` COPIES. That is the right call (the store must still read after the
 * branch is deleted and the source is gone), but for a long time it copied and recorded
 * nothing else, so a source edited five minutes later left the task pointing at a snapshot
 * with no way to tell. That is not a hypothetical: TM-123's attachment drifted within an
 * hour of being taken, because the agent appended its measurement addendum to the source
 * after the copy, and the task was closed on numbers its own evidence no longer contained.
 *
 * The record lives on the entity under `evidenceSources`, a map keyed by the SAME ref
 * string that is already on `evidence[]`:
 *
 *   evidenceSources: {".bytedesk/task-management/evidence/TM-1-out.txt":
 *      {"source":"/abs/path/out.txt","sha256":"<hex>","bytes":12,"at":"2026-…"}}
 *
 * A map rather than richer `evidence[]` entries, because `evidence[]` is a list of strings
 * in every reader there is — the CLI, the dashboard, the MCP tools, the done gate, doctor,
 * export, and any store already on disk. Turning it into a list of objects would break all
 * of them at once; a sibling map is additive, and an entity that has never seen this code
 * simply has no map. That absence is `unknown`, which is a different verdict from `drifted`
 * and is reported as such.
 *
 * An inline capture (stdin, a pasted log, an upload) has no upstream file, so it records
 * `source: null`. That is not the same as no record at all: it says the question was asked
 * and there is nothing to track, where `unknown` says nobody asked.
 */
export const PROVENANCE = "evidenceSources";

/** sha256 of a file's bytes, or null if it cannot be read. */
export function hashFile(file) {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

export const hashBytes = (buf) => createHash("sha256").update(buf).digest("hex");

export const isEvidenceUri = (ref) => typeof ref === "string" && URI.test(ref);

export function evidenceKind(ref) {
  if (!isEvidenceUri(ref)) return "file";
  return /^https?:/i.test(ref) ? "url" : "uri";
}

function safeBase(name) {
  const leaf = basename(String(name || "").replace(/\\/g, "/"));
  if (!leaf || leaf === "." || leaf === "..") throw new Error("evidence file needs a name");
  return leaf;
}

function refFor(dest, p) {
  const prefix = p.root.endsWith(sep) ? p.root : p.root + sep;
  if (dest.startsWith(prefix)) return dest.slice(prefix.length);
  return dest.replace(`${p.root}/`, "");
}

function namedSource(source) {
  return Boolean((source.path && source.path !== "-") || source.filename);
}

/** Dest path and store-relative ref for one attach. Does not write. */
export function evidenceDest(id, source = {}, p) {
  mkdirSync(p.evidence, { recursive: true });
  const leaf = namedSource(source)
    ? safeBase(source.filename || source.path)
    : `${source.ts ?? Date.now()}.log`;
  // TM-145. The prefix is skipped when the source already carries it, because `TM-144-REPORT.md`
  // is the natural name to give the file AND the name every evidence file in this store already
  // uses — so prepending unconditionally produced `TM-144-TM-144-REPORT.md`. That is cosmetic on
  // its own and harmful together: one artifact becomes two files that look like two, the reader
  // finds the un-prefixed copy first, and the task record points at the other one.
  //
  // Matched case-insensitively and only at the START, with the separator required. `TM-1` must not
  // swallow the prefix of `TM-14-NOTES.md`, so the id has to be followed by `-` or `_` or `.`.
  const prefixed = new RegExp(`^${id}[-_.]`, "i").test(leaf);
  const dest = join(p.evidence, prefixed ? leaf : `${id}-${leaf}`);
  return { dest, ref: refFor(dest, p) };
}

/**
 * Write the file, then append the ref under the lock. Callers that already
 * read the doc must not splice the array themselves — that is the race
 * `mutate` exists to close.
 */
export function attachEvidence(id, source, p) {
  const { dest, ref } = evidenceDest(id, source, p);
  let origin = null;
  if (source.path && source.path !== "-") {
    origin = resolve(source.path);
    copyFileSync(origin, dest);
  } else if (source.buffer != null) {
    writeFileSync(dest, source.buffer);
  } else if (source.content != null) {
    writeFileSync(dest, source.content);
  } else {
    writeFileSync(dest, source.text ?? "");
  }
  /**
   * Hash the copy, not the source: they are the same bytes at this instant, and the copy
   * is the thing that cannot change under us between the write and the read.
   */
  const record = { source: origin, sha256: hashFile(dest), bytes: sizeOf(dest), at: new Date().toISOString() };
  mutate(id, (doc) => ({
    evidence: [...(doc.evidence || []), ref],
    [PROVENANCE]: { ...(doc[PROVENANCE] || {}), [ref]: record },
  }), p);
  return { dest, ref, provenance: record };
}

/**
 * Drop the ref from the array. The file, if any, stays on disk.
 *
 * The provenance entry goes with it. Leaving it behind would accumulate records for refs
 * no entity carries, and — worse — a later attach of the same basename would find a stale
 * hash sitting under its own ref and be reported as drifted before anyone touched it.
 */
export function detachEvidence(id, ref, p) {
  const next = mutate(id, (doc) => {
    const map = { ...(doc[PROVENANCE] || {}) };
    delete map[ref];
    return {
      evidence: (doc.evidence || []).filter((e) => e !== ref),
      [PROVENANCE]: Object.keys(map).length ? map : undefined,
    };
  }, p);
  return next.evidence || [];
}

const sizeOf = (file) => {
  try {
    return statSync(file).size;
  } catch {
    return null;
  }
};

/**
 * Whether the copy on the task still says what its source says.
 *
 *   external        the ref is a url or an opaque handle — nothing on disk to compare
 *   unknown         no provenance recorded (attached before this existed, or hand-written)
 *   inline          captured from stdin or a paste; there is no upstream file
 *   in-sync         the source is present and hashes to what was attached
 *   drifted         the source is present and its content has changed since
 *   source-missing  the source path no longer resolves — deleted, moved, or a worktree gone
 *   source-unreadable  the path is there but the bytes are not (permissions, a directory)
 *
 * `unknown` is deliberately not `drifted`. An older store cannot answer the question, and
 * a check that answers "changed" when it means "cannot tell" is the same species of lie
 * this whole record exists to stop.
 */
export function evidenceSync(entity, ref, p) {
  if (evidenceKind(ref) !== "file") return { ref, state: "external", source: null };
  const map = entity && typeof entity[PROVENANCE] === "object" && entity[PROVENANCE] ? entity[PROVENANCE] : null;
  const rec = map ? map[ref] : null;
  if (!rec) return { ref, state: "unknown", source: null };
  const source = rec.source || null;
  const at = rec.at || null;
  if (!source) return { ref, state: "inline", source: null, at };
  if (!existsSync(source)) return { ref, state: "source-missing", source, at, sha256: rec.sha256 || null };
  const current = hashFile(source);
  if (current == null) return { ref, state: "source-unreadable", source, at, sha256: rec.sha256 || null };
  if (!rec.sha256) return { ref, state: "unknown", source, at };
  return {
    ref,
    state: current === rec.sha256 ? "in-sync" : "drifted",
    source,
    at,
    sha256: rec.sha256,
    current,
  };
}

/** Every attachment on one entity, with its sync verdict. */
export function evidenceSyncReport(entity, p) {
  return (entity.evidence || []).map((ref) => evidenceSync(entity, ref, p));
}

export function describeEvidence(ref, p) {
  const kind = evidenceKind(ref);
  if (kind !== "file") {
    return { ref, kind, name: ref, exists: true, previewable: false };
  }
  const target = isAbsolute(ref) ? ref : join(p.root, ref);
  const exists = existsSync(target);
  let previewable = false;
  if (exists) {
    try {
      const file = realpathSync(target);
      const dir = realpathSync(p.evidence);
      const inside = file === dir || file.startsWith(dir + sep);
      previewable = inside && statSync(file).isFile() && PREVIEWABLE.has(extname(file).toLowerCase());
    } catch {
      previewable = false;
    }
  }
  return { ref, kind, name: basename(String(ref).replace(/\\/g, "/")), exists, previewable };
}

export function listEvidence(task, p) {
  return (task.evidence || []).map((ref) => {
    const { state, source, at } = evidenceSync(task, ref, p);
    return { ...describeEvidence(ref, p), sync: state, source, attachedAt: at ?? null };
  });
}

/**
 * Absolute path the dashboard may serve, or null. Fail closed: missing task,
 * missing ref, URI, broken symlink, missing file, or a realpath outside
 * p.evidence all return null. The HTTP layer turns that into 404.
 */
export function servableEvidencePath(task, ref, p) {
  if (!task || typeof ref !== "string" || !ref) return null;
  if (!(task.evidence || []).includes(ref)) return null;
  if (isEvidenceUri(ref)) return null;
  const target = isAbsolute(ref) ? ref : join(p.root, ref);
  let file;
  let dir;
  try {
    file = realpathSync(target);
    dir = realpathSync(p.evidence);
  } catch {
    return null;
  }
  if (file !== dir && !file.startsWith(dir + sep)) return null;
  try {
    if (!statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  return file;
}
