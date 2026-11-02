---
id: "ADR-0040"
kind: "adr"
status: "proposed"
created: "2026-10-05T10:51:09.410Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Deliverable: use Plan + new epic and tasks on the board (Recommended)"
epic: "EP-026"
decisionKey: "43581a428a0a"
date: "2026-10-05"
updated: "2026-10-05T10:51:09.418Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-10-05.
The question asked was: What should the output of this planning be?

## Decision

**Which pain hurts most day to day? (pick all that apply)** → chose **Messages lost or stuck, Finished work goes unnoticed, Cross-repo handoffs, Too many verbs and skills**.

Rejected:
- **Messages lost or stuck** — Sends that never land, leads that look unresponsive, acks that time out, falling back to tmux send-keys.
- **Finished work goes unnoticed** — Workers finish or die and nobody collects, reviews or replaces them (TM-244, TM-246, TM-247).
- **Cross-repo handoffs** — An agent in one repo (e.g. remote-gateway) needs work done in another (marketplace, agent-browser) and has no clean way to ask or track it.
- **Too many verbs and skills** — Hard to know which skill/CLI verb to use: dispatch vs agent-orchestrate vs launch vs roadmap-orchestrator, tm route vs orchestration_route.

**How should cross-repo work be queued?** → chose **1 then 2 to let the lead know it was added and to check te priority to know how qickly it needs to be assigned.. high and criticalneed to have new workers spawned imediately to fix the task in a worktree and pblished as qickly as possible and notify te original repo lead / sender**.

Rejected:
- **Ticket in target repo's board (Recommended)** — A lead in repo A files a task on repo B's tm board with a back-link; repo B's pool/lead picks it up and replies when done. Keeps each repo's board the source of truth.
- **Direct message to target lead** — Repo A messages repo B's lead by repo slug (TM-271); the lead decides whether to file a task. Lighter, but less tracked.
- **One shared multi-repo board** — A machine-level queue across all registered repos. Most visible, but breaks the per-repo board model.

**How much autonomy should the queue have?** → chose **Completely autonomously through publishing**.

Rejected:
- **Auto-dispatch, human merges (Recommended)** — Pool dispatches ready tasks automatically (dispatch.enabled on), workers stop at a PR, a reviewer agent reviews, you merge. Matches current rules.
- **Auto through governed landing** — Also let the lead land approved PRs under ADR-0027 landing authority, still asking for deploy/tag/publish.
- **Manual dispatch only** — Keep the pool off; you or a lead dispatch explicitly each time.

**What should the output of this planning be?** → chose **Plan + new epic and tasks on the board (Recommended)**.

Rejected:
- **Plan, then implement top items** — Write the plan and start building the highest-value items in this session.
- **Plan document only** — Just the written plan for you to review; no board changes.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._