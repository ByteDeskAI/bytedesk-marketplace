---
id: "ADR-0006"
kind: "adr"
status: "proposed"
created: "2026-09-07T02:32:29.718Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Case file: use A sibling client repo (Recommended)"
epic: "EP-017"
decisionKey: "b6c5b197736f"
date: "2026-09-07"
updated: "2026-09-07T02:32:29.726Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-07.
The question asked was: Where should the client case file live — the durable folder that holds the brief, every stage's output, and the approval record?

## Decision

**Where should the client case file live — the durable folder that holds the brief, every stage's output, and the approval record?** → chose **A sibling client repo (Recommended)**.

Rejected:
- **Inside this marketplace repo** — e.g. .bytedesk/rebrand/viking-surface-care/. Nothing new to set up and it's committed alongside the workflow, but it mixes client deliverables into a plugin distribution repo that gets cloned by consumers.
- **A local non-git directory** — e.g. ~/clients/viking-surface-care/. Simplest, but the approval record and stage outputs aren't versioned, so there's no history of what was approved when.

**How does a stage get approved so the next one may start?** → chose **CLI, digest-bound (Recommended)**.

Rejected:
- **CLI, simple** — `rebrand approve discovery` just flips a flag with a timestamp. Less machinery; an approval can silently come to describe a file that has since changed.
- **A task on the tm board** — One TM task per stage; `tm done` is the approval. Visible on the dashboard alongside everything else, but couples the workflow to task-management and the board's gates.

**Stage 6 asks for website mockups of 4–6 pages. What should land on disk?** → chose **PNG renderings only**.

Rejected:
- **Real HTML pages (Recommended)** — Self-contained responsive HTML per page, using stage 4's tokens. Openable in a browser, screenshotable for the client, and directly portable to their Next.js site. Screenshots come free via the browser tool.
- **Both — HTML then screenshot it** — Author the HTML, then capture a PNG of each page. Most deliverable per stage, and the PNG is guaranteed to match the HTML because it is a render of it. Costs a screenshot pass per page.

**For Viking specifically, once the workflow exists — how far should I take it tonight?** → chose **Build the workflow only**.

Rejected:
- **Build it, then run stage 1 only** — Ship the workflow, launch discovery against Viking with the research I've already done seeded in, and stop at the gate for your review.
- **Build it and run through stage 3** — Discovery, identity, and direction — so you wake up to actual concept sketches to react to. Three gates auto-passed on my judgement, which is more autonomy than the design intends.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._