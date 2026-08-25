# Agent Orchestration

Cross-provider orchestration for Claude Code, Codex, Grok Build, and Kimi. The MCP server is the
public control plane; skills and host-specific agent definitions are thin clients of that contract.

Any of those four CLIs can be the **orchestration host**. The host loads this plugin (MCP + skills)
and delegates with `orchestration_spawn`. Spawn targets are trusted catalog IDs, never caller-supplied
commands.

## Host loading

| Host | Package contract |
|---|---|
| Claude Code | `.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, `agents/` |
| Codex | `.codex-plugin/plugin.json`, `.codex-mcp.json`, `skills/` |
| Codex custom agent | Explicitly installed template from `templates/codex-agents/` |
| Grok Build | Same `.mcp.json` / `skills/` / `agents/` as Claude; `grok plugin install` this directory and trust it |
| Kimi Code | `~/.kimi-code/mcp.json` plus skill/agent links from `skills/install-orchestration-host` |

A host remains itself: a Grok session that orchestrates is still Grok. Only an MCP provider execution
changes the external model provider. Wire hosts with `skills/install-orchestration-host`.

## Public MCP contract

These names are compatibility contracts:

- Discovery and routing: `orchestration_capabilities`, `orchestration_doctor`, `orchestration_route`, `orchestration_plan`
- Lifecycle: `orchestration_spawn`, `orchestration_send`, `orchestration_wait`, `orchestration_status`, `orchestration_list`, `orchestration_events`
- Control: `orchestration_cancel`, `orchestration_cleanup`
- Approval: `orchestration_decision_get`, `orchestration_decision_approve`

Provider IDs are `claude`, `codex`, `grok-build`, and `kimi`. Routing decisions and explanations travel in
route, plan, spawn, and status results rather than a second provider-specific tool family.

Every mutating or consumer-grounded tool requires `consumerCwd`, supplied as an explicit absolute
repository or worktree path. Never infer it from `process.cwd()`, the plugin cache, the MCP host, a
prior request, or a provider session. Reject missing, relative, nonexistent, or disallowed paths.

## Runtime invariants

1. Spawn subprocesses with executable plus argv arrays and `shell: false`. Task text, models, paths,
   session names, and provider data are never shell source.
2. Default the workspace mount to read-only. Writes require explicit caller authority scoped to the
   consumer worktree. Spawned catalog CLIs always run in yolo / skip-permissions mode (ACP
   auto-approves tools after auth bootstrap; Codex `agent-full-access`; Grok `--always-approve`).
   Isolation comes from the selected governed platform sandbox, not inner permission prompts:
   Bubblewrap on Linux/WSL2 or AppContainer on native Windows.
3. State lives outside the immutable installed plugin root and is namespaced by consumer, provider,
   orchestration, and execution IDs. Never mix sessions from two worktrees with the same repo name.
4. Credentials stay with provider CLIs. Doctor reports ready/not-ready and remediation without
   printing tokens, secret values, or configuration contents.
5. MCP stdout is JSON-RPC only. Diagnostics go to stderr. A closed pipe is normal shutdown.
6. Cancellation is cooperative first and forceful only after a bounded grace period. Cleanup never
   destroys a result or decision record that has not been collected.
7. Partial failure is first-class. One missing provider does not make healthy providers unavailable,
   and one failed execution does not erase successful siblings.
8. Concurrency, timeout, retry, and budget policy are orchestration policy, not provider adapters.
   Provider adapters translate ACP capabilities and lifecycle events without owning scheduling.
9. Writable execution uses a detached worktree rooted at
   `../.<consumer-repo>-worktrees/agent-orchestration/<repository-key>/<run>/<task>`. It is always derived from the
    repository resolved from `consumerCwd`; marketplace and plugin process paths are forbidden inputs.
    Every provider is wrapped by the selected platform sandbox with an allowlisted root and cleared environment: the
    workspace permission matches the profile, shared Git metadata is read-only, and only broker
    scratch is additionally writable. Outbound networking uses a separate `slirp4netns` namespace
    with host loopback disabled. ACP client filesystem/terminal callbacks and ambient credential or
    proxy variables are forbidden because they would cross that boundary. Provider authentication
    files are staged as private, exact read-only bootstrap copies beneath nested provider-home
    mountpoints. One constant broker-authored turn runs with permission requests denied. After
    AUTH_READY, provider tools are auto-approved. Credential copies stay mounted until process
    teardown because subscription CLIs re-read them; host auth files are never mounted.
    Linux and WSL2 use Bubblewrap plus `slirp4netns`; native Windows uses AppContainer plus Job
    Objects and grants internet-client capability without private-network or loopback capability.
    Scratch is mounted directly at `/agent-orchestration-runtime` on Linux/WSL2 and mapped to an
    exact broker-owned directory on native Windows. The bundled Claude bridge must keep user,
    project, and local setting sources disabled during bootstrap.
10. Architecture uses `architecture.adversarial.v1`: Claude Fable/Opus proposal, independent
    OpenAI Sol critique, same-Claude revision, and a deterministic approval gate. The proposal and
    critique run at max effort with no silent downgrade.
11. Scheduler admission is serialized. `AGENT_ORCHESTRATION_MAX_CONCURRENT_RUNS` and
    `AGENT_ORCHESTRATION_MAX_CONCURRENT_PER_PROVIDER` are positive integer limits; idempotency keys
    are scoped by resolved repository identity.
12. Follow-ups are child runs, never turns hidden inside the MCP process. They require an explicitly
    persistent, read-only parent and a provider with supported session loading, then retain normal
    scheduling/cancellation. One-shot, unsupported, and writable follow-ups fail closed.
13. Provider executables resolve to canonical paths inside provider-specific trusted installation
    roots. Worker and probe scopes retain memory, process-count, runtime, core-dump, and per-file
    ceilings; ACP frames, aggregate transport, buffered requests, and stderr remain bounded with
    backpressure.
14. Roadmap work occurs only in a writable source checkout. Start by reading `ROADMAP.md` and running
    `npm run roadmap:check`, then preserve IDs, dependency closure, connectedness, and reciprocal lineage. If
    referenced implementation changes, regenerate `ROADMAP-SOURCES.json` with
    `npm run roadmap:refresh-sources` and review the integrity-manifest diff. With
    no requested target, present at most five eligible actions. Strategic goals and trajectories
    remain proposed until a human roadmap steward approves them; they never execute, spend, reserve,
    or mutate. Installed-cache roadmap content is read-only reference/discovery material. External
    provider work remains scoped by explicit consumer-relative `consumerCwd`, never the plugin cache
    cwd.

## Packaging invariants

- `dist/host-launcher.cjs`, `dist/mcp.cjs`, `dist/cli.cjs`, `dist/provider-sandbox.cjs`,
  `dist/probe-worker.cjs`, `dist/windows-native/`, and `dist/session-ui/` are committed,
  authoritative install artifacts.
- `bin/` only locates and executes those bundles. It never installs, invokes `npx`, or rebuilds.
- A compatibility claim requires launching the actual installed cache copy with no `node_modules`
  and no path back to the source checkout.
- No absolute symlinks, tracked `node_modules`, generated credentials, or mutable session data.
- Ship `ROADMAP.md`, `ROADMAP-INVENTORY.json`, `ROADMAP-SOURCES.json`, `scripts/roadmap.mjs`, and
  `skills/roadmap-orchestrator/` in clean
  installed-cache copies without shipping the other development scripts.
- Keep `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json`, README, skills, and
  the MCP schemas synchronized when the public contract changes.

## Verification

Run the narrow tests first, then the package gate:

```sh
npm ci
npm run build:all
npm run build:check
npm test
npm run test:contract
claude plugin validate .
```

Claude's validator reports the deliberately omitted internal-plugin version as an expected warning.
It must still pass, and CI must not add a pinned version merely to silence the warning.

The contract suites must cover JSON-RPC framing, all tool schemas, explicit `consumerCwd`, path and
prompt injection, provider-independent doctor behavior, spawn/send/wait/events/cancel/cleanup,
approval decisions, restart recovery, and clean installed-cache startup.
