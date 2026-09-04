# Changelog

## Unreleased

- Add the `design-studio` orchestration template: three panes bound to the design-system repo’s
  own `design-system-studio` director/hands/judge role files, each on its own provider chain, with
  the studio’s director driving the run and the template supplying only the terminals, fallback,
  and mailbox transport.
- Add `claude.fable-5-1` (model `claude-fable-5-1`) to the trusted model catalog and put it first on
  the `architecture.proposal`, `design.default`, `implementation.default`, and
  `provider.claude.default` aliases, ahead of `claude.opus-5` and the `claude.opus-4-8` fallback.
- Accept an optional exact `endpointId` on routing input, validated against the trusted catalog so
  arbitrary model IDs are rejected; it narrows the model allowlist to that one endpoint.
- Add an `image_generation` capability ID, advertised as supported for the Claude provider and
  unknown elsewhere until a probe says otherwise.
- Route Claude work to `claude.opus-5` (model `claude-opus-5`) on every default alias, with
  `claude.opus-4-8` as the deterministic fallback. The Claude Agent SDK ships a static model table
  that lags the CLI, so a build-time esbuild plugin clones the newest Opus entry under the new ID
  and fails loudly if the table shape changes or upstream adds the model itself. Synced from the
  released upstream source; the MCP server now advertises `0.2.3` instead of `0.1.0`.
- Stop every idle server from re-reading every run forever. Each host — claude, codex, grok, kimi —
  runs its own server against one shared state root, and each swept the full store every 5 seconds,
  reconciling every snapshot on disk (68 runs, 154 ms a pass, ~3% of a core per server) only to
  rediscover that almost all of them are terminal; 56 idle servers had accumulated 52 CPU-hours.
  A zero-byte `.active` marker, written on create and cleared on any terminal transition, turns the
  sweep into one stat per run — 154 ms becomes 3 ms — and only unfinished runs are read. The marker
  is a hint, never the truth: a stale one costs one snapshot read and the sweep clears it, and runs
  predating the scheme are swept once and then marked. The fixed interval becomes a
  self-rescheduling timer that backs off toward a minute while consecutive sweeps find nothing.
  Not addressed: nothing yet elects a single recovery owner among the servers on one machine.
- Discover providers in the caller's directory instead of the server process's own. Discovery ran in
  the MCP server's working directory — the plugin's directory — so a version-manager shim such as
  volta, which answers per project by walking up from the working directory, returned the plugin's
  own `node_modules` copy (correctly rejected by `externalProviderPaths`) while the PATH shim's
  realpath sat outside the trusted roots: no path could resolve, and codex failed
  `executable_not_found` on a machine that runs it daily. The same call fails with "Could not
  determine current directory" when a long-lived server's cwd has been deleted. Discovery now takes
  the consumer directory explicitly and falls back only to a directory that still exists (caller's
  path, `$PWD`, a still-valid `process.cwd()`, home), the availability cache is keyed on that
  directory because one entry cannot answer for two consumers pinning different provider versions,
  and `orchestration_doctor` accepts `consumerCwd` like every other grounded tool.
- Supervise the loopback session host with `systemd-run --user --scope` on Linux/WSL so the operator
  page outlives the MCP process. Native Windows stays in-process.
  `AGENT_ORCHESTRATION_SESSION_SUPERVISOR=0` forces in-process. The session-host CLI is a store-backed
  control plane (`autoRecover: false`) so cancel / follow-up / decision still work after MCP exit.
- Topology specs support ordered provider fallback chains (`candidates: ["cli:model", ...]`)
  for every agent, launch-time fallback past missing CLIs and usage/auth failures, mid-run
  `ao-topology failover` with mailbox re-delivery, launch-time input menus (`inputs.<name>.options`,
  `ao-topology inputs`), and the `logo-design` template.
- Add the tmux topology layer: declarative orchestration specs and templates, provider adapters for
  any installed CLI (claude, codex, grok, kimi, copilot, gemini, generic), domain-free role packs,
  a file-first mailbox with a JSONL journal, the `ao-topology` CLI (launch/send/wait/reply/capture/
  nudge/status/journal/stop/doctor/compose), and the `orchestration-compose`, `orchestration-launch`,
  `orchestration-conduct`, `orchestration-status`, and `setup-agent-orchestration` skills. Ships the
  `brand-identity-tournament` and `parallel-review` templates and a real-tmux contract test.
- Add a reusable cross-platform runtime built with Abstract Factory, Strategy, Facade, and Adapter
  roles. Linux keeps Bubblewrap/systemd isolation; Windows can use native AppContainer/Job Object
  isolation or a WSL2 adapter that reuses the Linux backend.
- Select the Windows backend with `AGENT_ORCHESTRATION_WINDOWS_BACKEND=auto|native|wsl`. Automatic
  selection prefers a healthy native backend and falls back to a fully provisioned WSL2 backend.
  Both explicit modes fail closed when required security dependencies are unavailable.
- Add a committed .NET 8 Windows helper for AppContainer launch, exact filesystem access rules,
  bounded Job Objects, owned-process verification, and cooperative-then-forceful termination.
- Fall back to an OS-assigned loopback port when Hyper-V or WSL reserves the fixed session-host range.
- Advertise Agent Orchestration in the Codex marketplace manifest and use Node-based MCP entries
  that load consistently on Windows and Linux.
- Store Windows state under `LOCALAPPDATA`, retain the XDG state location on Linux, and resolve
  missing nested state directories without duplicating Windows path segments.
- Project the session transcript, activity, and handoffs from the journal, and POST cancel /
  follow-up / decision through the broker. Follow-ups persist as `operator_message` events. Loopback
  Origin is required for browser mutations.
- Stream the hash-chained run journal to the session UI over cookie-auth SSE
  (`GET /api/runs/:id/events`). `after` / `Last-Event-ID` resume, a corrupt chain returns 409,
  and the status bar shows `live` / `reconnecting` / `detached`. The stage rail is `plan.stages`.
- Start a per-state-root Agent Orchestration Session host on `127.0.0.1`. Spawn returns a one-use
  `session.url`; the host exchanges it for an HttpOnly cookie and serves the committed session UI.
  Capability secrets stay out of `snapshot.json`. `agent-orchestration session-host` is the CLI bind.
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
