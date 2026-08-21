# Extending Agent Orchestration

The framework separates host packaging, routing metadata, provider transport, execution protocols,
durable state, and workspace lifecycle. A new provider or policy should not require changes to the
MCP lifecycle tools, worker, state store, or worktree backend.

## Add an ACP provider

1. Add static provider/model capabilities in `src/providers/catalog.mjs`. Keep live availability out
   of the catalog.
2. Add one trusted descriptor in `src/providers/adapters.mjs`: ACP target, executable/argv, optional
   bundled bridge, effort transport, provider-specific executable roots, optional fixed-command
   candidate resolvers for version managers, and a bootstrap-file
   allowlist. The doctor, sandbox launcher, and runtime registry derive from this descriptor; every
   provider must pass the broker's bounded ACP session probe, which is the complete authenticated
   readiness check. Resolvers use broker-authored absolute executables and argv only; their outputs
   are canonicalized and must remain beneath a declared trusted root. Request data must never become
   a command.
3. Add or update routing aliases in `src/policy/catalog.mjs`.
4. If the provider needs a bridge, bundle it at build time and add a thin `bin/` launcher. Runtime
   downloads and `npx` are forbidden.
5. Add deterministic routing tests, a missing-provider doctor test, and an opt-in read-only live
   lifecycle smoke.

## Add a routing policy

Aliases are ordered policy. Hard filters apply first: provider/model allow and deny lists, required
capabilities, exact effort, diversity, and the frozen availability snapshot. Scoring explains a
choice but cannot overturn alias order. Add request semantics in `OrchestrationService.routingContext`
only when they are provider-independent and testable.

## Add a protocol

Declare stage roles, dependencies, registered selection kind, and output contract in
`src/protocols/definitions.mjs`. Definitions are validated and topologically ordered; missing,
duplicate, cyclic, unsupported-executor, unsupported internal-contract, or incomplete dependencies
fail closed. Provider prompts receive only declared transitive dependency outputs, so independent DAG
branches cannot observe one another accidentally. Existing route, persistent-session,
session-reuse, and deterministic-gate executors require no runtime change. A genuinely new selection
kind needs one explicit runtime executor and contract tests; provider turns remain generic.

## Change persistence or workspace placement

`RunStore` is the event/snapshot boundary. `resolveConsumerRepository` is the repository identity
boundary. `createOrchestrationWorktree` and `removeOrchestrationWorktree` are the workspace backend.
Keep public MCP schemas stable while replacing an implementation behind one of those boundaries.

Compatibility requires unit tests, tracked bundle drift, clean installed-cache startup, and a fresh
host session. Provider executables and authentication are optional; readiness must report unavailable
instead of silently falling back across a hard policy constraint.

Runtime and readiness processes are owned by transient systemd user cgroups. New execution paths must
stay inside that supervisor boundary and must not add a direct, unsandboxed provider launch fallback.
Authentication is CLI-managed. Allowlisted bootstrap files must contain authentication only: settings,
hooks, plugins, MCP configuration, and project config are not valid bootstrap inputs. The copies live
in broker-owned tmpfs and are exposed as exact read-only files in an otherwise writable provider
home. Every writable ancestor is separately mounted beneath the direct sandbox top-level
`/agent-orchestration-runtime`, preventing a provider from renaming an ancestor to retain the mount.
The first model turn is the constant broker-authored authentication bootstrap; it contains no task
prompt and all ACP permission requests are denied. Copies must be truncated and unlinked before its
response opens the task-prompt gate; host auth files are never mounted. Provider-specific bridges
must also exclude consumer/user settings, hooks, plugins, and MCP configuration during that phase;
the bundled Claude bridge enforces empty setting sources at build time.

The ACP gate must preserve JSON-RPC request direction, buffer bounded pipelined prompts, enforce
frame, aggregate-transport, outstanding-request, and stderr limits with backpressure, and fail closed
before establishment. Ambient API-key variables are not forwarded because Bubblewrap environment
arguments are observable to same-user processes. Credential-bearing proxy variables are subject to
the same rule. ACP client-side filesystem and terminal callbacks stay denied; extensions must use
provider-native tools inside the sandbox instead. New worker/probe paths must retain the systemd
memory, task-count, runtime, and control-group ceilings plus disabled core dumps and per-file limits.
