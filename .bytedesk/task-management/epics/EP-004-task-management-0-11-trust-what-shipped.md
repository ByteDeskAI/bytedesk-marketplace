---
id: "EP-004"
kind: "epic"
status: "open"
created: "2026-07-31T05:23:19.437Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management 0.11 — trust what shipped"
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T05:23:29.483Z"
---

## Why this epic
EP-003 shipped a lot in a short run: board columns, a work stream, board scoping, three harnesses,
motion, and two concurrency fixes. Most of it was verified properly. Some of it was verified on the
day and has no test holding it, and a few things were noticed in passing and never written down.

This round is not new surface. It is making the last round trustworthy: closing the gaps found
while building it, and turning "I checked that once" into "the suite checks that".

## What belongs here
- gaps the work itself exposed and left open
- claims in the README or CHANGELOG that no test defends
- the scope question TM-041 raised and did not answer

## What does not
New features. If it would need its own epic to explain, it needs its own epic.
