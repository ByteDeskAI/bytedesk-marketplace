# Agent Orchestration

Cross-provider orchestration for Claude Code, Codex, Grok Build, and Kimi. The MCP server is the
public control plane; skills and host-specific agent definitions are thin clients of that contract.

## Host loading

| Host | Package contract |
|---|---|
| Claude Code | `.claude-plugin/plugin.json`, `.mcp.json`, `skills/`, `agents/` |
| Codex | `.codex-plugin/plugin.json`, `.codex-mcp.json`, `skills/` |
| Codex custom agent | Explicitly installed template from `templates/codex-agents/` |
| Grok Build / Kimi | Spawned as ACP providers; they do not load this plugin directly |

Codex custom agents remain Codex agents. Claude agent definitions remain Claude agents. Only an MCP
provider execution changes the external model provider.

## Public MCP contract

These names are compatibility contracts:

- Discovery and routing: `ao_capabilities`, `ao_doctor`, `ao_route`, `ao_plan`
- Lifecycle: `ao_spawn`, `ao_send`, `ao_wait`, `ao_status`, `ao_list`, `ao_events`
- Control: `ao_cancel`, `ao_cleanup`
- Approval: `ao_decision_get`, `ao_decision_approve`

Provider IDs are `claude`, `codex`, `grok-build`, and `kimi`. Routing decisions and explanations travel in
route, plan, spawn, and status results rather than a second provider-specific tool family.

Every mutating or consumer-grounded tool requires `consumerCwd`, supplied as an explicit absolute
repository or worktree path. Never infer it from `process.cwd()`, the plugin cache, the MCP host, a
prior request, or a provider session. Reject missing, relative, nonexistent, or disallowed paths.

## Runtime invariants

1. Spawn subprocesses with executable plus argv arrays and `shell: false`. Task text, models, paths,
   session names, and provider data are never shell source.
2. Default provider permissions to read-only. Writes require explicit caller authority scoped to the
   consumer worktree. Approval is a durable decision, not a boolean guessed from an ambient prompt.
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
    Every provider is wrapped by Bubblewrap with an allowlisted root and cleared environment: the
    workspace permission matches the profile, shared Git metadata is read-only, and only broker
    scratch is additionally writable. Outbound networking uses a separate `slirp4netns` namespace
    with host loopback disabled. ACP client filesystem/terminal callbacks and ambient credential or
    proxy variables are forbidden because they would cross that boundary. Provider authentication
    files are staged as private, exact read-only bootstrap copies beneath nested provider-home
    mountpoints. One constant broker-authored turn runs with all permission requests denied; the
    copies are revoked before the first task-controlled prompt, and host auth files are never mounted.
    Scratch is mounted directly at `/agent-orchestration-runtime`, and the bundled Claude bridge must
    keep user, project, and local setting sources disabled during bootstrap.
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

## Packaging invariants

- `dist/mcp.cjs`, `dist/cli.cjs`, `dist/provider-sandbox.cjs`, and `dist/probe-worker.cjs` are committed, authoritative install artifacts.
- `bin/` only locates and executes those bundles. It never installs, invokes `npx`, or rebuilds.
- A compatibility claim requires launching the actual installed cache copy with no `node_modules`
  and no path back to the source checkout.
- No absolute symlinks, tracked `node_modules`, generated credentials, or mutable session data.
- Keep `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json`, README, skills, and
  the MCP schemas synchronized when the public contract changes.

## Verification

Run the narrow tests first, then the package gate:

```sh
npm ci
npm run build
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
