/**
 * TM-361: the review sweep. Finished work nobody reviewed, and open PRs nobody is moving.
 *
 * Findings:
 *   no-review  a task that is done (closed within `sinceDays`) or a governed task at
 *              ready-for-review, with recorded commits, and no reviewer verdict anywhere tm can see.
 *   idle-pr    an open, non-draft PR whose last update is older than `idleHours`. Read from
 *              `gh pr list`; offline or without gh this half reports `skipped: <why>`, never fails.
 *
 * `apply` fires each finding exactly once: a per-finding marker in the machine-local
 * review-sweep.json, plus a task comment so the board shows it even with agent-orchestration absent.
 * An idle PR's key includes its updatedAt, so a PR that moves and goes idle again fires again.
 * agent-orchestration's supervisor runs `tm review-sweep --apply --json` and turns each fresh
 * finding into a review request or a standing-mail notice to the lead (TM-361).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addComment } from "./issue.mjs";
import { readManagementRecord } from "./governance-check.mjs";
import { list } from "./store.mjs";

const markerFile = (p) => join(p.base, "review-sweep.json");
const TM_ID = /\bTM-\d+\b/i;

function readMarkers(p) {
  try {
    return JSON.parse(readFileSync(markerFile(p), "utf8")).fired || {};
  } catch {
    return {};
  }
}

// ponytail: a verdict is whatever tm can see — the ao management record's review for a governed
// task, a `review` field, review evidence, or a comment that states a verdict. A structured
// `tm review <id> --verdict` verb is the upgrade if this heuristic misfires.
const VERDICT_TEXT = /\b(review|verdict|reviewed)\b[^\n]{0,80}\b(approve[sd]?|lgtm|changes requested|request changes|rejected?|pass(ed)?)\b/i;

/**
 * Where a finished task's review stands, from tm's own records alone (TM-244): works with
 * agent-orchestration absent, because the management record is only a file it may have left.
 *   completed    a verdict tm can see (for a governed task: on the finish revision)
 *   outstanding  a governed review request filed for the finish revision, not refused
 *   missing      neither; `reason` names why — no admission record, review_blocked, never requested
 */
export function reviewState(task, p) {
  let record = null;
  if (task.governance) {
    try {
      record = readManagementRecord(task, p).record;
    } catch {
      /* unreadable or absent: judged on what the task itself carries */
    }
  }
  const revision = record?.finish?.revision ?? null;
  const v = record?.review;
  if (v?.verdict && (!v.revision || !revision || v.revision === revision)) return { state: "completed" };
  if (task.review?.verdict) return { state: "completed" };
  if ((task.evidence || []).some((e) => /review/i.test(String(e?.path ?? e)))) return { state: "completed" };
  if ((task.comments || []).some((c) => VERDICT_TEXT.test(String(c?.text ?? "")))) return { state: "completed" };
  if (!record) return { state: "missing", reason: "no admission record" };
  if (record.review_blocked) return { state: "missing", reason: `review_blocked: ${String(record.review_blocked).split("\n")[0].slice(0, 200)}` };
  if (record.review_request && (!revision || record.review_request.revision === revision)) return { state: "outstanding" };
  return { state: "missing", reason: "never requested" };
}

/**
 * Finished tasks with commits and no verdict — the one detector `tm review-sweep` and `tm doctor`
 * share (TM-244, rule 3): `{ found: [{ task, inReview, state, reason }], tasks, candidates }`.
 */
export function unreviewedTasks(p, { sinceDays = 7, now = Date.now() } = {}) {
  const tasks = list("task", {}, p);
  const since = now - sinceDays * 86_400_000;
  const found = [];
  let candidates = 0;
  for (const t of tasks) {
    const inReview = t.governance?.state === "ready-for-review" && t.status !== "done";
    const recentlyDone = t.status === "done" && t.closed && new Date(t.closed).getTime() >= since;
    if (!(inReview || recentlyDone) || !(t.commits || []).length) continue;
    candidates += 1;
    const r = reviewState(t, p);
    if (r.state !== "completed") found.push({ task: t, inReview, ...r });
  }
  return { found, tasks, candidates };
}

/** Open PRs via gh: `{ prs }` or `{ skipped }`. */
export function ghOpenPrs(root, { spawnImpl = spawnSync, env = process.env } = {}) {
  let res;
  try {
    res = spawnImpl("gh", ["pr", "list", "--state", "open", "--limit", "100", "--json", "number,title,url,headRefName,updatedAt,isDraft"], { cwd: root, shell: false, encoding: "utf8", env, timeout: 20_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    return { skipped: `gh failed to start: ${err.message}` };
  }
  if (res.error) return { skipped: res.error.code === "ENOENT" ? "gh is not installed" : `gh failed to start: ${res.error.message}` };
  if (res.status !== 0) return { skipped: `gh pr list exited ${res.status}: ${String(res.stderr || "").trim().split("\n")[0]}` };
  try {
    return { prs: JSON.parse(res.stdout) };
  } catch {
    return { skipped: "gh pr list returned unreadable JSON" };
  }
}

export function reviewSweep({ p, apply = false, sinceDays = 7, idleHours = 24, now = Date.now(), prs = null } = {}) {
  const { found, tasks, candidates } = unreviewedTasks(p, { sinceDays, now });
  const findings = [];
  for (const { task: t, inReview, state, reason } of found) {
    findings.push({
      key: `no-review:${t.id}`,
      kind: "no-review",
      id: t.id,
      title: t.title,
      status: inReview ? "ready-for-review" : "done",
      governed: Boolean(t.governance),
      review: state,
      ...(reason ? { reason } : {}),
      pr: (t.commits || []).find((c) => /\/pull\/\d+/.test(c)) ?? null,
      detail: `${t.id} is ${inReview ? "ready for review" : "done"} with commits and no reviewer verdict`,
    });
  }
  const pr = prs ?? ghOpenPrs(p.root);
  const open = pr.prs || [];
  for (const r of open) {
    if (r.isDraft || !r.updatedAt) continue;
    const idle = (now - new Date(r.updatedAt).getTime()) / 3_600_000;
    if (!(idle > idleHours)) continue;
    findings.push({
      key: `idle-pr:${r.number}:${r.updatedAt}`,
      kind: "idle-pr",
      id: (`${r.title} ${r.headRefName}`.match(TM_ID)?.[0] || "").toUpperCase() || null,
      pr: r.url ?? `#${r.number}`,
      number: r.number,
      idleHours: Math.floor(idle),
      detail: `PR #${r.number} "${r.title}" has had no activity for ${Math.floor(idle)}h`,
    });
  }

  const fired = readMarkers(p);
  for (const f of findings) {
    f.notified = Boolean(fired[f.key]);
    f.fresh = !f.notified;
  }
  if (apply) {
    const at = new Date(now).toISOString();
    for (const f of findings.filter((x) => x.fresh)) {
      fired[f.key] = at;
      if (f.id && tasks.some((t) => t.id === f.id)) {
        try {
          addComment(f.id, `review-sweep: ${f.detail} — needs an independent review or a decision.`, { author: "review-sweep", p });
        } catch {
          /* the marker is the record; a comment that fails must not refire the finding */
        }
      }
    }
    if (existsSync(p.base)) writeFileSync(markerFile(p), `${JSON.stringify({ fired }, null, 2)}\n`);
  }
  return {
    findings,
    fresh: findings.filter((f) => f.fresh).map((f) => f.key),
    applied: apply,
    coverage: {
      tasks: tasks.length,
      candidates,
      sinceDays,
      prs: pr.prs ? open.length : null,
      prSource: pr.prs ? "gh" : `skipped: ${pr.skipped}`,
      idleHours,
    },
  };
}
