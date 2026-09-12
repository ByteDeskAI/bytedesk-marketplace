---
id: "EP-021"
kind: "epic"
status: "open"
created: "2026-09-11T19:41:54.050Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Agent-first automation: computed readiness, always-on pool"
actor: "main"
session: "c3738e82-1fbf-4fc3-a6a3-06f965eac51c"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T19:41:54.058Z"
plan: ".bytedesk/task-management/plans/2026-09-11-plan-automatic-readiness-and-an-always-on-dispat.md"
adr: "ADR-0012"
---

Make the task-management dispatch pool safe to leave running, compute ready-for-agent from one shared readiness check (human veto via ready-for-human is sticky), run the pool on by default with live config and standby takeover, guard unattended workers against repo-destructive and external actions, and end worker runs with a pushed branch plus PR. Plan: .bytedesk/task-management/plans/2026-09-11-plan-automatic-readiness-and-an-always-on-dispat.md. Decisions confirmed by Ryan 2026-09-11: auto-label with human veto; pool on by default; skip-permissions plus guard hook; PR as finish line, human merges.