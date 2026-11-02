---
id: "ADR-0041"
kind: "adr"
status: "proposed"
created: "2026-10-05T10:59:21.655Z"
board: "bytedeskai/bytedesk-marketplace"
title: "A consumer lead may file into an upstream task store; the upstream lead decides (TM-350)"
epic: "EP-028"
deciders: []
date: "2026-10-05"
updated: "2026-10-05T10:59:21.662Z"
---

## Context

TM-350 (Ryan, 2026-10-05) asks for cross-repo lead collaboration with no human relay. Today cross-repo authority is lead-of-own-repo only (requireLeadCaller, management.mjs:493/747), tm cannot hold a foreign blocker safely (dependenciesMet treats a missing blocker as resolved, store.mjs:1379), and held mail (leads_not_ready, unknown_recipient) has no fallback.

## Decision

1. Who may file: only a process proven to be the CONSUMER repository's lead (requireLeadCaller in the consumer). Workers and non-lead agents are refused. The upstream must have a task store and be enrolled or have a registered lead. Intake is open to any enrolled repo on the machine; an allowlist in upstream config.json may be added later if filings get noisy. All repos run as the same Unix user, so this is an attribution and control rule, not a security boundary.
2. What it may set: title, body, acceptance criteria, requested priority (capped at high), and the foreign back-link to the consumer task. It may not set status, epic, assignee, claim, labels other than the intake veto, dispatch, or touch existing upstream tasks. Create-only, through upstream's own `tm task new`, so upstream's gates apply. Idempotency key = hash(consumer board, consumer task, title).
3. Attribution: filedBy {board, agent, task}; TM_ACTOR=<consumer-board>/<lead-id>.
4. Upstream stays in control: a filed task carries the readiness veto label decision:intake, so the pool never dispatches it until the upstream lead or a human removes it. The upstream lead is notified by standing mail addressed to the lead.
5. Closure is read, never written: the consumer learns of closure by reading upstream state (done + landing SHA). Upstream never writes into the consumer store; the consumer never writes upstream after filing. Foreign blockers live in foreignBlockers[], never blockedBy, and an unresolved or unreadable foreign blocker is unmet.
6. Delivery: held leads_not_ready mail to a live lead falls back to a tmux pane ring after one recovery backoff (Node cannot use Claude cross-session messages). task:<TM-id> addresses the bound worker of that task; cross-repo senders still need a lead-issued delegation, otherwise mail goes to the lead as today.
7. Stays human: credential sharing, settings and permission edits, unrestricted spawns, and session reloads for hooks/skills/MCP. Automation reports these as human_required:<kind>; it never works around them.

## Consequences

consumers on an older marketplace checkout cannot be filed into until they update; upstream file refuses with a named error when the upstream tm lacks --filed-by. Defaults in 1 and 6 are the lead's choice under Ryan's 2026-10-04 autonomy and are open for Ryan to overrule.

