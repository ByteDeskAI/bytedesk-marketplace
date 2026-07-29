/**
 * Which files a task actually touched — observed, not declared.
 *
 * `touches` has been a documented field with no writers. `tm parallel` reads it to
 * build collision-free batches (bin/tm's `parallel`), `renderShow` prints it, and both
 * README.md and AGENTS.md say it is "what `tm parallel` uses to decide which work can
 * run at the same time". Nothing ever set it. The consequence is not a missing feature
 * but a wrong answer: with `touches` empty every task looks disjoint from every other,
 * so `tm parallel` puts two tasks that rewrite the same file in one batch and tells you
 * to run them side by side — which is the exact collision the field exists to prevent.
 *
 * Asking agents to declare paths up front does not work; they do not know yet, and a
 * field maintained by discipline is a field that is empty. So observe it: PostToolUse
 * on Edit/Write records the file that was just edited against whichever task this
 * session is holding.
 *
 * The one rule that matters: attribute to a task we are SURE about, or not at all. A
 * path recorded against the wrong task is worse than a missing one — it invents a
 * collision that serializes work needlessly, and it hides a real collision on the task
 * that actually owns the file. Ambiguity is resolved by declining to guess.
 */
import { relative, resolve } from "node:path";
import { config, list, mutate, read } from "./store.mjs";
import { claimant } from "./claims.mjs";
import { paths } from "./paths.mjs";

/**
 * Frontmatter is one line per key, so an unbounded list eventually makes a task file
 * unreadable in the PR diff the store exists to be read in. A task touching more than
 * this is telling you something about its scope, not about its files.
 */
export const MAX_TOUCHES = 40;

/** The store's own files are not project work — recording them would make every task collide. */
const IGNORED = [/(^|\/)\.bytedesk\//, /(^|\/)\.git\//, /(^|\/)node_modules\//];

/**
 * Repo-relative, or null if the path is outside the store root.
 *
 * Absolute paths are useless here for the same reason `tm export` strips `file`: they
 * name one machine's disk. And a task in a worktree edits files under a different
 * absolute prefix than the same task in the main checkout, so an absolute path would
 * make identical work look disjoint.
 */
export function normalise(filePath, p = paths(), { from = process.cwd(), base } = {}) {
  if (!filePath || !p.root) return null;
  // `from` is what a relative path is relative TO. The hook always gets an absolute
  // path from Claude Code, but `tm touches <id> src/auth.ts` typed in a subdirectory
  // means that subdirectory's src/auth.ts — so the default is the cwd, and callers who
  // are not standing where the user is have to say so.
  const abs = resolve(from, String(filePath));

  // `base` is the checkout the path should be expressed relative to, which is NOT
  // always the store root. Worktrees live at <root>/.bytedesk/worktrees/TM-014-…, so a
  // worktree's src/auth.ts is `.bytedesk/worktrees/TM-014-…/src/auth.ts` relative to
  // the root — which the ignore list below would drop, and which would in any case
  // never match the main checkout's `src/auth.ts`. Since worktrees are exactly where
  // parallel work happens, that would blind the feature precisely where it matters.
  // Expressed relative to its own checkout, the same file in two worktrees is the same
  // path, and the collision is visible.
  const root = base || p.root;
  if (abs === root) return null;
  const rel = relative(root, abs);
  if (!rel || rel.startsWith("..")) return null;
  if (IGNORED.some((re) => re.test(rel))) return null;
  return rel;
}

/**
 * The task an edit belongs to, or null when we cannot tell.
 *
 * Branch first — a `tm/TM-014-…` branch is an unambiguous statement of intent and needs
 * no discipline, the same precedence `linkGit` uses for commits. Then a single task
 * this session is running. Two tasks in progress in one session is genuinely ambiguous:
 * we would be guessing, and a wrong guess poisons the collision data both ways.
 */
export function attribute({ branch = null, session = null } = {}, p = paths()) {
  const fromBranch = (String(branch || "").match(/\bTM-\d+\b/) || [])[0];
  if (fromBranch && read(fromBranch, p)) return fromBranch;

  const running = list("task", { status: "in_progress" }, p);
  const mine = session ? running.filter((t) => t.session === session) : running;
  const candidates = mine.length ? mine : running;
  if (candidates.length === 1) return candidates[0].id;

  // Several in flight: a claim held by this session breaks the tie, since that is the
  // one the session explicitly took.
  if (session) {
    const claimed = candidates.filter((t) => claimant(t.id, p)?.session === session);
    if (claimed.length === 1) return claimed[0].id;
  }
  return null;
}

/**
 * Record paths against a task. Returns what was added — empty when there was nothing
 * new, which is the common case once a task has been worked on for a while.
 */
export function record(id, filePaths, p = paths(), { from, base } = {}) {
  if (!read(id, p)) return { added: [], capped: false };

  // Read-append-write, and the highest-frequency one in the plugin: this fires on every
  // Edit and Write, from every concurrent session. Reading `touches` outside the lock and
  // writing a computed list back is exactly the shape that loses writes — two edits
  // landing together would each append one path to the same list and the second would
  // overwrite the first. `mutate` runs the append inside the lock on the current doc.
  let added = [];
  let capped = false;
  mutate(
    id,
    (task) => {
      const existing = task.touches || [];
      const seen = new Set(existing);
      added = [];
      for (const raw of [].concat(filePaths)) {
        const rel = normalise(raw, p, { ...(from ? { from } : {}), ...(base ? { base } : {}) });
        if (!rel || seen.has(rel)) continue;
        seen.add(rel);
        added.push(rel);
      }
      if (!added.length) return {};
      const next = [...existing, ...added].sort();
      capped = next.length > MAX_TOUCHES;
      return { touches: capped ? next.slice(0, MAX_TOUCHES) : next };
    },
    p,
  );
  return { added, capped };
}

/**
 * The PostToolUse entry point: one edited file → one path on one task.
 *
 * Deliberately silent. This fires on every Edit and Write in a session, so anything it
 * printed would be printed hundreds of times; the record in the file and the event log
 * is the output. Returns a summary for the tests.
 */
export function observe(input = {}, { p = paths(), branch = null, session = null, base } = {}) {
  if (config(p).trackTouches === false) return { skipped: "disabled" };

  const ti = input.tool_input || {};
  // Write/Edit/MultiEdit carry file_path; NotebookEdit carries notebook_path.
  const file = ti.file_path || ti.notebook_path;
  if (!file) return { skipped: "no path in the payload" };

  // A failed edit changed nothing, so it says nothing about what the task touches.
  const response = input.tool_response;
  if (response && typeof response === "object" && response.success === false) {
    return { skipped: "the edit failed" };
  }

  // Normalise once, here, and tell `record` the base so it does not resolve an
  // already-relative path a second time against the process cwd. That double
  // normalisation is silent and total: in a worktree or any subdirectory the second
  // pass sends the path outside the root and every observation is dropped, while a
  // session run from the project root works fine — a bug that only appears where it is
  // hardest to notice. normalise(rel, p, {from: p.root}) === rel, which is pinned below.
  const anchor = base || p.root;
  const rel = normalise(file, p, { base: anchor });
  if (!rel) return { skipped: "outside the checkout, or ignored" };

  const id = attribute({ branch, session }, p);
  if (!id) return { skipped: "no unambiguous task to attribute to" };

  const { added, capped } = record(id, [rel], p, { from: anchor, base: anchor });
  return { id, added, capped };
}
