---
id: "ADR-0013"
kind: "adr"
status: "proposed"
created: "2026-09-11T21:31:52.897Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Lead agents: use Ship as designed (Recommended)"
epic: "EP-021"
decisionKey: "baba9f068457"
date: "2026-09-11"
updated: "2026-09-11T21:31:52.906Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-11.
The question asked was: Shipping TM-167 makes each enrolled repository's supervisor start a real Claude lead agent (default template: the claude CLI with prompts/lead.md) and keep it alive. On this machine three repositories are enrolled through their project plugin settings: bytedesk-remote-gateway, design-system and paperclip. Because this marketplace is a live local directory, merging to main takes effect as their supervisors restart, even before the push. How should I ship?

## Decision

**Shipping TM-167 makes each enrolled repository's supervisor start a real Claude lead agent (default template: the claude CLI with prompts/lead.md) and keep it alive. On this machine three repositories are enrolled through their project plugin settings: bytedesk-remote-gateway, design-system and paperclip. Because this marketplace is a live local directory, merging to main takes effect as their supervisors restart, even before the push. How should I ship?** → chose **Ship as designed (Recommended)**.

Rejected:
- **Ship, disable two repos first** — Before merging, write {"enabled": false} into design-system and paperclip's .bytedesk/agent-orchestration/config.json, so only the gateway gets a lead. Those are uncommitted files in repos other sessions use.
- **Hold the merge** — Keep everything on the tested integration branch and don't merge or push until you say so.

**TM-168's last criterion needs a linked task sent to the gateway repository's lead, then browser acceptance once the gateway renders the icons. Cross-repository mail needs a responsive lead on BOTH sides, and this marketplace repo is not enrolled. How should the request reach the gateway?** → chose **Enroll this repo and mail it (Recommended)**.

Rejected:
- **Add a task to the gateway's board** — Create a linked task in bytedesk-remote-gateway's own task store pointing at the request document, without enrolling this repo. Writes to another repo's board, where another session is active.
- **Leave the handoff to me** — Push the marketplace side, mark TM-168 blocked on the gateway, and don't contact the gateway repository.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._