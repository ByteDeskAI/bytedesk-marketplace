---
type: Decision
title: The tmux topology layer is the authoritative orchestration layer
description: agent-orchestration ships two unrelated runtimes; topology wins for dispatched work and the agent hierarchy, the MCP broker is kept as an opt-in sandboxed backend, and tm owns the worktree
tags:
  - agent-orchestration
  - architecture
  - task-management
  - tmux
status: stable
---

# The tmux topology layer is the authoritative orchestration layer

Decided 2026-09-05 (EP-014 / TM-088). The full reasoning, with file:line evidence, is
`agent-orchestration/docs/adr/0001-authoritative-orchestration-layer.md` in this repo. This note
exists so the decision is findable from `km find` without reading the plugin.

## The situation it settles

`agent-orchestration` shipped **two unrelated orchestrators** under one plugin name, with zero code
coupling in either direction:

- the **MCP broker** (`src/`) — headless, isolated, auditable: systemd transient scopes, bubblewrap
  with its own network namespace, a hash-chained `events.ndjson`, a detached git worktree per run
  with tamper checks, and checkout-scoped run authority.
- the **tmux topology layer** (`topology/`) — a visible, interactive team of agent CLIs in panes
  with a file mailbox as the channel of record. No sandbox, no cgroup, no worktree, no audit chain.

Run ids differ (`run_<uuid>` vs `YYYYMMDD-HHMMSS-<4>`) and the broker's store filters on its own
regex, so a topology run is invisible to all fourteen `orchestration_*` MCP tools by construction.
Retiring the `fleet` plugin forced the choice: fleet was the only `tm dispatch` backend that gave
worktree isolation, a visible tmux session, transcript observation and depth-based authorization
together.

## The decision

**Topology is authoritative** for dispatched work and for the agent hierarchy. The broker is kept
unchanged as an **opt-in backend for untrusted autonomous writes**, selected explicitly, not the
default.

Three reasons: the hierarchy already lives in topology (identity, the agent library, the one-lead
invariant, routing, delegation, outbox authentication); a dispatched worker must be watchable, which
is the property fleet supplied; and topology *takes* a working directory while the broker
*manufactures* one.

**What is lost is real and was accepted knowingly**: the sandbox and its network namespace, cgroup
accounting, the hash-chained event log, proof-of-cancellation, concurrency limits, the tamper-proof
worktree ownership protocol, and fleet's JSONL transcript observation, which is not replaced.
Topology's safety boundary is the agent CLI's own permission prompts, plus repo containment and an
auto-approve consent gate — weaker, honestly described, not equivalent.

## Worktree ownership

**`tm` provisions; the backend reuses. The store gets the last word.** The topology backend launches
with `--consumer <tm worktree>` and creates no checkout of its own — one worktree per task, the
duplication resolved. The broker derives its own detached worktree unconditionally (an invariant of
that runtime, not a setting), so for that backend the duplication is *explicitly accepted*, with tm's
worktree as the consumer root of record and the broker's as scratch.

## The four `tm dispatch` backends

`orchestration` kept but demoted · `fleet` removed · `tmux` converted to `topology` · `manual`
unchanged as the floor that must always be reachable. Order during migration:
`["topology", "tmux", "orchestration", "manual"]`.

## Two live defects this uncovered

Both in the existing orchestration backend, found while writing the ADR against the code:

1. **Collect cannot see the run it dispatched.** Dispatch spawns with `consumerCwd = <tm worktree>`
   so the run records that worktree's `repositoryKey`; collect asks with the repo root, a different
   hash, and `getRun` refuses with `AO_RUN_REPOSITORY_MISMATCH`. The round trip is broken as written.
2. **`write` dispatches require a clean consumer.** The backend always sends
   `permissionProfile: "write"`, which resolves the consumer with `requireClean = true`; tm's own
   `applyShares` links `node_modules` and `.env` into the worktree and a prior tmux dispatch leaves
   `.tm-dispatch-prompt.md`, so the dispatch fails with `AO_CONSUMER_DIRTY` unless `ensureIgnored`
   got there first.

## Related

- [Gateway tab ids are server-minted](/architecture/gateway-tab-ids-are-server-minted.md) — how a topology session becomes visible in the gateway, and what survives a restart.
- Authorization classes salvaged from fleet: `agent-orchestration/docs/authorization-classes.md`.
  Note the consequence recorded there: `CLAUDE_SESSION_DEPTH` had exactly one authoritative writer
  and it retires with fleet, so topology inherits that obligation. A gate reading a depth nobody
  authoritatively writes grants authority by accident.
