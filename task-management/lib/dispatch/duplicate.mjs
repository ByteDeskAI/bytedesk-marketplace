/**
 * Detect work already integrated for this exact task. Only primary task markers
 * on the configured integration branch count. Dependency mentions, ID prefixes,
 * preparation and unmerged side branches are not completion evidence.
 *
 * Exclude the task's own branch and merge commits so its own landing is not
 * reported as somebody else's implementation. Unreadable history returns no
 * accusation. A refusal names its evidence and remains local to this task.
 */
import { execFileSync } from "node:child_process";
import { config } from "../store.mjs";

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
 * Git narrows the candidates by literal text; the exact primary-marker check
 * below removes dependency mentions and task-ID prefix matches.
 */
export function duplicateCommits(task, p, { limit = 5 } = {}) {
  const id = String(task?.id || "").trim();
  const root = p?.root;
  if (!id || !root) return [];

  const cfg = config(p);
  const integrationBranch = cfg.dispatch?.integrationBranch ?? cfg.integrationBranch ?? "HEAD";
  // A task mention on an unintegrated side branch is advisory, not proof of completion.
  if (!git(root, ["rev-parse", "--verify", `${integrationBranch}^{commit}`])) return [];
  const args = [
    "log",
    integrationBranch,
    "--no-merges",
    "-F",
    "-i",
    `--grep=${id}`,
    "--max-count=100",
    "--format=%h%x09%an%x09%s%x09%b%x00",
  ];

  // Exclude the task's own branch, when it has one that exists. A task dispatched
  // for the first time has no branch yet, and then every match is somebody else's.
  const branch = String(task?.branch || "").trim();
  if (branch && git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) {
    args.push("--not", `refs/heads/${branch}`);
  }

  const out = git(root, args);
  if (!out) return [];
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const primary = new RegExp(`^(?:${escaped}(?:\\s*[:\\]—-]|\\s)|(?:feat|fix|refactor|perf|test|docs|chore)\\(${escaped}\\):)|\\(${escaped}\\)\\s*$`, "i");
  const completion = new RegExp(`^(?:fixes|closes|resolves|implements|task-id):\\s*${escaped}\\s*$`, "im");
  return out
    .split("\0")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, author, subject, ...body] = line.split("\t");
      return { sha, author, subject, body: body.join("\t") };
    })
    .filter((commit) => (primary.test(commit.subject) && !/\b(?:prep(?:are|aration)?|depend(?:ency|s|ent)?|follow.?up|prerequisite|blocked by|wip)\b/i.test(commit.subject)) || completion.test(commit.body))
    .slice(0, limit)
    .map(({ body, ...commit }) => ({ ...commit, integrationBranch, evidence: "integrated-task-marker" }));
}

/** One line per commit, for a refusal or a log line a person has to act on. */
export function describeDuplicates(commits) {
  return commits.map((c) => `${c.sha} ${c.subject} (${c.author})`).join("; ");
}
