---
id: "TM-192"
kind: "task"
status: "open"
created: "2026-09-12T03:15:28.244Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: session-open control seam, run lineage and launcher binding (gateway EP-023 phase 2a)"
epic: "EP-019"
acceptance: [{"text":"session-open returns a capability URL for a run without opening a browser (--run-id, --no-browser, --json)","done":false},{"text":"Attested session decisions record an actor label, and the decision stays with the session","done":false},{"text":"Worker and lead runs carry a parent/conductor link in the run snapshot","done":false},{"text":"Runs record the launcher binding (tmux tab or pane) so a consumer can jump to the exact terminal","done":false},{"text":"Unit tests pass, released to main, plugin-rsync run","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "58d7cd20-54ac-45c8-84a6-ea82dbebfad2"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-12T03:15:36.636Z"
---

Raised by the bytedesk-remote-gateway repository lead. This is the marketplace half of
gateway EP-023 phase 2a, which was tracked only in the gateway's task store as gateway
TM-304 even though every line of the work lives in this repository.

## Why it moved here

Gateway TM-304's acceptance is entirely agent-orchestration surface: the `session-open`
verb, actor labels on attested session decisions, run lineage, and the launcher binding.
Verified: the seam lives in `agent-orchestration/topology/cli.mjs` and
`topology/lib/startup.mjs`; the only match in the gateway tree is an unrelated SSE test
(`src/kernel_events_sse_test.go`).

The gateway's managed pipeline asserts that a task's worktree is inside the gateway repo,
so gateway TM-304 could not be admitted there — it would provision a gateway worktree for
work that happens in this repo.

## Blocking relationship (live)

Gateway TM-305 ("Phase 2b: gateway run controls and exact terminal jump") is now formally
`blocked-by` gateway TM-304, and its admit is held by the dependency gate:

    error TOPOLOGY_MANAGEMENT_DEPENDENCY: Dependency TM-304 is not complete.

TM-305 adds `POST /orchestration/api/projects/{pid}/runs/{runId}/{cancel,cleanup,follow-up,decision}`
and consumes the capability exchange and the launcher binding produced here. Until this
lands, that gateway work cannot start.

## What already exists (checked, not assumed)

- Capability minting is present: `src/session/capability.mjs` exports `mintCapability` and
  a URL builder, used by `src/service.mjs`.
- A `session open <id|"Full Name">` CLI verb exists, but it is addressed by AGENT id and
  opens/reattaches a durable session. It has no run-id addressing and no
  `--no-browser` / `--json` flags.
- No `--no-browser`, `--run-id` or capability-URL-returning flag exists anywhere in
  `topology/` or `src/`.

I did not audit how decisions currently record actors, nor whether any parent/conductor
link exists in the run snapshot — the implementer should confirm both before designing.

## Source

Plan: `/home/ryan/.claude/plans/serialized-leaping-spring.md`, section 2a.
Original wording: session-open `--run-id --no-browser --json`, actor label on attested
session decisions, conductor/parent lineage for worker and lead runs, and the launcher tab
or pane recorded.
