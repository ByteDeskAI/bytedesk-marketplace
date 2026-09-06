# Nested workflows, fan-out, and the templates → workflows rename

## Context

`agent-orchestration` 0.4.0 launches a team of agents into tmux panes and routes messages between
them through a mailbox. What it cannot do is **compose**: a spec cannot reference another spec. The
only composition today is `agents[].agent`, which pulls a stored *agent* from the repo library —
composition of people, not of workflows.

Nesting works *de facto* — verified by building a parent whose agent shells out to
`ao-topology launch`, which produced a real child run and tmux session. But it is entirely
unmodelled: the child's `run.json` carries no parent field, the parent's journal has no spawn event,
`stop` on the parent leaves the child orphaned, and nothing caps depth or detects a cycle.

One constraint shapes everything below. **The stage list is not executed.** `describeWorkflow`
(`topology/lib/launch.mjs:34`) renders stages as Markdown into the conductor's `BOOTSTRAP.md`; the
conductor is a model that reads them and drives them by sending mail. There is no scheduler in this
plugin and this change must not need one.

Outcome: a workflow can name another workflow as a participant, can fan one out across a list, and
the resulting tree is recorded, observable and tearable-down.

## Decisions taken

| Decision | Choice |
|---|---|
| How a child is addressed | **A participant in `agents[]`** — addressed by the conductor exactly like an agent |
| The `workflow:` field collision | Stage list renamed to **`stages:`**; `workflow:` kept as a deprecated alias |
| Rename scope | **Full** — directories, flags, output — reusing the existing legacy-path fallback |

## The shape

```jsonc
{
  "name": "release-review",
  "stages": [ { "stage": "brief", "from": "conductor", "to": ["reviewers"] } ],
  "agents": [
    { "id": "conductor", "role": "orchestrator", "candidates": ["claude:opus"] },

    // a TEAM as a participant — no cli, no pane, no provider
    { "id": "reviewers", "workflow": "adversarial-review",
      "inputs": { "target": "{{inputs.target}}" } },

    // fan-out: one child per item; addressed per-item or collectively as `per-file`
    { "id": "per-file", "workflow": "review-one",
      "for_each": "{{inputs.files}}", "inputs": { "file": "{{item}}" } }
  ]
}
```

The conductor's brief is unchanged in kind: `send --to reviewers`, `wait --from reviewers`. It never
learns that `reviewers` is four agents in another tmux session.

## Why this is mostly plumbing

Four things already exist that do the heavy lifting. **Reuse these rather than inventing.**

- **`sendMessage({runDir, …})` (`mailbox.mjs:98`) and `recordReply({runDir, agentId, messageId, body, token})`
  (`mailbox.mjs:289`) both take `runDir` as a parameter.** Writing into a *different* run's mailbox is
  already possible — no bridge daemon.
- **The delivery loop already tolerates a pane-less agent.** `cli.mjs:481` does
  `if (!agent?.pane) continue;`. The message is already written to the participant's inbox; only the
  tmux ring is skipped. **That `continue` is the single hook** — replace it with "if this is a
  workflow participant, forward into the child instead of ringing a pane."
- **`agents[].agent` is the precedent for a deferred-resolution entry** (`spec.mjs:100-112`): it
  tolerates a missing `cli`, records `_inline` so "inline overrides stored" stays decidable, and lets
  `materializeSpec` merge later — because validation "is synchronous and dirless". A `workflow:`
  participant is the same pattern with a different resolver, and `validate` must likewise **not**
  resolve the child.
- **`consumerResourceDirs(consumer, kind)` (`util.mjs:197`)** already returns
  `[<AO_HOME>/<kind>, <AO_HOME_LEGACY>/<kind>]` — new path then legacy, first wins.

## Work, smallest first

### 1 — Bookkeeping for the nesting that already happens
No new spec surface. Makes today's de-facto nesting observable and safe.

- `run.json` gains `parent` — `{ run_dir, run_id, agent_id, depth }`, null at the root.
  Written in the `run` object at `launch.mjs:510`.
- New env for every agent (`launch.mjs:380`): `AO_PARENT_RUN_DIR`, `AO_PARENT_AGENT_ID`,
  `AO_RUN_DEPTH`. A child launched by an agent inherits these, so the link is recorded even when a
  model shells out by hand.
- Journal: `run.spawned` on the parent, `run.child_exited` when a child reaches a terminal state.
- `--max-depth` (default 3) refusing `TOPOLOGY_DEPTH_EXCEEDED`; cycle detection over the ancestor
  chain refusing `TOPOLOGY_WORKFLOW_CYCLE`.
- `stop` (`cli.mjs:612`) cascades: walk children, stop each, then the parent. `--no-cascade` opts out.

### 2 — `workflow:` as a participant
- **`spec.mjs`**: validate the new entry shape next to the `agent:` handling (`:100-112`). A
  participant has `workflow` (string), optional `inputs` (map), no `cli`/`candidates`/`model`.
  Reject a participant that also names a cli. The "exactly one orchestrator" rule (`:228`) counts
  only pane-ful agents.
- **`launch.mjs`**: after panes are assigned (`:587`), launch each participant's child run —
  recursively `launchRun` with `parent` set, the participant's own `inputs`, and the child's session
  named from the parent. Participants get `pane: null`, `candidates: []`, and a new
  `workflow: {name, run_dir, session, conductor}` block in their `run.agents` entry.
- **`cli.mjs:481`**: the forward branch described above.
- **Reply direction**: the parent mints the participant's token as it does for any agent
  (`token_sha256` at `:510`) and injects the raw value into the child conductor's launcher env as
  `AO_PARENT_AGENT_TOKEN`. The child conductor answers with
  `ao-topology reply --run $AO_PARENT_RUN_DIR --agent $AO_PARENT_AGENT_ID --token $AO_PARENT_AGENT_TOKEN`.
  This satisfies `recordReply`'s lookup (`mailbox.mjs:300-312`) unchanged.
- **Bundled fix**: `--token` is named in `recordReply`'s own error text but was never wired
  (`cli.mjs:525-532` calls `recordReply` without it). Wire it — it is required here anyway, since the
  child conductor already holds its *own* `AO_AGENT_TOKEN` for its own run.
- **Child bootstrap** gains a short section: who your parent is, and the exact reply command.

### 3 — `for_each` fan-out
- `for_each` accepts an array or a comma-separated string (matching how `candidates` already accepts
  both, `spec.mjs:~123`). `{{item}}` and `{{item.<key>}}` interpolate per child.
- Children are addressed `<id>.<slug-of-item>` individually and `<id>` collectively; a send to the
  bare id fans out to all, and `wait --from <id>` is a barrier over all of them.
- Cap the fan-out width (`--max-fanout`, default 8) — ten panes was measured at 9.6s, but ten *runs*
  is ten tmux sessions.

### 4 — Guards on the consumers of `run.agents`
Judged against the grep, not assumed. Already tolerant: `cli.mjs:479-486` (skips pane-less),
`mailbox.mjs:112/132/221/302/339/360/381` (id lookups only). Need a branch:

- `launch.mjs:587` — do not assign a pane to a participant.
- `launch.mjs:769` (`failoverAgent`) — refuse on a participant with a clear message; failover is a
  provider concept and a team has no provider.
- `cli.mjs:537` (`capture`) and `nudge` — refuse with "that is a workflow, not a pane; use
  `status --run <child run dir>`".
- `mailbox.mjs:245` (`wait` default targets) — participants are non-orchestrator so they are already
  included, which is correct.
- `status` — render a participant as a nested block with the child's state and its own queue depth.

### 5 — The rename
- `AO_HOME` kinds gain `workflows` with `templates` as the legacy sibling, via
  `consumerResourceDirs`. Plugin dir `templates/orchestrations/` → `workflows/`, old path still read.
- `--workflow` becomes canonical, `--template` still accepted and undocumented. `templates` command
  → `workflows`, old name aliased.
- Spec field `workflow:` (stages) → `stages:`; accept both, and have `validate` emit a deprecation
  note when it sees the old one. Note `run.json` also persists `workflow:` (`launch.mjs:519`) — write
  `stages` and keep reading either.
- Update: the four shipped specs, the nine showcase specs in `.bytedesk/agent-orchestration/`,
  `skills/*/SKILL.md`, `docs/topology.md`, and `task-management/lib/dispatch/topology.mjs` if it
  names a template.

## Verification

Run everything from `agent-orchestration/` — several tests resolve paths from `process.cwd()`.

1. `node --test tests/unit/*.test.mjs` — 249 tests. Add cases for: participant validation, cycle and
   depth refusals, `for_each` expansion, and both spellings of the stage field.
2. `bash tests/live/two-projects.sh` — 65 assertions, no model needed. Must stay green; it is the
   regression net for the mailbox and identity work this touches.
3. `npm run test:contract` — note this is **red today** for an unrelated reason (TM-112: the fixture's
   ready pattern spans a line break). Fix or exclude that before relying on it as a gate.
4. **New live case, no model required**, modelled on `two-projects.sh`: a parent whose participant is
   a child workflow, both on the `generic` adapter running `cat`. Assert: two tmux sessions; the
   child's `run.json` names its parent; `send --to <participant>` lands in the child conductor's
   inbox; a reply from the child satisfies `wait --from <participant>` in the parent; `stop` on the
   parent kills both; a self-referencing workflow is refused; depth 4 is refused.
5. Manual: `ao-topology launch --workflow release-review --dry-run --json` shows the child plan
   without launching; `status` renders the nested block; `journal` shows `run.spawned`.

## Risks

- **Fan-out multiplies tmux sessions, not panes.** Ten children is ten sessions on the shared server.
  The width cap matters more than the depth cap.
- **A child conductor is a model.** Nothing forces it to reply to its parent, so the parent's barrier
  can time out for reasons no guard can prevent — `wait --timeout` is the only backstop, and the
  child's bootstrap must be unambiguous about the reply obligation.
- **Orphaning is the failure mode to test hardest.** A parent killed with `kill -9` cannot cascade;
  the `AO_PARENT_RUN_DIR` env + `parent` in `run.json` are what make an orphan findable afterwards.
- The rename is silent-breakage-prone; the legacy fallback must be in the same commit, with a test
  asserting a `templates/` directory still resolves.
