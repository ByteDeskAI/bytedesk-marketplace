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
| Templates | `templates/orchestrations/*.json`, `~/.config/agent-orchestration/templates/`, `<repo>/.orchestration/templates/` | Reusable specs. Earlier locations override later ones by name. |
| Provider adapters | `providers/*.json` plus the same user/consumer overrides | How to launch one CLI: command, model flag, system-prompt flag, auto-approve flag, idle-prompt regex, failure patterns, submit keys. Unknown `cli` ids fall back to `generic` with the id as the command, so any installed CLI works. |
| Role packs | `roles/*.md` plus overrides | The abstract, domain-free part of an agent's instructions: what an orchestrator, worker, designer, judge, reviewer, researcher, or implementer owes the run. |
| Skills | resolved by name from the consumer repo, the user's home, and this plugin | Domain knowledge an agent must read before working (for example `brand-brief`, `brand-concept`, `brand-judge` from the design-system plugin). Nothing is copied; agents are told which SKILL.md files to read. |
| CLI | `bin/ao-topology` → `topology/cli.mjs` | Launch, send, wait, reply, capture, nudge, status, journal, stop, doctor, templates, providers, compose, validate, runs. Dependency-free ESM; no bundle step. |
| Skills for hosts | `skills/orchestration-*`, `skills/setup-agent-orchestration` | Thin clients of the CLI for whichever host (Claude, Codex, Grok, Kimi) the human is talking to. |

## A run on disk

```
<consumer>/.orchestration/runs/<run_id>/
  run.json              materialized spec + pane ids + state + message sequence
  journal.jsonl         append-only events: run.created, agent.started, message.sent, message.replied, wait.*, agent.nudged, run.stopped
  artifacts/            shared deliverables; conductor/ holds briefs, decisions, GATE-*.md, REPORT.md
  agents/<id>/
    BOOTSTRAP.md        identity, mailbox protocol, skills to read, role pack, (conductor) workflow + gates + commands
    launch.sh           generated launcher: cd, env, exec <argv>  — never a shell string built from spec text
    inbox/NNN-<stage>.md
    outbox/NNN-<stage>.reply.md
```

`.orchestration/runs/` belongs in the consumer's `.gitignore`. Promotion of anything into a
canonical tree is a human step the conductor recommends in `REPORT.md`.

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
5. In each pane run `bash launch.sh`; wait for the adapter's idle-prompt regex (or its fixed
   delay); type the bootstrap pointer.
6. Print the run dir, session, per-agent readiness, warnings, and the attach command.

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
