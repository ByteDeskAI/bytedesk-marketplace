---
id: "ADR-0022"
kind: "adr"
status: "accepted"
created: "2026-09-25T20:27:13.179Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Leads drive approved plans through merge, cutover, release and cleanup under a checkable plan grant"
epic: "EP-021"
deciders: ["Ryan Helms"]
date: "2026-09-25"
updated: "2026-09-25T20:27:13.187Z"
---

## Context

Ryan's operating model, 2026-09-25: "All I should be involved in is the planning and approving
plans. team leads should drive the completion and approvals after planning until it is released
and cleaned up." Today ADR-0001 (fleet/docs/adr/0001-hierarchical-authorization.md) classes merge
as PR-level, branch deletion as repo-destructive and production deploy as external, the last two
always needing a human; the task-management rules say "humans merge". So every landing, cutover,
release and cleanup waits on Ryan, and Claude Code's auto-mode classifier refuses a lead that
self-asserts `--authorized`.

## Decision

Approved by Ryan directly in the marketplace lead's session on 2026-09-25 ("Approve all"), after
the gateway lead relayed the plan.

Once Ryan approves a plan, the repository lead drives it to release and cleanup. Authority comes
from a checkable plan grant (TM-234, extended by TM-248): scoped to an epic or task list, a repo,
a lead and an expiry, verified by every lead verb. Each lead action is one `ao-topology` verb that
enforces its own guardrails and refuses otherwise:

- `manage integrate` merges the PR itself (TM-249): task in plan, correct base, head equals the
  reviewed and approved SHA, CI green, review approved.
- `manage cutover` and `manage release` wrap deploy-safe and /release (TM-250).
- `manage cleanup` removes merged worktrees and branches, never develop, main or release/* (TM-251).

Leads never run raw `gh pr merge`, `systemctl`, `git push --delete` or deploy commands, and never
self-assert `--authorized` or `--actor` (TM-248). Workers are refused every lead verb.

This supersedes ADR-0001's rows for merge, branch deletion, deploy and release **only when a valid
plan grant covers the action**. Without a grant, ADR-0001 applies unchanged. Force push, history
rewrite, branch-protection edits, secrets and spending stay human-only in all cases.

## Consequences

- Ryan approves plans; leads land, deploy, release and clean up without per-action prompts, once
  TM-243 installs the allow rules and TM-248..TM-251 ship.
- A same-uid agent cannot be fully excluded from granting (TM-234 records the grant channel as
  `interactive-same-user`, `agent_proof: false`). Server-side gates (GitHub branch protection,
  TeamCity) remain the enforcement of last resort.
- Until these verbs ship, merges still need a human.
- Proven end to end by TM-253.
