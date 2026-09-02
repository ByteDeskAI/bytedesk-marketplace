---
id: "TM-081"
kind: "task"
status: "done"
created: "2026-09-02T15:33:11.410Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Make task-management Pi-compatible and universally installable by any harness"
epic: "EP-012"
acceptance: [{"text":"Pi surfaces measured and fixtures captured (or a documented note that pi is not installable/has no such surface — measured, not assumed)","done":true,"at":"2026-09-02T16:21:29.909Z"},{"text":"Pi works end-to-end where its surfaces allow: session identity, task mirroring, hooks, work stream — each either wired + tested or documented as absent","done":true,"at":"2026-09-02T16:21:30.047Z"},{"text":"tm caps reports the pi CLI; README harness matrix gains a Pi column","done":true,"at":"2026-09-02T16:21:30.153Z"},{"text":"docs/harnesses.md (or equivalent) documents the universal install recipe + the 4-point adapter contract for harnesses with no adapter","done":true,"at":"2026-09-02T16:21:30.257Z"},{"text":"full suite green (node --test + all bash contract suites) and claude plugin validate passes","done":true,"at":"2026-09-02T16:21:30.358Z"}]
evidence: [".bytedesk/task-management/evidence/TM-081-tm-081-082-suite.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T16:21:31.203Z"
labels: ["ready-for-agent"]
closed: "2026-09-02T16:21:31.198Z"
---

Two halves, one goal: the plugin works out of the box for the Pi coding agent AND for any harness nobody has written an adapter for yet.

HALF 1 — Pi adapter (mirror the TM-071 Kimi pattern, which is the most recent precedent):
- Research Pi's surfaces first — MEASURE, don't assume (the Kimi adapter's discipline): does the installed `pi` CLI (or its docs) expose hooks (PreToolUse/PostToolUse/Stop equivalents and their payload shape), a session identity (env var or payload field), a native task/todo tool to mirror, and a transcript location for the dashboard work stream? Capture verbatim fixtures under tests/fixtures/ like codex-pre-tool-use.json / kimi-todolist-payload.json.
- lib/harness/pi.mjs adapter as needed: nativeId strategy (content-hash if Pi todos carry no ids — the kimi-todo:<sha1> precedent), status mapping, wouldCreate gating.
- Session identity: add Pi's env var to SESSION_ENV or wire payload-adoption (the Codex/Kimi path) — whichever Pi actually does.
- Hooks: a hooks/pi-hooks.example.<ext> in Pi's own config format, mirroring kimi-hooks.example.toml.
- hostcaps: add the pi CLI to the harness-CLI probe list so `tm caps` reports it.
- Work stream: transcript resolution in lib/harness/sessions.mjs if Pi writes one; raw fallback is acceptable (same stance as kimi-wire).

HALF 2 — universal install path ("any other harness"):
- A documented generic recipe for a harness with NO adapter: what works today with zero integration (CLI, store, MCP via the standard mcpServers JSON shape, gates) vs what each integration point adds (hooks → briefings/gates/mirroring; session env → claims/attribution; transcript → work stream). This becomes the "porting to a new harness" checklist, probably docs/harnesses.md, linked from the README harness matrix.
- `tm init` (or a new flag/verb if that's cleaner) emits a harness-agnostic starter: the project launchers + a template hooks file the user adapts, instead of today's per-harness examples only.
- Define the minimal adapter contract in lib/harness/README.md: the four integration points, which are optional, and exactly what to measure on a new harness (the TM-071 measuring discipline written down as a procedure).

Constraints: follow the existing adapter pattern (lib/harness/{claude,codex,grok,kimi}.mjs); no new dependencies; every claim about Pi's behavior backed by a captured fixture or a measured note; unit tests per adapter plus contract tests where a hooks example is added; README harness matrix gains a Pi column; CHANGELOG entry.