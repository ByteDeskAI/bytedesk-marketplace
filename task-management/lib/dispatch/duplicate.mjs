/**
 * duplicate: has this task's work already landed somewhere else?
 *
 * The store knows who CLAIMED a task. It does not know who DID it. A person, or
 * a session working outside the dispatch system, can finish the same work and
 * push it while a dispatched worker is still going — and nothing in claims,
 * touches or readiness notices, because none of them look at the repository.
 *
 * That is not hypothetical. TM-310 was dispatched to a worker at 21:49 and the
 * same removal landed on develop as f30b4bc9 at 22:19, thirty minutes later. The
 * duplicate went undetected for a day; the worker found out when its merge
 * conflicted, having rebuilt work that was already shipped.
 *
 * The signal that existed the whole time was a commit message naming the task.
 * This module reads it.
 *
 * What counts as a duplicate, and why each exclusion is here:
 *   --no-merges   the merge commit of the task's OWN pull request names the task
 *                 and is not reachable from its branch. Without this, every task
 *                 reports itself as a duplicate the moment it merges.
 *   --not <branch>  the worker's own commits name the task constantly. Only work
 *                 that is NOT the worker's own is interesting.
 *   --all         a duplicate on any branch matters, not just the base one. The
 *                 task store has no notion of a base branch to compare against.
 *
 * This reports; it does not adjudicate. A commit saying "prep for TM-310" is a
 * match and is not a duplicate, so the dispatch refusal names the commits and
 * can be turned off (`tm config dispatch.duplicateGuard false`) rather than
 * pretending to be certain.
 *
 * ponytail: the guard goes quiet once the worker merges the base branch into its
 * own, because the duplicate becomes reachable from the branch and `--not` then
 * excludes it. Verified against the TM-310 history: f30b4bc9 is not an ancestor
 * of a51fa498 (pre-merge — reported on every tick, which is the window that
 * matters) and is an ancestor of a822fe69 (post-merge — silent). That is the
 * right trade at this size: after the merge the worker holds the duplicate in
 * its own history and a person has already seen the conflict. If a case ever
 * needs the later signal too, compare against the dispatch base recorded at
 * provision time instead of the branch tip.
 */
import { execFileSync } from "node:child_process";

/** git, for questions where "no" is an answer and not a failure. */
function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

/** True when this guard is on. Off only when set to exactly false. */
export function duplicateGuardEnabled(cfg = {}) {
  return cfg.dispatch?.duplicateGuard !== false;
}

/**
 * Commits that name this task and are not the task's own work.
 *
 * Returns [] for anything unanswerable — no git, no repo, no commits, a store
 * that is not in a checkout. A guard that cannot see must not accuse.
 *
 * ponytail: `-F` matches the id as a literal substring, so TM-310 also matches
 * a commit naming TM-3100. Switch to `-E` with a word-boundary pattern if a
 * store ever reaches four-digit ids.
 */
export function duplicateCommits(task, p, { limit = 5 } = {}) {
  const id = String(task?.id || "").trim();
  const root = p?.root;
  if (!id || !root) return [];

  const args = [
    "log",
    "--all",
    "--no-merges",
    "-F",
    "-i",
    `--grep=${id}`,
    `--max-count=${limit}`,
    "--format=%h%x09%an%x09%s",
  ];

  // Exclude the task's own branch, when it has one that exists. A task dispatched
  // for the first time has no branch yet, and then every match is somebody else's.
  const branch = String(task?.branch || "").trim();
  if (branch && git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) {
    args.push("--not", `refs/heads/${branch}`);
  }

  const out = git(root, args);
  if (!out) return [];
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, author, ...subject] = line.split("\t");
      return { sha, author, subject: subject.join("\t") };
    });
}

/** One line per commit, for a refusal or a log line a person has to act on. */
export function describeDuplicates(commits) {
  return commits.map((c) => `${c.sha} ${c.subject} (${c.author})`).join("; ");
}
