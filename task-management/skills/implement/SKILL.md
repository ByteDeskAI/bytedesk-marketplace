---
name: implement
description: Build one implementation ticket — claim, verify, attach evidence, then submit governed work for review or close ungoverned work. Use when a ready-for-agent task is startable, or the user says /implement.
user-invokable: true
argument-hint: "[TM-id]"
---

# Implement

For **implementation** tickets only (`ready-for-agent`, no `decision:*`).

1. `tm_show` / `tm_handoff`. `tm_claim` (or start) before edits.
2. Agree seams. Red → green one slice at a time. AC is the spec; a failing-then-passing test is `tm_evidence`.
3. Tick each criterion only when verified (`tm_ac_accept`).
4. For governed tasks, independent review of the exact committed revision is mandatory and
   belongs to the repository lead's reviewer. For ungoverned work, an additional review can be
   attached as evidence.
5. Commit, `git push -u origin <the task's tm/ branch>`, then
   `gh pr create --title "<TM-id>: <title>" --body "<what changed, and how you verified it>"`.
   **Never merge it yourself.** If the push or the PR fails (no remote, no `gh`, auth),
   `tm block <id> "<the error>"` instead of closing.
6. If the task has `governance`, save the handoff's finish JSON outside the task worktree and run
   `ao-topology manage report --consumer <repository> --task <id> --file <finish-report.json>`.
   The producer records the finish, calls `tm review-ready`, and queues independent review.
   Report any `review_blocked` reason to its lead. Stop here;
   keep the claim while independent review and a separate integration decision are pending.
   For an ungoverned task, `tm_task_update` done closes verified work.

Do not implement `decision:*` tickets — those are `/interview`, `/research`, `/prototype`.

A `ready-for-agent` card this session should **not** implement: [[dispatch]] (one
shot) or [[pool]] (loop). After the worker exits: [[collect]], then [[events]].
Probe the host with [[caps]] first.
