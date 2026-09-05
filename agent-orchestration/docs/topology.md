# Topology layer: tmux-hosted orchestrations

The topology layer is the second runtime in this plugin. The MCP broker (`dist/mcp.cjs`) runs
provider turns headless inside a sandbox and returns structured results; the topology layer runs
visible, interactive agent CLIs in tmux panes and lets one of them conduct the others. They share
vocabulary (roles, stages, a JSONL journal) and nothing else: no sandbox, no ACP, no catalog lock.

Use the broker for untrusted, autonomous, writable work against product repositories. Use the
topology layer when a human wants to watch and steer a team in real time — design tournaments,
competing reviews, research fan-outs — and the agents' own permission prompts are the safety
boundary.

## Pieces

| Piece | Path | What it is |
|---|---|---|
| Spec | JSON, see `ao-topology schema` | One declarative document: agents, workflow, gates, inputs. Natural language compiles into it; a template is a saved one. |
| Templates | `templates/orchestrations/*.json`, `~/.config/agent-orchestration/templates/`, `<repo>/.bytedesk/agent-orchestration/templates/` (legacy `<repo>/.orchestration/templates/` is still read) | Reusable specs. Earlier locations override later ones by name. |
| Provider adapters | `providers/*.json` plus the same user/consumer overrides | How to launch one CLI: command, model flag, system-prompt flag, auto-approve flag, idle-prompt regex, failure patterns, submit keys. Unknown `cli` ids fall back to `generic` with the id as the command, so any installed CLI works. |
| Agents | `.bytedesk/agent-orchestration/agents/<id>/` in the consumer, plus the same user/plugin overrides | A durable per-repo roster. Each agent has a stable minted id, a generated name and title, a role, a provider chain, skills, MCP servers and an optional file-backed system prompt. A spec may reference one instead of restating it. |
| Role packs | `roles/*.md` plus overrides | The abstract, domain-free part of an agent's instructions: what an orchestrator, worker, designer, judge, reviewer, researcher, or implementer owes the run. |
| Skills | resolved by name from the consumer repo, the user's home, and this plugin | Domain knowledge an agent must read before working (for example `brand-brief`, `brand-concept`, `brand-judge` from the design-system plugin). Nothing is copied; agents are told which SKILL.md files to read. |
| CLI | `bin/ao-topology` → `topology/cli.mjs` | Launch, send, wait, reply, capture, nudge, status, journal, stop, doctor, templates, providers, compose, validate, runs. Dependency-free ESM; no bundle step. |
| Skills for hosts | `skills/orchestration-*`, `skills/setup-agent-orchestration` | Thin clients of the CLI for whichever host (Claude, Codex, Grok, Kimi) the human is talking to. |

## A run on disk

```
<consumer>/.bytedesk/agent-orchestration/runs/<run_id>/
  run.json              materialized spec + pane ids + state + message sequence
  journal.jsonl         append-only events: run.created, agent.started, message.sent, message.replied, wait.*, agent.nudged, run.stopped
  artifacts/            shared deliverables; conductor/ holds briefs, decisions, GATE-*.md, REPORT.md
  agents/<id>/
    BOOTSTRAP.md        identity, mailbox protocol, skills to read, role pack, (conductor) workflow + gates + commands
    launch.sh           generated launcher: cd, env, exec <argv>  — never a shell string built from spec text
    inbox/NNN-<stage>.md
    outbox/NNN-<stage>.reply.md
```

The runs directory ignores itself: a `.gitignore` containing `*` is written into
`.bytedesk/agent-orchestration/runs/` the first time a run is created there. That matters because
`.bytedesk/` is a tree these repositories deliberately commit — task-management's store is tracked —
so without it every mailbox file and launcher script would land in a diff, in a repository that
adopted orchestration after its `.gitignore` was written. Promotion of anything into a canonical
tree is a human step the conductor recommends in `REPORT.md`.

All five per-repo resource types — templates, skills, roles, providers and agents — resolve from
`<repo>/.bytedesk/agent-orchestration/<kind>/`, with `<repo>/.orchestration/<kind>/` read as a
fallback so a repository laid out under the old convention keeps working. Writes always use the
new path.

## Agents, identity, and the team

An agent used to exist only as an inline entry in a spec's `agents[]` array, alive for one run. It
is now a resource type like templates, skills, roles and providers, stored per repository under
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

The agents' own permission prompts are this layer's safety boundary, so two things are guarded
around them:

- **A spec may not launch outside the repository that invoked it.** `cwd` and `run_dir` are
  contained to the consumer; `/`, `~` and `../../other-repo` are refused. A spec is data, often
  committed data, so a path it supplies is untrusted input. `--allow-outside` is the deliberate
  exception.
- **`auto_approve` removes the boundary entirely**, so it requires explicit consent:
  `--allow-auto-approve`. Without it a spec requesting it refuses to launch, on the dry-run path
  too, naming the agents affected.

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

Mid-run, `ao-topology failover --agent <id>` repeats that walk from the next candidate (or a
named one with `--to`), re-sends the bootstrap, and re-rings every unanswered inbox message so
the new provider resumes from the mailbox rather than from memory. The conductor's protocol
calls it when a wait times out and the screen shows a limit; the journal records
`agent.candidate_failed`, `agent.failover`, and `agent.failover_complete`. Because the message
of record is a file, a provider swap loses nothing except in-flight terminal context.

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

## Operating systems

tmux and the file mailbox are the only runtime requirements, so the layer runs wherever tmux
runs: Linux, macOS, WSL2, MSYS2. `ao-topology doctor` detects the platform and package manager
and prints the install command; the `setup-agent-orchestration` skill walks a user through it and
through registering an extra CLI as an adapter.

## Extending

- **New CLI**: add `providers/<id>.json` (copy `generic.json`, fill flags and an idle-prompt regex).
- **New role**: add `roles/<name>.md`; reference it as `role` in a spec.
- **New team shape**: write a spec (or ask `orchestration-compose`) and save it as a template.
- **Domain knowledge**: ship skills in the domain's own plugin and reference them by name.

## Relationship to the broker roadmap

AO-GOAL-001 (terminal mission control), AO-COL-001 (typed message envelopes), and AO-COL-006
(live team topologies) describe, in broker terms, what this layer does with files and tmux. The
journal event shape here is deliberately compatible so a future TUI can render both.
