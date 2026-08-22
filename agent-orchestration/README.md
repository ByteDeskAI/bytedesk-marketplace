# Agent Orchestration

Agent Orchestration gives Claude Code, Codex, Grok Build, and Kimi Code one MCP control plane for
delegating bounded work to Claude Code, Codex, Grok Build, and Kimi. Any of those four CLIs can host
orchestration. It preserves provider attribution, durable execution identity, explicit permissions,
lifecycle control, and structured results instead of scraping terminal output.

## What it provides

- Capability and health discovery for each provider independently.
- Explainable routing and execution plans.
- One-shot and persistent provider sessions.
- Spawn, follow-up, wait, status, event, cancellation, and cleanup controls.
- Durable approval decisions for governed actions.
- A validated, lineage-aware roadmap and a shared skill for refining tasks, unlocks, trajectories,
  gaps, and goals without turning strategy into execution authority.
- Shared skills for Claude Code, Codex, Grok Build, and Kimi Code; a Claude/Grok orchestration agent;
  and an optional Codex custom-agent template.

The plugin does not turn a native Claude or Codex subagent into another provider. External provider
work exists only when the MCP server starts a provider execution.

## Requirements

- Node.js 22.13 or newer.
- Linux with Bubblewrap (`bwrap`), `slirp4netns`, and `prlimit` for provider filesystem,
  process, network-namespace, core-dump, and per-file isolation.
- An active systemd user manager (`systemd-run --user`) for per-run and per-probe cgroup ownership;
  orchestration fails closed when the user manager is unavailable.
- At least one authenticated provider CLI:
  - Claude Code for provider ID `claude` (also a host).
  - Codex for provider ID `codex` (also a host).
  - Grok Build for provider ID `grok-build` (`grok agent stdio`; also a host after plugin install).
  - Kimi CLI for provider ID `kimi` (`kimi acp`; also a host after `~/.kimi-code/mcp.json` wiring).

Providers are optional and independent. Run the doctor after installation to see which are ready.
Each candidate is admitted only after a bounded authenticated ACP session initialization; Kimi uses
that handshake directly because its CLI does not expose a separate non-mutating auth-status command.

Default routing is capability-aware and explainable: architecture is an adversarial max-effort
conversation between Claude Fable (Opus fallback) and OpenAI Sol, design prefers Fable/Opus,
implementation prefers Sol with effort raised for high-risk work, research prefers Grok, large-context
work prefers Kimi, and review excludes the originating provider family when an alternative is ready.

## Install from the ByteDesk marketplace

Claude Code:

```sh
claude plugin marketplace add /absolute/path/to/bytedesk-marketplace
claude plugin install agent-orchestration@bytedesk
```

Codex:

```sh
codex plugin marketplace add /absolute/path/to/bytedesk-marketplace
codex plugin add agent-orchestration@bytedesk
```

Grok Build:

```sh
grok plugin install /absolute/path/to/bytedesk-marketplace/agent-orchestration --trust
```

Kimi Code (and a dry-run of every host):

```sh
node skills/install-orchestration-host/scripts/install-host.mjs --dry-run --all
node skills/install-orchestration-host/scripts/install-host.mjs --host kimi --host grok
```

Start a fresh host session after installation so the MCP server and skills are discovered.

Codex custom agents are standalone TOML files and are not registered by the plugin manifest. Invoke
the bundled `install-codex-orchestration-agent` skill if you want the optional
`cross_provider_orchestrator` agent installed at personal or project scope.

## Use

Ask naturally:

- “Have Claude, Grok, and Kimi independently review this plan, then synthesize the disagreements.”
- “Delegate the API and UI investigations in parallel, read-only, and wait for both.”
- “Show the external agent sessions still running for this worktree.”
- “Cancel the stalled Grok execution but preserve its events.”

The `agent-orchestrate` skill drives the public MCP surface:

| Area | Tools |
|---|---|
| Discovery | `orchestration_capabilities`, `orchestration_doctor` |
| Routing | `orchestration_route`, `orchestration_plan` |
| Lifecycle | `orchestration_spawn`, `orchestration_send`, `orchestration_wait`, `orchestration_status`, `orchestration_list`, `orchestration_events` |
| Control | `orchestration_cancel`, `orchestration_cleanup` |
| Approval | `orchestration_decision_get`, `orchestration_decision_approve` |

Every mutating or consumer-grounded call requires `consumerCwd`: the explicit absolute path of the
repository or worktree the external agent may observe or change. The server never infers it from its
own process directory.

`orchestration_send` creates a durable child run only when the parent was explicitly spawned with
`sessionMode: "persistent"`, stayed read-only, and the provider advertises durable session loading.
The child retains its own status, events, worker, and cancellation boundary. One-shot, unsupported,
and writable follow-ups fail closed; spawn a new scoped run instead.

## Govern the roadmap

The installed package includes `ROADMAP.md`, its append-only `ROADMAP-INVENTORY.json` identity
ledger, its validator, portable `ROADMAP-SOURCES.json` seam integrity data, and the
`roadmap-orchestrator` skill for reference and discovery. Invoke
`$roadmap-orchestrator`, ask to “enhance the roadmap” or “extend the roadmap,” or name a roadmap
task, unlock, trajectory, gap, or goal ID. The skill reads the repository roadmap, runs
`npm run roadmap:check` (or `node scripts/roadmap.mjs --check`), preserves IDs and reciprocal
lineage, and validates again after an edit. With no target, it presents at most five eligible
actions instead of inventing work.

Use the safe enhancement sequence exactly: (1) precheck with `npm run roadmap:check`, then edit
canonical records; (2) when new IDs were added, run `npm run roadmap:append-inventory` and only
append immutable inventory identities; (3) run `npm run roadmap:refresh-views`; (4) run
`npm run roadmap:refresh-sources` only when referenced source content or anchors intentionally
changed, and review the manifest diff; (5) run `npm run roadmap:check` again. Never hand-edit
generated views or refresh source integrity data to hide unexplained drift.

IDs are never renamed, recycled, or deleted. A strategic identity change creates a same-kind
replacement and supersedes the historical record. Supersession chains must be acyclic and end at a
live replacement. Retired history may retain evidence and lineage; constraints for the active
projection apply only to live records.

Claude Code, Codex, Grok Build, and Kimi Code can each load the plugin as a host. A host session
delegates through MCP; Grok and Kimi also remain spawn targets for the other hosts. Every provider
run still requires an explicit `consumerCwd` pointing at the intended consumer checkout or worktree. Mutate roadmaps only in a writable source checkout containing `ROADMAP.md` and
`scripts/roadmap.mjs`. The installed cache is read-only and neither its process directory nor its
packaged roadmap becomes an implicit consumer repository.

Goals and trajectories remain strategic proposals. They cannot execute work, spend budget, reserve
capacity, or mutate a workspace, and only a human roadmap steward may approve them for commitment.

## Safety model

- Read-only is the default permission profile.
- Provider processes execute only broker-owned adapter descriptors; task/model/path request data never
  becomes command source. Executable discovery accepts only canonical paths beneath each provider's
  declared installation roots; a consumer checkout cannot shadow a provider binary through `PATH`.
- Credentials remain in provider-owned authentication stores and are never returned by doctor or
  event tools. Only explicitly allowlisted auth files (never general provider settings, hooks, MCP
  configuration, or project configuration) are copied into a broker-owned tmpfs tree, mounted as
  exact read-only files in an otherwise writable provider home. One constant broker-authored
  authentication turn runs with all ACP permission requests denied and no task prompt; the copies are
  then truncated and unlinked before the first task-controlled prompt is released. Every writable
  auth-file ancestor is a nested mountpoint, so the provider cannot rename an ancestor to retain the
  credential mount. Dead-process tmpfs remnants are scavenged by exact owned prefixes.
- State is stored outside the installed plugin cache and isolated by consumer, provider,
  orchestration, and execution ID. Linked worktrees of the same Git repository receive distinct
  consumer authority keys and cannot inspect, cancel, or clean up one another's runs.
- Write runs use detached Git worktrees under
  `../.<consumer-repo>-worktrees/agent-orchestration/<repository-key>/`; paths are derived from the explicitly resolved
  consumer repository, never from the marketplace or plugin cache.
- Every provider turn runs inside Bubblewrap with an empty root, fresh `/dev`, allowlisted system and
  provider files, a cleared environment, and a revocable provider bootstrap home. The consumer
  worktree is read-only for read runs and is the only writable project path for write runs; the
  `.git` marker and shared Git metadata are read-only. Per-turn provider scratch is a fresh tmpfs tree
  mounted directly at `/agent-orchestration-runtime` and is the only additional writable mount;
  broker control sources are never broadly exposed. The bundled Claude bridge disables user,
  project, and local setting sources so consumer hooks or MCP configuration cannot run during the
  credential-visible bootstrap.
  `slirp4netns` provides
  outbound networking from a separate namespace with host loopback disabled.
- ACP client-side filesystem and terminal callbacks are denied because they execute in the broker,
  outside Bubblewrap. Provider-native tools remain governed by the declared read/write profile inside
  the sandbox. Ambient API-key and proxy variables are not forwarded through observable process argv.
- The hash-chained journal is the recovery authority for snapshots, terminal evidence is immutable,
  stale locks/breakers are reclaimable by owner identity, and a periodic supervisor watchdog detects
  workers lost after initial startup recovery.
- Workers and readiness probes run in uniquely named transient systemd user scopes with
  `KillMode=control-group`, so provider descendants are reaped even if the Node leader exits. Spawn
  succeeds only after the worker acknowledges its exact active scope; failed launches are quarantined.
  Worker scopes are capped at 8 GiB/512 tasks and readiness probes at 2 GiB/128 tasks in addition to
  their runtime deadlines. Core dumps are disabled, per-file output is capped at 1 GiB for workers
  and 256 MiB for probes, ACP frames and transports are bounded, and provider stderr is backpressured
  and capped.
- Cancellation requests the active ACP turn first, then verifies and terminates the worker process
  group after a bounded grace period. A numeric process-group ID is never signalled unless the leader's
  start identity still proves ownership; unverifiable survivors remain retryable as `cleanup_required`.
- Approval decisions are inspectable and scoped; they do not silently expand permissions.
- Scheduler admission is atomic, idempotency is repository-scoped, and global/per-provider concurrency
  limits are configurable without changing provider adapters.
- Partial results remain available when a provider stage fails or is unavailable.
- `orchestration_cleanup` permanently discards a terminal worktree only after verifying its exact derived path,
  external broker ownership nonce, base SHA, Git marker, Git admin directory, and registration.
  Collect the result and patch first; the durable run journal and decision evidence remain.

## Development

The launchers execute committed bundles and never build at runtime:

```text
bin/agent-orchestration-mcp -> dist/mcp.cjs
bin/agent-orchestration     -> dist/cli.cjs
bin/provider-sandbox        -> dist/provider-sandbox.cjs
```

Build and verify:

```sh
npm ci
npm run build
npm run build:check
npm test
npm run test:contract
claude plugin validate .
```

With provider credentials available, run an opt-in sandboxed write smoke (defaults to Codex):

```sh
AO_LIVE_PROVIDER=codex npm run test:live
```

Internal Claude plugins intentionally omit a manifest version so their Git commit is the distribution
version. Claude's validator reports the omission as an expected warning while still passing; do not
add a pinned version merely to silence it.

A release is not compatible until its tracked installed copy starts without `node_modules`, npm,
esbuild, network access, or a path back into the source checkout. The contract suite must complete a
real write/cancel/cleanup lifecycle through a deterministic ACP provider; available native providers
must pass doctor handshakes, with opt-in live smokes used for provider credentials and entitlements.
Provider authentication must be established through each CLI's own login/config store. Auth-only
bootstrap files are read-only inside the provider. They are visible only during a constant,
permission-denied broker bootstrap turn, revoked before any task prompt, and the original host files
are never mounted. Ambient API-key
variables are deliberately not forwarded into Bubblewrap because secret values must never appear in
process arguments.
