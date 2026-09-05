# ADR-0001: The authoritative orchestration layer, and who owns the worktree

## Status

Accepted — 2026-09-05. Supersedes nothing; settles TM-088 and unblocks TM-096, TM-098, TM-099.

## Context

`agent-orchestration` ships two runtimes that share a plugin, a name and almost nothing else.

**The MCP broker** (`src/`) is a headless, isolated, auditable run engine. A run is launched into a
systemd transient scope (`src/platform/linux-runtime.mjs:97`, `--user --scope --collect --quiet
--unit=…`), the provider executes inside bubblewrap with its own network namespace
(`src/provider-sandbox.mjs:247` requires `/usr/bin/bwrap` plus `slirp4netns`/`pasta`;
`:258` `--unshare-all --die-with-parent --new-session`), and every state transition is appended to a
hash-chained `events.ndjson` whose chain is verified on read (`src/state/store.mjs:49`, `:344`).
Each run gets its own detached git worktree, derived by the broker and defended on both ends:
created with `git worktree add --detach` under a consumer-derived root
(`src/workspace/worktrees.mjs:52-59`), and removable only after the `.git` marker hash, HEAD SHA,
git admin dir and porcelain registration all still match the record it wrote at creation
(`:132-152`, `AO_GIT_METADATA_CHANGED`, `AO_FOREIGN_WORKTREE`, `AO_UNSAFE_WORKTREE_REMOVAL`).
Authority is checkout-scoped: `repositoryKey = sha256(commonGitDir\0checkoutRoot)`
(`src/workspace/repository.mjs:56`), and every read of a run re-derives it and refuses a mismatch
(`src/service.mjs:378`). Fourteen `orchestration_*` MCP tools are the entire public surface
(`src/mcp.mjs:235-248`).

**The topology layer** (`topology/`) is a visible, interactive team of agent CLIs in tmux panes,
with a file mailbox as the channel of record. It has no sandbox, no cgroup, no worktree and no
audit chain. (The task this ADR settles said it had "no isolation of any kind"; that was already an
overstatement when this was written — see the containment, consent and outbox-authentication
guards below. No sandbox is the accurate claim.) What it does have is everything EP-014 has been building: a per-repo agent library
with stable ids and generated display identities (`topology/lib/agents.mjs`,
`topology/lib/identity.mjs:47` `mintId`, `:96` `sessionName`), one-lead-per-repo enforcement
(`agents.mjs` `findLead`/`createAgent`, `TOPOLOGY_MULTIPLE_LEADS` / `TOPOLOGY_LEAD_EXISTS`), cross-repo routing with lead redirect and
delegation tokens (`topology/lib/routing.mjs` `routeMessage`, `issueDelegation`, `verifyAgainstStore`), and
per-agent outbox authentication (`topology/lib/mailbox.mjs:209-228`, `AO_AGENT_TOKEN`). It is no
longer unguarded: a spec may not launch an agent outside the repo that invoked it
(`topology/lib/spec.mjs:206`, `:211`, `:233` `containPath`/`TOPOLOGY_PATH_ESCAPES_REPO`), and
`auto_approve` is surfaced as a warning naming the agents that will run without prompts
(`topology/lib/launch.mjs:386-391`).

The two do not know about each other. Broker run ids are `run_<uuid>` and the store filters on that
regex when listing (`src/state/store.mjs:7`, `:75`, `:251`); topology run ids are
`YYYYMMDD-HHMMSS-<4>` (`topology/lib/util.mjs:147`). A topology run is therefore invisible to all
fourteen MCP tools, by construction rather than by oversight.

`tm dispatch` sits on top of both. It walks a fallback order of four backends —
`["orchestration", "fleet", "tmux", "manual"]` (`task-management/lib/dispatch/backend.mjs:27`) —
after provisioning a worktree itself (`task-management/lib/dispatch/index.mjs:155` →
`task-management/lib/worktree.mjs:302` `provision`, checkout at
`<root>/.bytedesk/worktrees/<TM-nnn>-<slug>`, `worktree.mjs:79`, `paths.mjs:174`), rendering the
handoff and handing `{ task, worktree, prompt, session, actor }` to the chosen backend
(`index.mjs:161-162`).

`fleet` is being retired as a plugin. It is the only backend that gave a dispatch worktree
isolation, a visible tmux session, transcript observation and depth-based authorization at once, so
its removal forces the choice rather than allowing it to wait.

### What the code says about the two-worktree problem

Both non-trivial backends abandon the worktree tm provisioned.

- The fleet backend documents it outright (`dispatch/fleet.mjs:5-13`): `spawn-claude-feature`
  resolves the canonical checkout from `--repo` and creates its own worktree at
  `<repo>/.claude/worktrees/<ticket>-<slug>` (`fleet/bin/spawn-claude-feature:142-161`). tm's
  worktree stays behind as the claim's recorded checkout while the work happens elsewhere.
- The orchestration backend passes tm's worktree as `consumerCwd`
  (`dispatch/orchestration.mjs:73`) and the broker then derives a *second*, detached worktree — as a
  **sibling**, not underneath: `dirname(checkoutRoot)/.<repo>-worktrees/agent-orchestration/<repositoryKey>/<runId>/primary`
  (`src/workspace/worktrees.mjs:10`, `:52`). The broker cannot be told not to; the derivation is
  unconditional and the isolation is the point.

  **The geometry is the root cause of defect 2 below, so it is worth being exact about.** Because a
  linked worktree is its own `--show-toplevel`, every tm worktree is its own `checkoutRoot` and
  therefore hashes to its own `repositoryKey` (`repository.mjs:52-56`). Had the broker derived its
  worktree *underneath* tm's — the shape this task was originally written against — the key would
  have matched on the way back and the dispatch/collect mismatch would not exist at all. Fleet's
  geometry is different again and equally not-underneath: it builds at
  `<canonical checkout>/.claude/worktrees/<ticket>-<slug>`, off the *first* entry of
  `git worktree list`, which is the main checkout rather than tm's.

Two consequences of that arrangement are live defects today, not future risks:

1. **`write` dispatches require a clean consumer.** `dispatch/orchestration.mjs:76` always sends
   `permissionProfile: "write"`, and `src/service.mjs:231` resolves the consumer with
   `requireClean = true` for exactly that profile, which asserts `git status --porcelain=v1
   --untracked-files=all` is empty (`repository.mjs:41-43`). tm's worktree is not a pristine
   checkout: `applyShares` links or copies `node_modules`, `.env` and friends into it
   (`worktree.mjs:138-158`), and any prior tmux-backend dispatch leaves `.tm-dispatch-prompt.md` in
   the worktree root (`dispatch/tmux.mjs:29`, `PROMPT_FILE`). Each is ignored or not depending on whether
   `ensureIgnored` (`worktree.mjs:170`) got there first; when it did not, the dispatch fails with
   `AO_CONSUMER_DIRTY`.
2. **Collect cannot see the run it dispatched.** Dispatch spawns with `consumerCwd = <tm worktree>`
   (`orchestration.mjs:73`), so the run records the worktree's `repositoryKey`. Collect asks with
   `consumerCwd: p.root` (`dispatch/collect.mjs:160-161`), the repo root, whose `repositoryKey` is a
   different hash — a linked worktree is its own `--show-toplevel`, and the key mixes
   `checkoutRoot` in deliberately (`repository.mjs:52-56`). `orchestration_status` and
   `orchestration_events` both route through `getRun`, which refuses the mismatch
   (`service.mjs:377-378`, `AO_RUN_REPOSITORY_MISMATCH`). The orchestration dispatch → collect
   round trip is broken as written.

## Decision

**The tmux topology layer is the authoritative orchestration layer for dispatched work and for the
EP-014 agent hierarchy. The MCP broker is retained, unchanged, as an opt-in backend for
untrusted autonomous writes — it is not the layer `tm dispatch` reaches for by default.**

Three reasons, all from the code above.

1. **The hierarchy already lives there.** Agent identity, the per-repo agent library, the one-lead
   invariant, cross-repo routing, delegation tokens and outbox authentication are all in
   `topology/lib/`. The broker has no concept of an agent that outlives a run: its unit of state is
   `run_<uuid>` and its follow-up path is explicitly disabled for writable runs
   (`service.mjs:446`, `:472`, `AO_WRITE_FOLLOWUP_REQUIRES_NEW_RUN`). TM-096 asks for durable
   role-sessions; building them on a runtime whose own code refuses to continue a writable session
   is building against the grain.
2. **A dispatched worker must be watchable.** That is the property fleet supplied and the reason
   `tm dispatch` was usable at all. A tmux session is one `tmux attach` away; a bubblewrapped
   process in a transient scope is reachable only through `orchestration_status`, which — see above
   — currently cannot even answer for the runs tm starts.
3. **Topology takes a working directory; the broker manufactures one.** `spec.cwd` defaults to the
   consumer and is contained to it (`spec.mjs:67`, `:205-211`). Handing topology tm's worktree as
   `--consumer` produces exactly one checkout per task. There is no way to ask the broker for the
   same thing.

### What is lost

Stated plainly, because it is real. Choosing topology gives up, for the default dispatch path:
the bubblewrap sandbox and its network namespace; the systemd transient scope and its cgroup
accounting and kill semantics; the hash-chained `events.ndjson` and the corruption invariant that
guards it; proof-of-cancellation (`service.mjs:427`, `AO_CANCELLATION_UNPROVEN`); global and
per-provider concurrency limits (`service.mjs:246-250`); the ownership-record protocol that makes
worktree cleanup safe against tampering; and checkout-scoped run authority. Topology's safety
boundary is the agent CLI's own permission prompts, plus `containPath` and the `auto_approve`
warning — which is a weaker boundary honestly described, not an equivalent one.

Fleet's JSONL transcript observation is lost outright and is not replaced: topology's liveness
signal is the tmux session plus the run journal and outbox files, which is coarser.

The broker is kept, not deleted, precisely because that list is worth having. Work that is
untrusted, autonomous and writable against a product repository still belongs there, requested
explicitly.

### Worktree ownership

**`tm` provisions; the backend reuses. The store gets the last word — the same rule
`tm collect` already applies to a worker's self-reported status.**

- The **topology backend** is launched with `--consumer <tm worktree>` and creates no checkout of
  its own. One worktree per task. The duplication is *resolved*, not accepted.
- The **orchestration backend** derives its own detached worktree and always will; the derivation
  is an invariant of that runtime, not a setting. For that backend the duplication is *explicitly
  accepted*, with the roles named: tm's worktree is the **consumer root of record** — the path on
  the claim, the branch evidence is committed to — and the broker's detached worktree is
  **scratch**. A run's output must land on tm's branch before `tm collect` will accept it. Two
  fixes are required and are TM-098's scope, not this ADR's: pass the same `consumerCwd` on collect
  that was passed on spawn (or record the run's `repositoryKey` in `dispatched`), and either
  provision a clean worktree for orchestration dispatches or make `applyShares` guarantee its
  artifacts are ignored before spawn.

Nothing in the codebase may create a second worktree for a task without a recorded reason. tm's
`provision()` is the only sanctioned entry point for a task checkout.

### The four `tm dispatch` backends

| Backend | Fate | What happens |
|---|---|---|
| `orchestration` | **Kept, demoted** | Stays as an explicit `--backend orchestration` choice for untrusted autonomous writes. Removed from the head of `DEFAULT_ORDER`. The `consumerCwd`/`repositoryKey` mismatch and the `AO_CONSUMER_DIRTY` collision are fixed as part of TM-098 or it is marked unusable, not left silently broken. |
| `fleet` | **Removed** | `dispatch/fleet.mjs`, the fleet collector (`collect.mjs:214-268`), the `fleet` entry in `DEFAULT_ORDER` (`backend.mjs:27`, `:33`) and the host-capability probe (`hostcaps.mjs:183-194`, plus its `doctor` line at `:230`) all go. Its depth-based authorization taxonomy is salvaged first — see `docs/authorization-classes.md` (TM-095). |
| `tmux` | **Converted** | Becomes `topology`: a one-agent spec launched through `ao-topology launch --consumer <tm worktree>`, giving the dispatched worker an identity from the agent library, a mailbox, a journal and provider failover instead of a bare `claude -p` pane. The raw `tmux` backend stays beneath it as the migration fallback and is deleted once the topology backend passes the same contract tests. |
| `manual` | **Kept** | Unchanged. It is the floor: always available, launches nothing, prints the commands (`dispatch/manual.mjs`, `available()` always true). Dispatch must always be able to reach it. |

Resulting order: `["topology", "tmux", "orchestration", "manual"]` during migration, ending at
`["topology", "orchestration", "manual"]`.

## Consequences

- TM-098 converts the fleet backend to `topology`, not to the broker, and inherits the two
  orchestration-backend defects above as explicit scope.
- TM-096 (durable role-sessions) builds on tmux sessions named `<agentId>-<spawn>`
  (`identity.mjs:96`) and on the agent library as the identity of record. The broker's
  writable-follow-up refusal is no longer an obstacle because the broker is no longer the substrate.
- The broker keeps its full test surface and its fourteen tools. Nothing is deleted from `src/`.
- Anything requiring a sandbox must say so and select `--backend orchestration`. A dispatched
  topology worker runs with the repo's own trust settings, contained to the repo by `containPath`
  and gated by the agent CLI's permission prompts.
- The two run stores stay separate and stay mutually invisible. Unifying them is a larger change
  than this decision needs, and a shared listing surface — a TUI over both journals — is the
  cheaper answer if one is ever wanted.

## Alternatives considered

**Make the MCP broker authoritative and rebuild the visible session on top of it.** Rejected. It
inverts the work: identity, the agent library, routing and delegation would all have to be
reimplemented against a run-scoped store that has no durable agent, and the broker's own code
refuses writable session continuation (`service.mjs:446`). It also keeps the second worktree
permanently, since the derivation is an invariant. What it buys — the sandbox — is available
already as an opt-in backend without moving anything.

**Keep both as co-equal peers and let `tm dispatch` choose per task.** Rejected as the *default*;
adopted only as the demoted fallback above. Two co-equal layers means two identity models, two run
stores, two collectors and two answers to "where is the worktree", which is the state TM-088 was
opened to end.

**Merge the two runtimes.** Rejected as disproportionate. There is zero code coupling in either
direction today; a merge means reconciling `run_<uuid>` against a timestamp id, a hash-chained
event log against an append-only JSONL journal, and a sandboxed headless worker against a tmux
pane. The decision this ADR needs is which layer receives new work — not one code base.

**Keep `fleet` alive purely as a dispatch backend.** Rejected. The plugin is retired; keeping one
bash launcher alive to serve one backend preserves the dependency the retirement was meant to
remove, and leaves the two-worktree duplication in place unchanged
(`dispatch/fleet.mjs:5-13`).
