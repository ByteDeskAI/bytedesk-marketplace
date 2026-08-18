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
import { copyFileSync, existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, resolve, sep } from "node:path";
import { mutate } from "./store.mjs";

/**
 * Same scheme test doctor uses: two-or-more characters before the colon, so a
 * Windows drive letter is a path. See lib/doctor.mjs.
 */
const URI = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

const PREVIEWABLE = new Set([
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
  ".svg",
]);

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
  const dest = join(p.evidence, `${id}-${leaf}`);
  return { dest, ref: refFor(dest, p) };
}

/**
 * Write the file, then append the ref under the lock. Callers that already
 * read the doc must not splice the array themselves — that is the race
 * `mutate` exists to close.
 */
export function attachEvidence(id, source, p) {
  const { dest, ref } = evidenceDest(id, source, p);
  if (source.path && source.path !== "-") {
    copyFileSync(resolve(source.path), dest);
  } else if (source.buffer != null) {
    writeFileSync(dest, source.buffer);
  } else if (source.content != null) {
    writeFileSync(dest, source.content);
  } else {
    writeFileSync(dest, source.text ?? "");
  }
  mutate(id, (doc) => ({ evidence: [...(doc.evidence || []), ref] }), p);
  return { dest, ref };
}

/** Drop the ref from the array. The file, if any, stays on disk. */
export function detachEvidence(id, ref, p) {
  const next = mutate(id, (doc) => ({
    evidence: (doc.evidence || []).filter((e) => e !== ref),
  }), p);
  return next.evidence || [];
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
  return (task.evidence || []).map((ref) => describeEvidence(ref, p));
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
