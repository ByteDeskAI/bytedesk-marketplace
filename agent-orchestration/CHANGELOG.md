# Changelog

## 0.2.0 - Unreleased

- Add the Agent Orchestration Session plan and a Cobalt workbench mockup: a per-run loopback window
  for conversation, handoffs, activity, approvals, and controls. `node session-ui/serve.mjs` prints
  `Orchestration session: <url>` and opens a browser. Not wired into spawn yet.
- Wire Claude Code, Codex, Grok Build, and Kimi Code as orchestration hosts of the same MCP control
  plane. Spawn targets stay the trusted catalog (`claude`, `codex`, `grok-build`, `kimi`).
- Point sandbox `HOME` at the provider config dir so Claude Max subscription auth works without the
  unmounted host home.
- Keep the Claude credential copy mounted until sandbox teardown. Mid-run shredding made the
  bootstrap turn succeed and the task turn fail with AUTH_REQUIRED.
- Run every spawned catalog CLI in yolo / skip-permissions mode: ACP auto-approves tools after
  auth bootstrap, Codex starts in `agent-full-access`, Grok gets `--always-approve`. Bubblewrap
  still enforces the orchestration read/write mount.
- Admit the Kimi Code CLI from `~/.kimi-code/bin` in addition to the uv/pipx install roots.
- Add `install-orchestration-host` to install/trust the Grok plugin and write Kimi `mcp.json` plus
  skill/agent links without replacing unrelated MCP servers.
- Ship the governed `ROADMAP.md` and the cross-host `roadmap-orchestrator` skill with Codex UI
  metadata.
- Add validated task refinement, unlock materialization, trajectory extension, distance-aware gap
  filling, and evidence-ranked goal advancement while preserving IDs and reciprocal lineage.
- Preserve immutable roadmap identities in the packaged `ROADMAP-INVENTORY.json` ledger and require
  the precheck, edit, inventory append, canonical-view refresh, conditional source refresh, and final
  check sequence for enhancements.
- Require acyclic supersession chains to terminate at a live replacement while retaining retired
  evidence and lineage outside the active projection.
- Validate dependency-closed trajectories, human strategic approval provenance, lifecycle state
  combinations, semantic Mermaid relationships, and portable source seams in both source and clean
  installed-cache copies.
- Keep strategic proposals human-approved and non-executing, and preserve explicit
  consumer-relative `consumerCwd` for every external provider run.

## 0.1.0 - Unreleased

- Add dual Claude Code and Codex plugin manifests.
- Add bundled MCP and CLI launcher contracts.
- Add cross-provider orchestration and diagnostic skills.
- Add Claude-native orchestration agent and optional Codex custom-agent template.
- Standardize the public MCP lifecycle, routing, event, cleanup, and approval surface on
  `orchestration_*`; no compatibility aliases are exposed.
- Require explicit absolute `consumerCwd` for consumer-grounded and mutating operations.
- Add deterministic capability-aware routing, the max-effort adversarial architecture protocol,
  repository-derived worktrees, durable hash-chained state, readiness probes, and atomic scheduling.
- Add Bubblewrap-enforced write containment, cooperative/verified cancellation, journal recovery,
  architecture decision lifecycle gates, installed-cache lifecycle coverage, and declarative provider
  command descriptors.
- Isolate provider roots, environments, devices, runtime sockets, and networks; outbound provider
  traffic uses `slirp4netns` with host loopback disabled.
- Add explicit one-shot/persistent session contracts, fail-closed follow-up eligibility, validated
  protocol DAGs, concrete MCP output schemas, terminal evidence immutability, periodic recovery,
  and nonce-owned exact-path worktree cleanup.
- Add bounded authenticated ACP readiness for every provider (including Kimi), fresh unmounted broker
  control directories, dependency-scoped protocol evidence, executor/contract registration gates, and
  retryable cleanup for process groups whose ownership cannot be proven.
- Run workers and sandboxed readiness probes inside transient systemd user scopes so timeouts, close
  failures, and leader exits cannot orphan provider descendants.
- Deny ACP client-side filesystem/terminal callbacks, omit credential-bearing proxy variables from
  sandbox argv, and require an active-scope worker acknowledgement before spawn returns.
- Replace persistent host credential mounts with per-turn bootstrap copies that are visible only to
  one constant, permission-denied broker authentication turn, then truncated and unlinked before the
  first task-controlled prompt.
- Restrict bootstrap inputs to auth-only files in broker-owned tmpfs; expose them as exact read-only
  mounts beneath otherwise writable provider homes whose ancestors are nested mountpoints; mount
  scratch directly at a sandbox top-level; and disable Claude user, project, and local setting sources.
- Admit only canonical provider executables beneath provider-specific installation roots, including
  fixed-command resolver support for version-manager shims; gate
  pipelined ACP prompts behind exact session responses; bound frames, transports, request buffers,
  and stderr; and add cgroup, runtime, core-dump, task-count, memory, and per-file ceilings.
- Scope run authority to the exact consumer checkout so linked worktrees cannot inspect or control
  one another, and revalidate provider-specific executable roots again at sandbox execution time.
