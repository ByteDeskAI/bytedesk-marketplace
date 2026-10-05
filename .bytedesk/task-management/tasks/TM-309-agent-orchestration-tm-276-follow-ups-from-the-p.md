---
id: "TM-309"
kind: "task"
status: "open"
created: "2026-10-03T02:08:35.819Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: TM-276 follow-ups from the parallel review — outage mail never delivered, credentials leak, recovery overclaims"
epic: "EP-019"
acceptance: [{"text":"an outage and a recovery each reach the lead's real inbox exactly once (status delivered), proven by a test that reads the inbox, and live on this machine","done":false},{"text":"no credential from any NATS URL form (single, list, malformed) appears in transport.json, logs, doctor, services status or lead mail (tests)","done":false},{"text":"recovery is recorded only after JetStream init succeeds and only when no fallback holder remains; a failed state write is surfaced (tests)","done":false},{"text":"B2/B3/C5/C6 and the three run-note defects fixed or split into their own tasks","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T03:09:47.306Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-03T03:09:47.301Z","text":"C1 (delivered outage notices, from ao-supervisor, held != sent, inbox-reading test) and A1 (redactUrl fails closed) shipped in #171 (0.15.3). Remaining: C2–C6, B2, B3, run notes; slot-grant sender split to TM-314."}]
---

Parallel review run 20261002-212844-e4bx (claude:opus, codex, grok; report: ~/.local/state/bytedesk/agent-orchestration/repositories/8890762dbb279261/topology/runs/20261002-212844-e4bx/artifacts/REPORT.md) of PR #154 against ADR-0031, all three 'request changes'. Confirmed live 2026-10-02: all 8 'NATS outage' standing messages to leads are status=held reason=source_identity_required, never delivered. In order: C1 nats-outage.mjs deliver() passes no from/fromProject → permanent hold, and 'sent' checks record existence not status=delivered (give the supervisor an admitted sender identity or a system-notification path; held != sent; test reads the lead's real inbox). A1 redactUrl fails open on comma-separated server lists and malformed URLs, leaking user:secret into transport.json, logs, doctor and lead mail (split on ',', redact each, never return raw on parse failure). C3 recovery persisted before jetstreamManager() succeeds. C4 a failed transport.json write is swallowed. C2 recovery declared when only the supervisor moved back (track fallback holders per pid). Then B2 unlocked transport.json read-modify-write, B3 text 'services status' omits transport, C5 start log reads the shared file, C6 every TCP-reachable re-dial force-closes the presence connection. Run notes: inbox files not materialized for NATS-only messages (file-only reviewers can't receive), wait counts a file reply as pending, prompt ack refused from a child shell. D1 (does AO_NATS_URL fall back?) is settled by ADR-0032's source order.