# Agent Orchestration

Agent Orchestration gives Claude Code, Codex, Grok Build, and Kimi Code one MCP control plane for
delegating bounded work to Claude Code, Codex, Grok Build, and Kimi. Any of those four CLIs can host
orchestration. It preserves provider attribution, durable execution identity, explicit permissions,
lifecycle control, and structured results instead of scraping terminal output.

See [repository leads and standing services](docs/repository-leads.md) for canonical worktree identity,
configurable prompts, reviewer gates, durable mail and Presence v1.

Prompt and configuration settings: `ao-topology config get|set|validate` read and write one
configuration layer with a revision guard, `prompt preview --agent|--role` shows the composed prompt
and its sources, a global `prompts.prefix` composes first, and every prompt entry can `append` or
`replace` (`agent set-instructions` for one agent) — role protocol (lead and reviewer templates)
is never replaced. See
[Configuration and prompts](docs/repository-leads.md#configuration-and-prompts).

## Read-only orchestration observer

The `orchestration-observer` agent attaches to one explicitly selected live orchestration. It records
its attachment and deduplicated findings in host-local state and does not change the observed run,
its tmux session, or its task store.

```bash
ao-topology observer targets --consumer /absolute/path/to/repository --json
ao-topology observer start --consumer /absolute/path/to/repository \
  --run /absolute/path/to/repository/.bytedesk/agent-orchestration/runs/<run-id> \
  --observer orchestration-observer --json
ao-topology observer watch --consumer /absolute/path/to/repository \
  --observer orchestration-observer --interval 5s --json
```

The observer reports non-breaking findings to the affected repository conductor for verification.
It reports breaking findings to both that conductor and the Marketplace conductor. These are durable,
non-assignment messages: only the Marketplace conductor may create or update the fingerprinted task
under the exact `Agent Orchestration Tasks` epic and dispatch a worker.

`start` waits for the observer's current prompt to be acknowledged by its exact managed tmux
process before it commits the attachment. The older `open` spelling aliases this same safe flow;
legacy v1 attachments cannot watch or report and must be started again.

Start the packaged agent from Claude Code as `orchestration-observer`, or install the supplied Codex
template as `orchestration_observer`. The agent first lists live runs and asks for a selection when
there is more than one; it does not infer the target from the current terminal.

## What it provides

- Capability and health discovery for each provider independently.
- Explainable routing and execution plans.
- One-shot and persistent provider sessions.
- Spawn, follow-up, wait, status, event, cancellation, and cleanup controls.
- Durable approval decisions for governed actions.
- A per-run **Agent Orchestration Session** on loopback. `orchestration_spawn` returns `session.url`;
  print that URL verbatim. The session host is one of the **managed services** below, so the page
  outlives the MCP process and comes back if the host dies. The host exchanges a one-use capability
  for a cookie, serves `dist/session-ui/`, and streams the hash-chained journal over SSE. The page can
  cancel, queue a follow-up, and settle an architecture decision for that run. Plan:
  `docs/plans/2026-08-22-orchestration-session.md`. A trusted local caller can ask for the same URL
  without a browser — see **Control seam for a trusted local caller**.
- A validated, lineage-aware roadmap and a shared skill for refining tasks, unlocks, trajectories,
  gaps, and goals without turning strategy into execution authority.
- Shared skills for Claude Code, Codex, Grok Build, and Kimi Code; a Claude/Grok orchestration agent;
  and an optional Codex custom-agent template.

The plugin does not turn a native Claude or Codex subagent into another provider. External provider
work exists only when the MCP server starts a provider execution.

## Managed services

The plugin keeps its standing processes running with
[process-compose](https://github.com/F1bonacc1/process-compose) (Apache-2.0), and restarts any that
die:

| Process | What it does |
|---|---|
| `session-host` | Serves the run session pages and the gateway's control seam. Also sweeps the state root for runs whose worker died, so lost runs are found even when no Claude or Codex session is open. |
| `nats` | The local NATS server, when no `AO_NATS_URL` is set and a working `nats-server` exists. It listens on `127.0.0.1:<nats.port>` (see below). |
| `supervise-<repo>` | One repository supervisor per registered repository: presence, census, prompt refresh, held mail, lead recovery. Not on native Windows, which has no tmux; `status` reports it as unsupported. |

**Which NATS ao uses (ADR-0032).** In order: `AO_NATS_URL`, then the gateway listener
(`orch.sock`), then ao's managed NATS on `nats://127.0.0.1:<nats.port>`. The generic `NATS_URL`,
`NATS_USER` and `NATS_PASSWORD` belong to other tools: ao ignores them and its supervisor says so
once at start. If `AO_NATS_URL` or `orch.sock` is unreachable, ao works on the managed NATS and tells
the repository lead (ADR-0031).

**The managed port is `nats.port` in your ao user config**
(`$XDG_CONFIG_HOME/agent-orchestration/config.json`, default `~/.config/agent-orchestration/config.json`).
The first managed start picks a free port from 45200–45999 (clear of the session host's 45000–45032
and process-compose's 45100–45199) and writes it there; an existing port in
`~/.bytedesk/agent-orchestration/nats/state.json` is adopted instead when it is free. Every later start
uses exactly that port. You may set it yourself: an integer from 1024 to 65535, then run
`agent-orchestration services ensure`. If another process holds the port, ao does **not** move: it
refuses to start NATS, names the port and (on Linux) the holding process in `services status --json`
(`nats.conflict`) and `doctor` (`NATS_PORT_CONFLICT`), and mails the repository lead. The generated
NATS user and password stay in `state.json` (mode 0600), never in the user config.

**Start or repair them:** `agent-orchestration services ensure`. You rarely need to run it: the
plugin's SessionStart hook and monitor run it, and so does anything that needs a session host or a
supervisor. It is idempotent. It:

1. downloads the pinned process-compose (`services/process-compose.lock.json`) into
   `~/.local/share/bytedesk/agent-orchestration/bin/` (`~/Library/Application Support/…` on macOS,
   `%LOCALAPPDATA%\ByteDesk\agent-orchestration` on Windows), and refuses it if its SHA-256 does not
   match;
2. points `current.json` there at the installed plugin, so a plugin update needs only a process
   restart;
3. writes `<state root>/services/process-compose.yaml`;
4. registers process-compose with the OS so it starts when you log in: a systemd user unit
   (`agent-orchestration.service`) on Linux, a LaunchAgent (`ai.bytedesk.agent-orchestration`) on
   macOS, or a scheduled task (`ByteDesk\agent-orchestration`) on Windows. Linux or WSL without a
   systemd user manager gets a detached process-compose that every `ensure` restarts if needed.
   Linger is not enabled, so the services run while you are logged in;
5. starts it if it is not answering, reloads the project if it changed, and restarts the processes if
   the plugin changed. A second run with nothing changed writes nothing.
6. keeps the other hosts on the same build (TM-284): it finds this plugin's Codex copy
   (`~/.codex/plugins/cache/bytedesk/agent-orchestration/…`), Grok install
   (`~/.grok/installed-plugins/agent-orchestration-*`) and the root `~/.kimi-code/mcp.json` names,
   and replaces any copy with an OLDER version by the services' plugin root. A copy at the same
   version but a different build fingerprint is replaced too (TM-299), unless it is the newer build.
   Builds are ordered by the ordinal each refresh records in the copy's `.ao-build.json` (the
   source's commit time at sync, or the newest `dist/` mtime outside git); a copy without that file,
   or whose file names another build, falls back to its bundle mtime. A newer version or a newer
   build is never overwritten, an equal ordinal is left alone, and so is the same build. The copy is built beside the old one and swapped in by rename, keeping the old
   copy's `node_modules`; it is refused when the source has uncommitted changes, when the copy lies
   inside a git checkout, or when the copy's `node_modules` does not satisfy the new
   `package.json` (run `npm ci` there). `install-orchestration-host` does the same from its root;
7. cleans up after earlier installs (TM-285): stops leaked `agent-orchestration-session-*.scope`
   units whose state root no longer exists, hands the managed state root over from a pre-services
   session host (a 24-hour scope or a hand-run host) and a detached `nats-server`, and never touches
   a scope whose state root exists and is not the managed one. It lists ao MCP servers still running
   an older build — by host and pid, with the advice to restart that session — and never stops them.

What step 6 and 7 found is printed by `ensure`, kept in `<state root>/services/self-heal.json`, and
shown by `services status --json` (`selfHeal`). `orchestration_doctor` reports stale MCP servers and
a `TMUX_TMPDIR` too long for tmux's socket (`diagnostics.setup.problems`). The SessionStart hook
also warns, with the exact fix, when the session's repository enables `agent-orchestration` or
`task-management` in its own `.claude/settings.json` — the same check that would otherwise block
the first `git commit`.

**Check them:** `agent-orchestration services status` (`--json` for every field) shows the OS
registration, whether process-compose answers, and each process's state, pid, restart count and
readiness. Logs are in `<state root>/services/logs/`. `--json` lists every managed process as
`{ name, pid, state, restarts, ready, exitCode }`; read a pid from there, never from `pgrep`.

**Restart or stop one process:** `agent-orchestration services restart <name>` and
`agent-orchestration services stop <name>`, where `<name>` is one `services status` lists
(`session-host`, `nats`, `supervise-<repo>`). Both go through the process-compose API, so they act
on exactly that managed process; an unknown name is refused. `restart` reports the old and new pid.
**Never `pkill`, `pgrep` or `kill` a managed process by name or command line:** dev machines run
unrelated processes with the same binary (microk8s runs its own `nats-server -c …`), and
process-compose restarts a killed child anyway.

**Remove them:** `agent-orchestration services uninstall` removes the OS registration and stops
process-compose. It keeps the binary and all state.

**Opt out:** `AGENT_ORCHESTRATION_SERVICES=0` restores the previous launchers: a 24-hour
`systemd-run --user --scope` session host on Linux (`AGENT_ORCHESTRATION_SESSION_SUPERVISOR=0` forces
in-process), a detached NATS server, and a detached supervisor. The same launchers are used, with a
message on stderr, when the services cannot be installed, for example on an offline first run.

`agent-orchestration session-host` run by hand exits 0 without starting a second host when a healthy
one already owns the state root.

## Requirements

- Node.js 22.13 or newer.
- One supported execution backend:
  - **Linux:** Bubblewrap (`bwrap`), `slirp4netns`, `/usr/bin/python3`, `/usr/bin/nsenter`
    (from `util-linux`), `prlimit`, and an active systemd user manager (`systemd-run --user`).
    Kernel namespace-owner lookup (`NS_GET_USERNS`, Linux 4.9 or newer) is required. The fixed
    network launcher uses Python's standard library and `nsenter` to attach the network helper
    to Bubblewrap's verified namespace owner; provider permissions and host policy stay unchanged.
  - **Windows native:** Windows 10 version 1809 or newer, .NET 8, AppContainer, and Job Objects.
  - **Windows with WSL2:** Node.js, Git, Bubblewrap (`bwrap`), `pasta` from the `passt` package,
    `unshare`, `prlimit`, and an active systemd user manager inside the distribution.
- On Windows, `AGENT_ORCHESTRATION_WINDOWS_BACKEND=auto` is the default. It uses the native backend
  when its health check passes, then falls back to WSL2. Set the value to `native` or `wsl` to
  require one backend. A required backend fails closed when a security dependency is missing.
- At least one authenticated provider CLI:
  - Claude Code for provider ID `claude` (also a host).
  - Codex for provider ID `codex` (also a host).
  - Grok Build for provider ID `grok-build` (`grok agent stdio`; also a host after plugin install).
  - Kimi CLI for provider ID `kimi` (`kimi acp`; also a host after `~/.kimi-code/mcp.json` wiring).

Providers are optional and independent. Run the doctor after installation to see which are ready.
Each candidate is admitted only after a bounded authenticated ACP session initialization; Kimi uses
that handshake directly because its CLI does not expose a separate non-mutating auth-status command.

## Platform architecture

The public MCP contract is the same on Linux, native Windows, and Windows through WSL2. The runtime
uses four small, replaceable design-pattern roles:

- An **Abstract Factory** selects one compatible set of sandbox, worker supervisor, and executable
  resolver implementations.
- **Strategy** implementations contain the operating-system behavior for those three services.
- A **Facade** gives the orchestration service one platform-neutral runtime API.
- The WSL2 **Adapter** translates Windows paths and launches the Linux runtime without changing the
  orchestration service or provider adapters.

This split keeps provider routing and lifecycle rules reusable. Adding another operating system or
isolation backend does not require a second orchestration implementation.

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
| Lifecycle | `orchestration_spawn`, `orchestration_run_followup` (alias `orchestration_send`), `orchestration_run_wait` (alias `orchestration_wait`), `orchestration_status`, `orchestration_list`, `orchestration_events` |
| Control | `orchestration_cancel`, `orchestration_cleanup` |
| Approval | `orchestration_decision_get`, `orchestration_decision_approve` |
| Durable mail | `orchestration_mailbox_send`, `orchestration_mailbox_receive`, `orchestration_mailbox_list`, `orchestration_mailbox_dispose`, `orchestration_mailbox_wait` |
| Run mail and roles | `orchestration_run_mail_send`, `orchestration_run_mail_reply`, `orchestration_run_mail_wait`, `orchestration_lead_status`, `orchestration_session_handoff` |
| Goal feedback | `orchestration_goal_start`, `orchestration_goal_status`, `orchestration_goal_report`, `orchestration_goal_control`, `orchestration_goal_reconcile` |

The [goal feedback controller](docs/goal-loop-runtime.md) drives a bounded PM, build, QA,
review, integration, validation of the landed artifact, test deployment, dogfood and assessment cycle through the existing
standing lead. Task Management retains the original goal and verifies deployed evidence.
It stops when that goal is proven, or presents a specific human decision when a limit or
authority gate prevents progress. NATS publication, recipient acceptance, message disposition,
task ownership and goal completion remain distinct facts.

Mail send requires an explicit source `consumerCwd`; optional `destinationConsumerCwd`
selects another admitted repository through the existing standing-mail routing rules.
Use `mailbox_list` to inspect without consuming. `orchestration_run_followup` (alias `orchestration_send`) means an
ACP child follow-up. Human goal controls are refused through MCP and use Gateway's
authenticated operator surface. This local bridge trusts the Gateway host process; it
does not protect against another process with the same OS account editing local state.

**What the approval gate guarantees.** `orchestration_decision_approve` is a state gate, not an
identity gate. It enforces repository authority, that the run is an architecture run waiting for a
decision, and that every evidence stage is present — and it records the act, with its rationale, in
the hash-chained journal. `approvedBy` is an unauthenticated string: nothing compares it to the run's
initiator, so an agent can call this tool and pass any name. What you get is a **stop-and-attest** —
the run cannot move without a separate explicit act that is permanently attributed — not a separation
of duties. The approval record says which it was: `via: "mcp"` with `by_attested: false` for a tool
call, `via: "session"` with `by_attested: true` for the loopback session UI, which is bound to
127.0.0.1, needs a 32-byte capability token this process minted, expires in ten minutes and can be
exchanged once — a path a headless agent has no way to reach. Set
`AGENT_ORCHESTRATION_REQUIRE_ATTESTED_APPROVAL=1` to accept only that path for architecture
decisions; the tool call is then refused with `AO_APPROVAL_REQUIRES_ATTESTED_CHANNEL`.

## Control seam for a trusted local caller

A program running on this host — the ByteDesk gateway, acting for an operator it has already
authenticated — can drive a run through the same loopback session a person would use. Nothing about
the session widens: it stays on 127.0.0.1, the capability is 32 bytes, it expires in ten minutes, and
it is exchanged once.

```bash
agent-orchestration session-open --run-id run_… --no-browser --json
```

Prints the capability URL as JSON (`--json`) or on its own line. `--no-browser` skips `xdg-open`,
which on a remote host would open a window nobody is sitting in front of. The caller exchanges the
URL for the session cookie and then POSTs to `/api/runs/{runId}/{cancel,follow-up,decision}` as usual.

Two refusals rather than a URL that disappoints later:

| Code | When |
|---|---|
| `AO_RUN_NOT_FOUND` / `AO_INVALID_RUN_ID` | before anything is minted, so no live token exists for a run that does not |
| `AO_SESSION_HOST_NOT_DURABLE` | no session host outlives the command, so its URL would stop answering the moment the command exits. Run `agent-orchestration services ensure`. |

**Who took the decision.** `POST /api/runs/{runId}/decision` accepts an `actor` label alongside
`approved` and `rationale`, recorded as the approval's `by` (capped at 120 characters, defaulting to
`operator`). A gateway passes the signed-in operator, so the record names a person rather than the
word "operator" for every approval it forwards. The label itself is still a name — `by_attested`
describes the channel, which is what this process can actually verify.

**Where a run came from.** Every run records two things about its own origin, both read from the
launching process's environment rather than accepted as input:

| Field | Meaning |
|---|---|
| `parentRunId` | the run whose worker spawned this one, from `AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID` |
| `launcher` | `kind` (`gateway-tab`, `tmux` or `agent`), the gateway tab id and session, the tmux pane and server, and the conductor: `ao-topology` agent id, role, session and topology run |

`launcher` is `null` when nothing identifies a launcher, so "started from somewhere we cannot name"
never reads as a binding we failed to record. A reader can then open the exact terminal a run was
started from instead of guessing from working directories.

Every mutating or consumer-grounded call requires `consumerCwd`: the explicit absolute path of the
repository or worktree the external agent may observe or change. The server never infers it from its
own process directory.

`orchestration_run_followup` (alias `orchestration_send`) creates a durable child run only when the parent was explicitly spawned with
`sessionMode: "persistent"`, stayed read-only, and the provider advertises durable session loading.
The child retains its own status, events, worker, and cancellation boundary. One-shot, unsupported,
and writable follow-ups fail closed; spawn a new scoped run instead.


## tmux topology layer (visible, interactive teams)

The broker above runs agents headless and sandboxed. The topology layer runs them **visibly in tmux
panes** — any installed CLI, one pane per agent, one agent conducting — for design tournaments,
competing reviews, and research fan-outs a human watches and steers. Full design:
[`docs/topology.md`](docs/topology.md).

```sh
bin/ao-topology doctor                                         # tmux, CLIs, search paths
bin/ao-topology workflows                                      # saved orchestrations
bin/ao-topology launch --workflow brand-identity-tournament \
  --input product=vault --consumer ~/GitHub/bytedesk-design-system
tmux attach -t brand-vault-<run_id>
```

- **Spec** — one JSON document (`ao-topology schema`): agents (id, role, cli, model, skills,
  instructions), ordered workflow stages, human gates, inputs. Natural language compiles into it
  through the `orchestration-compose` skill; a saved spec is a workflow.
- **Templates** — `design-studio` launches the ByteDesk design system’s own studio roles
  (director, hands, judge from `design-system-studio`) as three panes on separate provider
  chains; `logo-design` and `brand-identity-tournament` are the generic brand pipelines for
  repos without a studio; `parallel-review` fans one target out to independent reviewers.
- **Provider chains** — every agent names an ordered chain of `cli:model` candidates
  (`"candidates": ["claude:fable", "claude:opus", "codex"]`, or an input string). Launch walks
  the chain past missing CLIs and usage/rate/auth failures; `ao-topology failover --agent <id>`
  moves a running agent to the next provider and re-delivers its unanswered messages.
- **Provider adapters** — `providers/<cli>.json`: how to launch a CLI, pass a model, append a
  system prompt, auto-approve, and detect its idle prompt. Agents auto-approve by default (TM-214):
  a spec with no `auto_approve` key launches without permission prompts, `auto_approve: false`
  opts an agent out, and the reviewer always stays read-only. Unknown `cli` ids fall back to the
  generic adapter, so any installed CLI can be an agent.
- **Role packs** — `roles/*.md`: domain-free contracts for orchestrator, worker, designer, judge,
  reviewer, researcher, implementer. Domain skills (e.g. `brand-brief`, `brand-concept`,
  `brand-judge` from the design-system plugin) are referenced by name and read by the agent.
- **Prompt changes on a live agent** — `ao-topology agent restart <agent> --mode handoff|resume
  --json` applies a changed prompt to one running agent at a safe turn boundary (never mid-turn,
  never over typed input): `handoff` replaces the session and passes the predecessor's handoff,
  `resume` continues the same provider conversation where the provider supports it (Claude
  `--resume`) and otherwise falls back to `handoff` and says why. The reviewer is never restarted
  mid-review (`TOPOLOGY_AGENT_BUSY` while a review request is uncollected) and is relaunched fresh and
  read-only in either mode. `agent list --json` flags
  `restart_required` per agent. See [`docs/topology.md`](docs/topology.md#applying-a-changed-prompt-to-a-running-agent-agent-restart-tm-297).
- **Mailbox** — messages are files in `<run>/agents/<id>/inbox`, replies in `outbox`; tmux only
  types a one-line pointer. Every event lands in `journal.jsonl`.
- **Skills** — `orchestration-compose`, `orchestration-launch`, `orchestration-conduct` (the
  conductor's protocol), `orchestration-status`, `setup-agent-orchestration` (tmux per OS, CLI
  inventory, adding a CLI as an adapter).

Runs live under `<consumer>/.bytedesk/agent-orchestration/runs/<run_id>/`, which ignores itself. Tests:
`npm run test:topology` (unit) and `npm run test:topology:tmux` (real tmux with fake agents).
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

## Lead and worker autonomy: the shipped allowlist

Leads and workers run routine orchestration commands without a permission prompt and without an
auto-mode classifier round. You do not need to add global permission rules. The plugin ships this
as a `PreToolUse(Bash)` hook, `scripts/autonomy-allow.mjs`, wired in `hooks/hooks.json` (TM-369).

**Why a hook.** A plugin cannot ship permission allow rules: a plugin's `settings.json` applies only
`agent` and `subagentStatusLine` ([plugins reference](https://code.claude.com/docs/en/plugins-reference)).
A `PreToolUse` hook that returns `permissionDecision: "allow"` "bypasses the permission prompt"
([hooks](https://code.claude.com/docs/en/hooks)). On Claude Code 2.1.289 we checked this live, from a
plugin hook. In `default` mode, a hook-approved command ran and the same-shaped control was denied.
In `auto` mode, the debug log showed `Hook approved tool use for Bash, bypassing permission prompt`
with a 4 ms decision, against 534 ms for the classifier-reviewed control.

**What it approves.** It approves only one simple command, with no `;`, `&`, `|`, `<`, `>`,
backtick, `$`, backslash or newline anywhere. One exception applies: a trailing heredoc with a
quoted delimiter (`<<'EOF'`) is treated as data.

| Command | Approved |
|---|---|
| `ao-topology <verb> …` | Every verb except those in the gated list below |
| `agent-orchestration doctor\|status\|session-open`, `agent-orchestration services status\|ensure\|probe` | Yes |
| `tm <verb> …`, `.bytedesk/task-management/bin/tm <verb> …` | Every verb. This matches Ryan's `Bash(tm *)` decision of 2026-09-25 |
| `tmux [-L name\|-S path] capture-pane\|list-panes\|list-sessions\|list-windows\|has-session\|display-message -p …` | Read-only only. Not approved: `#(…)` formats, `display-message -I`, `-f` |

**What stays gated.** The hook never approves these commands. They go through the normal
permission flow (a prompt, or the auto-mode classifier). This keeps the authorization classes of
ADR-0001 (`fleet/docs/adr/0001-hierarchical-authorization.md`):

- **External (deploy and release):** `ao-topology manage cutover|cut-release|land`. See
  [Landing autonomy](#landing-autonomy-pr-merge-publish) below.
- **PR-level and landing:** `ao-topology manage integrate|record-landing|cleanup`. These verbs keep
  their own delegation checks. A lead that should run them unprompted gets the per-lead rules from
  `ao-topology permissions install` (see `docs/repository-leads.md`).
- **Operator-only:** `ao-topology delegate grant|revoke` and `ao-topology permissions …`.
- **Repo-destructive and external:** every `git`, `gh`, deploy and secrets command. This includes
  force pushes, history rewrites, branch deletion, releases, deploys and secret reads. None of these
  is on the list.
- **Anything compound:** for example, `tm board && git push --force` falls through as a whole.

**Boundaries.** The hook only ever answers "allow" or says nothing. It never blocks a command, and
any error falls through to the normal flow. Claude Code still applies your `deny` and `ask` rules
after a hook allows a command ([permissions](https://code.claude.com/docs/en/permissions#extend-permissions-with-hooks)).
Critical-path `rm` commands are still refused. Agents launched with `auto_approve` (the default,
TM-214) skip prompts entirely, so this hook matters for the sessions that do not: your own lead
session, and agents with `auto_approve: false`.

## Landing autonomy: pr, merge, publish

`management.autonomy` sets how far a repository's lead takes a reviewed task on its own (TM-368).
The lead runs one verb, `ao-topology manage land --task <TM-id>`, and the policy decides the rest.

| `management.autonomy` | What `manage land` does |
|---|---|
| `pr` (**default**) | Stops at the reviewed pull request. A human merges it. |
| `merge` | Runs `manage integrate`, with its own authority and guardrails unchanged. Nothing is released. |
| `publish` | Integrates, then, once every task of the task's epic has landed, runs `manage cut-release`: the repository's release step, a wait for the TeamCity build it started, and the verify step that proves the published artifact. It then records the publish and tells the origin. |

**Where to set it.** The value comes from the AO layered config. The nearest layer wins:
the repository's `.bytedesk/agent-orchestration/config.json`, then the global
`~/.config/agent-orchestration/config.json`, then the shipped default, `pr`. An unknown value makes
its layer invalid, so it never widens autonomy. To run fully autonomously through publishing on
your own machine, set it in the global layer:

```json
{ "management": { "autonomy": "publish", "ntfy": { "topic": "<your topic>" } } }
```

**What `publish` grants.** Production deploy and release publish are ADR-0001's External class
(`fleet/docs/adr/0001-hierarchical-authorization.md`). At `publish`, the policy is the operator's
standing grant for `manage cutover` and `manage cut-release`, so a lead needs no `--authorized`.
Every record names the grant: `authorization.channel` is `autonomy-policy`, and
`authorization.granted_by` gives the config layer and file that set `publish`. At `pr` or `merge`,
these verbs need `--authorized` from an operator shell; a managed agent session cannot self-assert
it. The policy does not replace integrate's own authority: merging still needs a covering plan
grant or the server-side `lead_autonomy` policy (ADR-0027).

**What the release verbs run.** Only the repository's own scripts, configured as argv and run
without a shell. A step whose program is `systemctl`, `git`, `gh`, a shell, `sudo`, `env` or `ssh`
is refused, so neither a lead nor a config line restarts a host or pushes directly.

```json
{ "management": {
  "cutover": { "branch": "develop", "argv": ["<skill>/scripts/deploy-safe.sh", "deploy"],
               "postflight_argv": ["<skill>/scripts/deploy-safe.sh", "postflight"],
               "identity_argv": ["<a command that prints the running build's identity>"] },
  "release": { "branch": "develop", "argv": ["<skill>/scripts/release-gitflow.sh", "start"],
               "verify_argv": ["<skill>/scripts/release-gitflow.sh", "verify"],
               "teamcity": { "build_type": "<the publish build configuration id>" } } } }
```

**Guardrails.** Both verbs refuse by name, and run nothing, unless every condition holds: the
config is valid, the authority above exists, the checkout is on the configured branch (default
`develop`), it has no uncommitted work outside the tool store paths, it equals `origin/<branch>`
after a fetch, and every task of the plan (`--epic`) is done. `cutover` proves the running binary
switched: `identity_argv` must answer before the deploy and answer differently after it.

**Stops and pages.** Each of these stops the run and pages the operator through ntfy:

- a red TeamCity build, or no finished build before `teamcity.timeout_ms` (default one hour);
- a failed postflight: the release verify step, or the cutover postflight;
- a missing reviewer approval, checked by `manage land` before it merges;
- a failed release or deploy step, and a release refused after the merge.

A plan with tasks still open is not a stop: `manage land` reports `waiting` and publishes when the
last task lands. Under `publish`, TeamCity is required: set `management.release.teamcity.build_type`,
and export `TEAMCITY_URL` (or set `teamcity.url`) and `TEAMCITY_TOKEN`. The adapter reads
`/app/rest/builds` with the token as a bearer header and never writes the token anywhere.

**ntfy.** agent-orchestration sends its own pages, so they work with task-management absent. The
topic comes from `AO_NTFY_TOPIC` or `management.ntfy.topic`, then task-management's
`TM_NTFY_TOPIC`. The token comes only from the environment: `AO_NTFY_TOKEN`, then `TM_NTFY_TOKEN`.
With no topic, the stop still happens and its result says the page was not sent.

**The origin.** When the task is a cross-repo ticket, a successful publish runs
`tm ticket event <id> published "<detail>"` (TM-359), which comments on the origin task and mails
the origin's lead.

**Known limit.** The global config file is writable by any process running as you, as are the
other same-user anchors documented in `docs/repository-leads.md`. A repository-layer edit cannot
grant `publish` silently: an uncommitted change to it fails the `dirty` guardrail.

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
- Every provider turn runs inside the selected platform sandbox with allowlisted system and provider
  files, a cleared environment, and a revocable provider bootstrap home. Linux and WSL2 use
  Bubblewrap with an empty root and fresh `/dev`. Native Windows uses a dedicated AppContainer with
  exact access-control entries. The consumer
  worktree is read-only for read runs and is the only writable project path for write runs; the
  `.git` marker and shared Git metadata are read-only. Per-turn provider scratch is a fresh tmpfs tree
  mounted directly at `/agent-orchestration-runtime` and is the only additional writable mount;
  broker control sources are never broadly exposed. The bundled Claude bridge disables user,
  project, and local setting sources so consumer hooks or MCP configuration cannot run during the
  credential-visible bootstrap.
  Native Linux uses `slirp4netns` for outbound networking from a separate namespace with host
  loopback disabled. WSL2 creates an outer mapped user namespace and uses `pasta` with gateway-to-host
  mapping and inbound port forwarding disabled. Native Windows grants only the AppContainer
  internet-client capability; it does not grant private-network or loopback capability.
- ACP client-side filesystem and terminal callbacks are denied because they execute in the broker,
  outside the provider sandbox. Provider-native tools remain governed by the declared read/write profile inside
  the sandbox. Ambient API-key and proxy variables are not forwarded through observable process argv.
- The hash-chained journal is the recovery authority for snapshots, terminal evidence is immutable,
  stale locks/breakers are reclaimable by owner identity, and a periodic supervisor watchdog detects
  workers lost after initial startup recovery.
- Workers and readiness probes run in an owned process boundary: transient systemd user scopes on
  Linux and WSL2, or Windows Job Objects with kill-on-close on native Windows. Provider descendants
  are reaped even if the Node leader exits. Spawn succeeds only after the worker acknowledges its
  exact active boundary; failed launches are quarantined.
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
MCP manifests             -> dist/host-launcher.cjs -> selected host backend -> dist/mcp.cjs
bin/agent-orchestration     -> dist/cli.cjs
bin/provider-sandbox        -> dist/provider-sandbox.cjs
native Windows sandbox      -> dist/windows-native/AgentOrchestration.Windows.dll
```

Build and verify:

```sh
npm ci
npm run build:all
npm run build:check
npm test
npm run test:contract
claude plugin validate .
```

`npm run build` rebuilds the JavaScript bundles. On Windows, `npm run build:windows-native`
publishes the .NET helper; on other systems it verifies that the committed Windows artifacts exist.
Set `AGENT_ORCHESTRATION_FORCE_WINDOWS_BUILD=1` only on a non-Windows cross-compilation host that is
prepared to target Windows. `npm run build:all` runs both checks. Release packages commit both sets
of artifacts so installed copies never build at startup.

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
