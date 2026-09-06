---
id: "ADR-0005"
kind: "adr"
status: "proposed"
created: "2026-09-06T22:49:57.938Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Nesting model: use Child as a participant (Recommended)"
epic: "EP-016"
decisionKey: "5639e5b9dd86"
date: "2026-09-06"
updated: "2026-09-06T22:49:57.945Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-06.
The question asked was: How should a parent workflow address a child workflow?

## Decision

**How should a parent workflow address a child workflow?** → chose **Child as a participant (Recommended)**.

Rejected:
- **Child as an executed stage** — A stage in the stage-list launches a child and blocks until it finishes. Matches the existing stage vocabulary — but today stages are advisory MARKDOWN for the conductor, not executed. This makes the runtime a scheduler, which is a much larger change.
- **Bookkeeping only** — Keep it as it works today — the conductor shells out to `ao-topology launch`. Add only parent_run linkage, a run.spawned journal event, stop cascade and a depth cap. Smallest change, honest, but not really first-class.

**A spec already has a top-level `workflow:` field for its stage list. If "template" becomes "workflow", that name is taken. How should the collision resolve?** → chose **Rename stages to `stages:` (Recommended)**.

Rejected:
- **Keep `workflow:` for stages** — Call the top-level noun something else — 'orchestration' or 'crew' — and leave the stage field alone. No deprecation needed, but you do not get the word you asked for.
- **Both named workflow** — Top-level concept and the stage field share the name, disambiguated by position. No migration, but genuinely confusing to read and to document.

**How aggressive should the templates → workflows rename be?** → chose **Full rename, legacy fallback (Recommended)**.

Rejected:
- **Rename the surface only** — CLI flags, help text and docs say workflow; the on-disk directory stays templates/. Zero migration risk, but the word and the directory disagree — which is its own confusion.
- **Defer the rename** — Ship nesting and fan-out first against the current names; do the rename as a separate change once the new fields have settled.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._