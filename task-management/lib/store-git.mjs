/**
 * Does any entity in this store exist only on this machine?
 *
 * Two ways that happens, and `git status` only sees the first: a record not
 * committed, and a record committed on this branch but never pushed. Both are
 * equally lost if the laptop is.
 *
 * The store is the system of record and is git-tracked, so a record that exists
 * only in one working tree exists on one laptop. That is the failure this
 * module detects — and the one it must not cry wolf about, because a warning
 * that fires when nothing is wrong gets ignored, and then the one time it is
 * right it is ignored too.
 *
 * WHY THE REMOTE AND NOT `HEAD`. On 2026-10-08 a check of this exact shape
 * reported 18 records as uncommitted. Every one was already on the remote,
 * byte-identical, including nine the same session had committed an hour before.
 * The working tree was fine; the clone was five commits behind, so `git status`
 * called every file that had merged in the interval untracked and was right to.
 * "Committed, remote-tracking ref behind" and "never committed" are
 * indistinguishable from `git status` alone.
 *
 * So a candidate is only reported once it is absent from `origin/<branch>` OR
 * differs from the blob there — and, because the remote-tracking ref itself goes
 * stale, once a fetch has confirmed that. The fetch happens only when something
 * still looks wrong after the local comparison, so the common case (nothing to
 * report) costs no network call at all.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./paths.mjs";

/** Entity directories. A change anywhere else under the store is not a record. */
const ENTITY_DIRS = ["tasks", "epics", "adrs", "plans", "evidence", "sprints", "capabilities"];

/** Seconds a fetch may take before it is abandoned. A hook must not hang a turn. */
const FETCH_TIMEOUT_MS = 8000;

function git(cwd, args, { timeout } = {}) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout,
    }).trim();
  } catch {
    return "";
  }
}

/** The blob at <ref>:<path>, or null when the ref does not carry that path. */
function blobHash(repo, ref, rel) {
  // rev-parse rather than `show | hash`: it asks git for the object id it
  // already has, so there is nothing to hash and nothing to mis-encode. A path
  // the ref does not carry exits non-zero and yields "".
  const id = git(repo, ["rev-parse", `${ref}:${rel}`]);
  return /^[0-9a-f]{40,64}$/.test(id) ? id : null;
}

/** The id git WOULD give the file on disk, so it is comparable with the above. */
function worktreeHash(repo, abs) {
  if (!existsSync(abs)) return null;
  const id = git(repo, ["hash-object", "--", abs]);
  if (/^[0-9a-f]{40,64}$/.test(id)) return id;
  // Fall back to content equality if hash-object is unavailable for any reason.
  try {
    return "sha256:" + createHash("sha256").update(readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}

/** The remote-tracking ref this branch compares against, e.g. "origin/main". */
function upstreamOf(repo) {
  const explicit = git(repo, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  if (explicit) return explicit;
  const head = git(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return head || "";
}

/**
 * Paths committed on this branch but not on `ref` — a record that was committed
 * and never pushed is as laptop-only as one that was never committed, and
 * `git status` is silent about it.
 */
function committedNotPushed(repo, ref, storeRel) {
  const raw = git(repo, ["diff", "--name-only", `${ref}...HEAD`, "--", storeRel]);
  return raw ? raw.split(/\r?\n/).filter(Boolean) : [];
}

/** `git status --porcelain` paths under the store that look like entity files. */
function candidates(repo, storeRel) {
  /**
   * `-uall` is load-bearing. Without it git COLLAPSES an untracked directory to
   * one entry ("evidence/"), so the first evidence log in a store — or every
   * record in a brand-new store — arrives as a directory name, matches no file
   * extension below, and is silently dropped. That is the false negative this
   * module is supposed to make impossible.
   */
  const raw = git(repo, ["status", "--porcelain", "-uall", "--", storeRel]);
  if (!raw) return [];
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    // "XY path" and, for renames, "XY old -> new". The destination is the one on disk.
    let p = line.slice(3).trim();
    const arrow = p.indexOf(" -> ");
    if (arrow !== -1) p = p.slice(arrow + 4).trim();
    if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
    if (!looksLikeEntity(p)) continue;
    out.push(p);
  }
  return [...new Set(out)];
}

/** An entity file: under one of the entity directories, with a record's extension. */
function looksLikeEntity(rel) {
  if (!/\.(md|log|json|txt)$/i.test(rel)) return false;
  return rel.split("/").some((seg) => ENTITY_DIRS.includes(seg));
}

/** Of `rels`, the ones the ref does not already carry with identical content. */
function notOn(repo, ref, rels) {
  return rels.filter((rel) => {
    const there = blobHash(repo, ref, rel);
    if (!there) return true; // the ref does not have it at all
    const here = worktreeHash(repo, join(repo, rel));
    if (!here) return true; // deleted locally while the ref still has it
    return here !== there;
  });
}

/**
 * Entity files in this store that are not on the remote.
 *
 * Returns `{ files, repo, upstream, fetched, reason }`. `files` empty means
 * nothing to report. `reason` explains an empty result that was not a clean
 * comparison — no repo, no upstream — so a caller can tell "all committed" from
 * "could not tell", which are not the same answer.
 */
export function uncommittedEntities(p = paths(), { allowFetch = true } = {}) {
  const none = (reason) => ({ files: [], repo: null, upstream: "", fetched: false, reason });
  if (!p || !p.base || !p.root) return none("no store");
  if (!existsSync(p.base)) return none("no store");

  /**
   * ASK GIT FOR BOTH PATHS. Deriving the store's path inside the repo by
   * string arithmetic looks obvious and is wrong: on Windows `os.tmpdir()` and
   * anything inheriting it yields the 8.3 short form (`C:/Users/RYANHE~1/...`)
   * while `git rev-parse` yields the long form (`C:/Users/RyanHelms/...`). Same
   * directory, different text, so `relative()` returned `../../../..`,
   * `git status -- <that>` failed with "is outside repository", the failure was
   * swallowed, and the store read CLEAN. A check that cannot fail is not a
   * check. The same trap exists for symlinked paths, differing drive-letter
   * case and worktrees.
   *
   * `--show-toplevel` and `--show-prefix`, run from inside the store, are
   * git's own answer to both halves and need no normalising.
   */
  const repo = git(p.base, ["rev-parse", "--show-toplevel"]);
  if (!repo) return none("not a git repo");
  // Trailing slash from git; "" would mean the store IS the repo root.
  const storeRel = git(p.base, ["rev-parse", "--show-prefix"]).replace(/\/+$/, "");
  if (!storeRel) return none("store is the repo root");

  const dirty = candidates(repo, storeRel);

  const upstream = upstreamOf(repo);
  if (!upstream) {
    // Nothing to compare against, so the committed-but-unpushed half cannot be
    // asked at all. Report what git status says and say why, so the caller can
    // soften the wording rather than implying a clean comparison.
    if (dirty.length === 0) return { files: [], repo, upstream: "", fetched: false, reason: "" };
    return { files: dirty, repo, upstream: "", fetched: false, reason: "no upstream branch" };
  }

  // Two sources, one question: which records exist only here? A clean working
  // tree can still be holding unpushed commits, so this cannot short-circuit on
  // `dirty` being empty.
  const local = [
    ...new Set([...dirty, ...committedNotPushed(repo, upstream, storeRel).filter(looksLikeEntity)]),
  ];
  if (local.length === 0) return { files: [], repo, upstream, fetched: false, reason: "" };

  let left = notOn(repo, upstream, local);
  if (left.length === 0) return { files: [], repo, upstream, fetched: false, reason: "" };

  // Something still looks uncommitted. NOW the remote-tracking ref's own
  // freshness is worth a network call — and only now.
  let fetched = false;
  if (allowFetch) {
    const slash = upstream.indexOf("/");
    const remote = slash === -1 ? "origin" : upstream.slice(0, slash);
    const branch = slash === -1 ? upstream : upstream.slice(slash + 1);
    const r = spawnSync("git", ["-C", repo, "fetch", "--quiet", remote, branch], {
      stdio: "ignore",
      windowsHide: true,
      timeout: FETCH_TIMEOUT_MS,
    });
    fetched = !r.error && r.status === 0;
    if (fetched) left = notOn(repo, upstream, left);
  }

  return { files: left, repo, upstream, fetched, reason: "" };
}

/** A stable id for a set of files, so the same set is reported once, not every turn. */
export function fingerprint(files) {
  return createHash("sha256").update([...files].sort().join("\n")).digest("hex").slice(0, 16);
}
