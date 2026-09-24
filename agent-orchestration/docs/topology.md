# Topology layer: tmux-hosted orchestrations

The topology layer is the second runtime in this plugin. The MCP broker (`dist/mcp.cjs`) runs
provider turns headless inside a sandbox and returns structured results; the topology layer runs
visible, interactive agent CLIs in tmux panes and lets one of them conduct the others. They share
vocabulary and a versioned explicit-workflow discovery index. Their native snapshots, journals,
permissions and execution remain separate: the topology layer does not inherit the ACP sandbox.

Use the broker for untrusted, autonomous, writable work against product repositories. Use the
topology layer when a human wants to watch and steer a team in real time — design tournaments,
competing reviews, research fan-outs. Topology agents run without their own permission prompts
by default (TM-214), so the safety boundary is the containment below plus a disposable or watched
repository, not the prompts.

## Pieces

| Piece | Path | What it is |
|---|---|---|
| Spec | JSON, see `ao-topology schema` | One declarative document: agents, stages, gates, inputs. Natural language compiles into it; a workflow is a saved one. |
| Workflows | `workflows/*.json`, `~/.config/agent-orchestration/workflows/`, `<repo>/.bytedesk/agent-orchestration/workflows/` | Reusable specs. Earlier locations override later ones by name. Every location is also searched under its former name `templates/`, and `<repo>/.orchestration/` is still read, so a repo laid out the old way needs no migration. |
| Provider adapters | `providers/*.json` plus the same user/consumer overrides | How to launch one CLI: command, model flag, system-prompt flag, auto-approve flag, idle-prompt regex, failure patterns, submit keys. Unknown `cli` ids fall back to `generic` with the id as the command, so any installed CLI works. |
| Agents | `.bytedesk/agent-orchestration/agents/<id>/` in the consumer, plus the same user/plugin overrides | A durable per-repo roster. Each agent has a stable minted id, a generated name and title, a role, a provider chain, skills, MCP servers and an optional file-backed system prompt. A spec may reference one instead of restating it. |
| Role packs | `roles/*.md` plus overrides | The abstract, domain-free part of an agent's instructions: what an orchestrator, worker, designer, judge, reviewer, researcher, or implementer owes the run. |
| Skills | resolved by name from the consumer repo, the user's home, and this plugin | Domain knowledge an agent must read before working (for example `brand-brief`, `brand-concept`, `brand-judge` from the design-system plugin). Nothing is copied; agents are told which SKILL.md files to read. |
| CLI | `bin/ao-topology` → `topology/cli.mjs` | Launch, send, wait, reply, capture, nudge, status, journal, stop, doctor, workflows, providers, compose, validate, runs. Dependency-free ESM; no bundle step. |
| Skills for hosts | `skills/orchestration-*`, `skills/setup-agent-orchestration` | Thin clients of the CLI for whichever host (Claude, Codex, Grok, Kimi) the human is talking to. |

## A run on disk

```
<stateRoot>/repositories/<canonical-repo-key>/topology/runs/<run_id>/
  run.json              materialized spec + pane ids + state + message sequence
  journal.jsonl         append-only events: run.created, agent.started, message.sent, message.replied, wait.*, agent.nudged, run.stopped
  artifacts/            shared deliverables; conductor/ holds briefs, decisions, GATE-*.md, REPORT.md
  agents/<id>/
    BOOTSTRAP.md        identity, mailbox protocol, skills to read, role pack, (conductor) workflow + gates + commands
    launch.sh           generated launcher: cd, env, exec <argv>  — never a shell string built from spec text
    inbox/NNN-<stage>.md
    outbox/NNN-<stage>.reply.md
```

`stateRoot` is `AGENT_ORCHESTRATION_STATE_HOME`, or
`${XDG_STATE_HOME:-~/.local/state}/bytedesk/agent-orchestration`. The repository key is the first
16 hex characters of SHA-256 of the canonical Git common-directory path. Linked worktrees share
this durable control location. `run.json` separately records `consumer`, `workload_cwd`, and
`write_authority`; provider directory grants keep those original limits. A requested spec
`run_dir` is retained as migration metadata; the producer chooses durable storage at launch.
The producer selects that location before rendering template variables. The native record keeps
the original recipe, resolved roster definitions, inputs and instruction-file source. Retry
renders these retained sources for its new run ID and path; literal task prose is not rewritten.
Legacy attempts without that recipe hold retry with `TOPOLOGY_RETRY_UNAVAILABLE`. Their evidence
remains available, and a reviewed saved workflow can start a separate attempt.
The existing `run.json` and `journal.jsonl` formats remain authoritative. Admitted failed launches
also retain a record, error code, and whether session creation was attempted.

`ao-topology console list --consumer <repo> --json` reconciles the shared discovery index. It
includes ACP runs and named topology workflows, including generated task workflows. Standing
lead/reviewer services and standalone terminals do not contribute workflow rows or counts.
Native run directories and legacy records in the main checkout and registered linked worktrees
are discovered; corrupt or foreign records produce separate `rejected` diagnostics. Unchanged
record contents are cached; changes to a journal also advance the index revision.

Before Task Management removes an owned worktree, run
`ao-topology console preserve --consumer <repo> --worktree <owned-worktree> --json` and require
`ok: true`. Terminal legacy records are copied to durable storage with an exact original tree in
`legacy-evidence/` and a SHA-256 file manifest in `preservation.json`. The active native record
receives canonical metadata, so it remains discoverable after the source worktree is removed.
The preservation step rejects active or uncertain runs, symlinks, changed copies, and conflicting
history. It never deletes the worktree or evidence. Retention is the default; do not infer missing
native history from transcripts.

All five per-repo resource types — workflows, skills, roles, providers and agents — resolve from
`<repo>/.bytedesk/agent-orchestration/<kind>/`, with `<repo>/.orchestration/<kind>/` read as a
fallback so a repository laid out under the old convention keeps working. Writes always use the
new path.

## Agents, identity, and the team

An agent used to exist only as an inline entry in a spec's `agents[]` array, alive for one run. It
is now a resource type like workflows, skills, roles and providers, stored per repository under
`.bytedesk/agent-orchestration/agents/<id>/` and resolved through the same four-tier search path.

```
ao-topology agent new --role lead --cli claude     # mint one
ao-topology agent list                             # the roster, by name and title
ao-topology agent show "Mira Halloran"             # by id, by full name, or by "Name, Title"
```

**Two identifiers, different jobs.** An agent gets a short **id**, minted once at creation and
never changed. It is the address every machine surface uses: tmux session names, mailbox paths,
routing predicates, delegation tokens, journal events, spec `agents[].id`. It also gets a **first
name, last name and a title** derived from its role — `Mira Halloran, Engineering Lead`. That is
what people see. The two are generated independently: the id takes nothing from the name, so a name
collision can never disturb an address, and a name is checked against the existing roster before it
is handed out.

The rule about never showing the id is scoped to *human* interaction. Journals, session names,
message envelopes, event payloads and agent-to-agent traffic all carry the id, deliberately.

**One lead per repository**, enforced at creation rather than by convention. A lead is the repo's
front door and may be `coordinates_only`, which is a capability rather than an instruction. Three
things follow mechanically: work cannot be delegated to one; it is launched with **no directory
granted at all**, including any a spec tried to supply, so its own agent directory is the only
writable path it has; and its adapter's `coordinator_args` withhold its write tools.

Be precise about how far that goes. For Claude, `Bash` is deliberately *not* denied — the conductor
delegates by running `ao-topology send`/`wait`/`reply`, so denying it would break the role. The tool
flag is defence in depth; **the containment that actually holds is the withheld directory grant**.
Three adapters declare a verified coordinator form (claude, codex, gemini); the rest declare an
empty one and name their candidate flag in `notes` rather than guessing, and a coordinator whose
adapter declares nothing produces a warning saying exactly what is and is not containing it.

## Runs and role-sessions

There are three ways an agent can be running, and they answer different questions.

A **run** is spawned, worked and torn down. `launch` builds a team from a spec, gives every agent a
pane, and `stop` ends it. The unit of identity is the run, and the session is named for what ran and
when: `<spec name>-<run id>`.

A **spawn** is a run of exactly one agent drawn from the repo's library — which is what `tm dispatch`
produces, and the common "send this agent to do that" shape. Its session is named for *who* is
running: the agent's stable id plus a per-spawn discriminator, `<agent id>-<9f3e21a>`. Stable agent,
distinct spawns — so two concurrent dispatches to the same agent are separately addressable, and
`tmux ls` answers who rather than only what. `parseSessionName` resolves the name back to both
halves, which is how `session list` files live spawns under the agent that owns them.

The discriminator is seven hex characters shaped like an abbreviated git sha. **Its uniqueness scope
is live sessions on this host** — the scope tmux itself enforces — so `launch` probes for a free
name rather than trusting the entropy, and gives up loudly rather than colliding.

Two cases stay run-addressed on purpose. A team has no single agent to name it after. And an agent
declared inline in a spec has no stable id to offer: an id written into a spec file is a label local
to that file, not an address, so two unrelated specs both saying `id: "worker"` would collide into
one session name. A spec that sets `session` itself is always honoured — that is a requirement being
stated, and launch does not guess over it.

A **role-session** is a named workspace you *call*. It is keyed to the agent's stable id — never to
a run — so it outlives the process that opened it, and opening one that is already live reattaches
to the same pane rather than starting a rival. A lead that loses its identity on restart is not a
lead.

```
ao-topology session open "Mira Halloran"   # create, or reattach if it is already up
ao-topology session list                   # which of this repo's agents are live
ao-topology session close "Mira Halloran"  # end the session; the agent survives it
```

The session's cwd is the agent's own directory, which is what gives it memory of its own under
every CLI that keys session state by working directory; the repo is granted explicitly through the
adapter's `add_dir_args`, and a `coordinates_only` agent is granted nothing beyond its own
directory.

**The record is the restore contract.** `session.json` lives beside the agent, never inside a run
directory that will be torn down, and it names one idempotent command. That matters because the
gateway restores a tab by reattaching when the tmux session is still alive but **rebuilds from the
tab record's stored `Command`** when it is gone — so a role-session started by any other command is
silently recreated as something else. Start one through `session open`, or through the `command` in
its record. Nothing else.

A spec entry may reference a stored agent instead of restating it, with any inline field
overriding the stored definition:

```json
{ "agents": [ { "agent": "Mira Halloran", "cli": "codex" } ] }
```

## Talking across repositories

Two repositories each have their own roster, their own lead and their own task store. A message
that crosses that boundary is routed **at the mailbox**, not by trusting whoever composed it:

- **Same project** — delivered as addressed.
- **Addressed to the lead** — delivered. The lead is the front door.
- **Covered by a delegation** — delivered directly to the named agent.
- **Anything else** — redirected to the lead, with the original addressee preserved in the envelope
  as `intended_for`, a `route.redirect` journal event, a note in the delivered message explaining
  why it arrived, and an acknowledgement to the sender. A message that silently changes recipient is
  the failure this layer exists to avoid, so a redirect is loud without being an error.

**A delegation token is a pointer, not a permission.** The permission is the `tm` claim it names,
and that claim lives in the *receiving* repo's own task-management store — the one store the sender
cannot forge. Every use re-reads it off disk, so closing the task revokes the delegation with no
revocation step anywhere:

```
ao-topology delegate --task TM-500 --to "Hana Fairbairn" --for <outside-agent-id>
```

A `via` chain travels in the message frontmatter and stops both re-forwarding and lead-to-lead
loops, with a hop limit. And an agent may only write its own outbox: each agent's launcher exports
a secret that `reply` checks, so `--agent <id>` is no longer a claim taken on trust, and an empty
reply file no longer satisfies a waiting barrier.

The whole arrangement is exercised end to end against two real repositories by
`tests/live/two-projects.sh`.

## Safety boundaries

Agents run without their own permission prompts by default (TM-214), so the prompts are no longer
this layer's safety boundary. What is guarded:

- **A spec may not expand workload authority outside the repository that invoked it.** `cwd` and the requested `run_dir` are
  contained to the consumer; `/`, `~` and `../../other-repo` are refused. A spec is data, often
  committed data, so a path it supplies is untrusted input. `--allow-outside` is the deliberate
  exception.
- **Stopping requires the native record.** Session names alone are insufficient. The producer
  checks the server, session creation, pane and process identities; stops only exact owned panes;
  and confirms their absence before recording `stopped`. A changed binding or partial child stop
  returns a failure with retained evidence. Repository lead and reviewer role sessions are outside
  the run and survive its stop.
- **`auto_approve` is on by default (TM-214).** An agent whose spec or template has no
  `auto_approve` key launches with its provider's `auto_approve_args` (claude:
  `--dangerously-skip-permissions`), so it runs without its own permission prompts. Set
  `auto_approve: false` on an agent to keep them. Every launch, dry run included, warns and names
  the agents affected. `--allow-auto-approve` is accepted and has no effect. The repository
  reviewer is the exception: its stored `auto_approve` is always `false`, it launches only
  read-only (`--restricted --safe-mode`), and `session open` refuses it — use `reviewer ensure`.

## Provider chains and failover

Anywhere a spec names a provider it names an ordered chain: `"candidates": ["claude:fable",
"claude:opus", "codex"]` (or one comma-separated string, so an input can supply it). `cli` +
`model` alone is a chain of one.

At launch, each agent walks its chain: a candidate whose command is not on PATH is skipped; one
that comes up but whose screen matches the adapter's `failure_patterns` (usage limit, rate
limit, quota, login, unauthorized…) or whose pane exits is recorded as failed and the next is
tried in a respawned pane. The first that reaches its idle prompt (or survives its fixed delay)
gets the bootstrap pointer. `run.json` records the chain and the active index; `status` shows
`on <provider> [chain: …]`.

Task Management's `worker_guard` binds task identity, branch and ownership hook to every
candidate. Claude receives that hook regardless of the other providers in the chain. Codex and
Grok topology candidates remain visibly held where no measured ownership hook exists; the
producer never launches them without the guard or replaces the current member to test a guess.
Governed launches also refuse a second live or uncertain writer in the same task worktree.

Mid-run, `ao-topology failover --agent <id>` repeats that walk from the next candidate (or a
named one with `--to`), re-sends the bootstrap, and re-rings every unanswered inbox message so
the new provider resumes from the mailbox rather than from memory. The conductor's protocol
calls it when a wait times out and the screen shows a limit; the journal records
`agent.candidate_failed`, `agent.failover`, and `agent.failover_complete`. Because the message
of record is a file, a provider swap loses nothing except in-flight terminal context.

### Before the first launch: a CLI that wants a human

Some CLIs will not start unattended until a person has answered something once, and no amount of
retrying helps. The two that bite in practice:

- **Claude's folder-trust question.** Launching into a directory Claude Code has never seen opens
  *"Is this a project you created or one you trust?"* with **No, exit** / **Yes, I trust this
  folder**. Nothing can answer it from the launcher.
- **A login screen**, on a machine where the CLI has never been signed in.

The launcher detects both and stops in about five seconds with the sentence you need — *"Answer it
once in a normal terminal (cd into the agent's cwd and run `claude`, choose 'Yes, I trust this
folder'), then launch again"* — rather than sitting out the adapter's full readiness timeout and
reporting `ready pattern not seen`. These are the adapter's `attention_patterns`, checked before the
generic failure list because the operator's action is completely different from a provider outage;
the next candidate in the chain is still tried, because a different CLI may have no such prompt.

**Trust every directory your agents will run in before the first launch.** An agent gets its own
`cwd` — that is what gives it its own memory — so a five-agent run can involve five directories
Claude has never seen.

When a launch times out for any other reason, read `<run>/agents/<id>/pane.log`. `pipe-pane` is
attached before the shell is touched, so it holds everything the pane ever drew, including a modal
that has since been cleared.

## Messaging

Files first, tmux second. `ao-topology send` writes the message into each recipient's inbox with
frontmatter (id, from, to, stage, round, contract, reply_to), appends a journal event, then types a
one-line pointer into the recipient's pane. The pointer is a doorbell; the file is the message.
`wait` polls for the reply files and prints them. `capture-pane` is for humans and for the
conductor when a wait times out — never the channel of record.

This is what makes the layer portable across CLIs: every agent can read a file and write a file.
The only CLI-specific knowledge lives in the adapter.

## Launch sequence

1. Load and validate the spec; resolve inputs (`--input k=v`, defaults); render placeholders.
2. Resolve each agent's adapter, skills, and role pack; collect warnings (missing skill, generic
   fallback, missing role).
3. Write `run.json`, bootstrap files, and launchers.
4. Create the tmux session with the conductor in the main pane; split or open windows for the
   rest (`main-vertical`, `grid`, or `windows`).
5. In every pane at once, `exec bash launch.sh`; wait for readiness; type the bootstrap pointer.
   Agents start concurrently — a serial launch cost `agents x ready-time`, so one slow CLI used to
   delay everything behind it.
6. Print the run dir, session, per-agent readiness, warnings, and the attach command.

### Readiness, death, and why pane geometry is a correctness property

Readiness is a **subscription**, not a poll. One control-mode client per session holds a
`refresh-client -B` subscription per pane, and the tmux server pushes a line only when the
subscribed format's value actually changes. A quiet pane costs nothing, and ten agents cost what
three do. Death arrives the same way: a session-wide `pane-died` hook records `#{pane_dead_status}`
— the process's real exit code, readable only because `remain-on-exit` is set on the pane before
anything can die. `pipe-pane` attaches before the shell is touched, because it only ever sees what
is written after it attaches, and what comes before is precisely the part that says why an agent
never came up.

The consequence to know about: **the readiness search runs over what a pane renders, line by line.**
A ready pattern wider than the pane is wrapped across two rendered lines and can never match — the
agent then reports not-ready and pays its full timeout, with nothing in the log explaining it. So
the session takes ownership of its own geometry: it pins `window-size manual` on itself and sizes
the window for the size of the team. Without that, on a shared tmux server the window inherits the
size of whatever unrelated session's terminal the server last saw; a 220x60 request came out 93x20
here, which left the stacked panes twelve columns wide.

Two rules follow for anyone touching this layer. A ready pattern belongs in the provider JSON as
`tmux_pattern`, declared separately from the JS `pattern` — tmux's `#{C/r:}` and JavaScript's
`RegExp` are different languages with a misleading overlap, and `{`, `}` and `:` break the tmux one
outright. And never set `window-size` globally: this tmux server is shared with every other session
on the machine.

### Approved automatic failover

Automatic native failover requires both `failover.consent: "auto"` and an ordered
`failover.approved_providers` list in the repository configuration. For Gateway, use
`["claude", "codex"]` and Task Management's `dispatch.topologyCandidates: "claude,codex"`.
The native candidate list must stay within that order. Omit model names to use each CLI's
configured model. A successful takeover publishes `agent.failover_applied` with the actual
provider. Task ownership guards remain a separate requirement: guarded Codex candidates hold
until that provider has measured ownership protection. This setting does not change standing
lead or reviewer providers.

## Operating systems

tmux and the file mailbox are the only runtime requirements, so the layer runs wherever tmux
runs: Linux, macOS, WSL2, MSYS2. `ao-topology doctor` detects the platform and package manager
and prints the install command; the `setup-agent-orchestration` skill walks a user through it and
through registering an extra CLI as an adapter.

## Extending

- **New CLI**: add `providers/<id>.json` (copy `generic.json`, fill flags and an idle-prompt regex).
- **New role**: add `roles/<name>.md`; reference it as `role` in a spec.
- **New team shape**: write a spec (or ask `orchestration-compose`) and save it as a workflow.
- **Domain knowledge**: ship skills in the domain's own plugin and reference them by name.

## Relationship to the broker roadmap

AO-GOAL-001 (terminal mission control), AO-COL-001 (typed message envelopes), and AO-COL-006
(live team topologies) describe, in broker terms, what this layer does with files and tmux. The
journal event shape here is deliberately compatible so a future TUI can render both.

## Persistent repository services (0.6)

See [repository-leads.md](repository-leads.md) for the current lifecycle, configuration, prompt,
standing-mailbox and Presence v1 contracts. Supported coding-agent workflow adapters declare
`requires_repository_readiness`; their governed launch fails before creating panes when the lead
or reviewer is unavailable. Native and hookless observation remains labeled pending enrollment.
The standing-mailbox ledger is authoritative for held/external messages; run barriers track its
pending/reply state. Do not infer satisfaction from the absence of a run inbox file.

## Gateway discovery and control contract

The private producer index is `<stateRoot>/workflow-index/v1/<repo-key>/index.json`:

```json
{
  "schemaVersion": 1,
  "revision": "14",
  "repository": { "id": "/repo/.git", "key": "sha256-prefix", "root": "/repo" },
  "updatedAt": "2026-09-22T12:00:00Z",
  "workflows": [{
    "workflowId": "topology:20260922-example",
    "runtime": "topology",
    "nativeRunId": "20260922-example",
    "repositoryId": "/repo/.git",
    "repositoryRoot": "/repo",
    "workflowName": "tm-TM-123",
    "taskId": "TM-123",
    "lineage": { "parentWorkflowId": null, "retryOfWorkflowId": null, "rootWorkflowId": "topology:20260922-example" },
    "recordPath": "/state/repositories/key/topology/runs/20260922-example/run.json",
    "recordFormat": "topology.run.v1",
    "workloadCwd": "/worktrees/TM-123",
    "writeAuthority": { "worktree": "/worktrees/TM-123", "branch": "task/TM-123" },
    "state": "running",
    "createdAt": "2026-09-22T11:00:00Z",
    "updatedAt": "2026-09-22T12:00:00Z",
    "revision": "4"
  }],
  "rejected": []
}
```

ACP rows use `runtime: "acp"`, `workflowId: "acp:<native run ID>"` and
`recordFormat: "acp.snapshot.v1"`. Existing ACP URLs retain their native run ID. Revisions are
decimal strings. The index is discovery metadata, never permission to control an arbitrary path.
`nativeRevision`, `journalRevision` and `legacySourcePath` are additive diagnostic fields.

The CLI provides `console list`, `console show --workflow-id <id>`, `console workflows`, and
`console control --request-file <json>`. Each requires explicit `--consumer <absolute-path>`.
`show` returns `{workflow, run, messages, events, independentReview, inspection}` with bounded message bodies and a safe native
summary; it excludes launch scripts, environment and reply capabilities. `workflows` returns
`{schemaVersion:1, workflows:[{name,description,inputs,path}]}`. Launch accepts a saved name from
that list, then resolves inputs and normal producer admission on the server side.
`independentReview` is a read-only producer validation of the task's exact reviewed revision,
request nonce, reviewer incarnation, patch scope and independent authors. Missing or invalid
evidence is shown as unavailable/waiting with no accepted verdict. `status` is `approved` (only
minor, nit or note findings remain), `changes-requested`, `blocked`, `awaiting-review`, or `failed` (no
wake reached the reviewer; the lead was told and a new request replaces it). It is separate from the run's
`human_decisions` and does not itself authorize integration.
`inspection` reports exact observed `sessionAlive`, `observedAt`, `error`, and member `alive`
values. Unknown ownership uses null liveness and an error. It never rewrites recorded run state.

A control request has this envelope:

```json
{"schemaVersion":1,"action":"stop","workflowId":"topology:20260922-example","actor":{"id":"authenticated-user","sessionId":"gateway-session"},"idempotencyKey":"unique-request","expectedRevision":"4","payload":{}}
```

| Action | Payload | Resulting boundary |
|---|---|---|
| `launch` | `workflowName`, `inputs` | Saved workflow only; actor session records its initiator. |
| `message` | `to` member IDs, `body`, optional `stage` | Publication and observed delivery are separate results. |
| `review` | `decision` (`approve` or `reject`), source `revision`, `note` | Human decision only; independent review and integration remain required. |
| `failover` | `agentId`, optional `to` candidate | Exact current ownership and each candidate's permission guard apply. |
| `stop` | `{}` | Confirmed exact termination, retained files, visible partial failures. |
| `retry` | `{}` | Existing attempt must be stopped/terminal; a new native ID records `retry_of`. |

`expectedRevision` binds the request to the discovery row. Review payload `revision` names the
exact source commit or artifact revision reviewed; it is a different value. A human approval
does not become an independent reviewer verdict or authorize integration. Retry preserves the
saved workload and write authority. ACP controls continue through the ACP producer.
Nested retries use their original child recipes, and missing child evidence holds instead of
substituting the current saved template. Provider scratch directories move with the new attempt;
the workload cwd and checkout authority remain the same.

Mutations record actor and request ID in the journal. Duplicate identical requests return the
saved result. Reusing a key for different content fails; a request interrupted before recording
completion remains `TOPOLOGY_CONTROL_UNCERTAIN` until inspected. Success returns
`{ok,action,workflowId,requestId,revision,result}`. JSON errors return `{ok:false,code,message,details}`
and exit 1. Failure details from launch include `run_dir`, `run_id`, `state`, `retained` and
`retry_safe`; session creation uncertainty always makes `retry_safe` false.
