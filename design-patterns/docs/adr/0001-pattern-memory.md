# ADR-0001: Cross-session pattern memory — a project-scoped, hybrid JSONL + Markdown journal

## Status

Accepted — 2026-05-14

## Context

Through `0.8.6` the `design-patterns` plugin was **entirely stateless**. Every
MCP call reloaded the Markdown catalog and returned JSON; `/patterns-adr`
generated an ADR seed and printed it; `/patterns-scan` reported smells and
forgot them. Nothing it learned about a codebase survived the call.

The ask (BDM-52): make the plugin *remember* — what smells it found, what was
recommended, what decisions were made, what refactors were actually applied —
and, crucially, **read that memory back** so future calls build on prior work
instead of repeating it. Memory that is only written is a log; memory that is
also read is what makes the plugin "smarter."

Two shaping constraints emerged:

1. **The MCP server never sees `Edit` / `Write`.** It only sees what it is
   *asked*. So it can capture *advice* (a scan ran, an ADR was drafted) but not
   whether a recommended refactor was actually *applied* — that happens through
   Claude's edit tools, outside the plugin.
2. **The six skills drive the CLI, not the MCP tools.** Every `SKILL.md`
   declares `allowed-tools: … Bash(patterns *)`. Any capture story that only
   covered the MCP tools would miss all skill-driven work.

## Decision

A persistent **project journal** the plugin both writes to and reads from.

### Where memory lives

Project-scoped, at **`<project-root>/.claude/plugins/design-patterns/`** in the
*consuming* project — not in the plugin's own checkout, and not (the sibling
`fleet` plugin's choice) under `${CLAUDE_PLUGIN_DATA}`. When the working
directory is not inside a project repo, it falls back to a per-user global
location keyed by a hash of the cwd.

```text
<project-root>/.claude/plugins/design-patterns/
├── journal.jsonl     append-only event stream — the source of truth
├── decisions/NNNN-slug.md   rendered ADR markdown (derived)
├── index.md          "patterns we have & where" (derived)
└── journal.err       swallowed write errors (best-effort)
```

### Storage format — hybrid

`journal.jsonl` is the **single source of truth** and the only thing code
mutates — append-only, one event per line (`scan`, `recommendation`,
`decision`, `applied`, `edit`). `decisions/NNNN-slug.md` and `index.md` are
*rendered* from it, deterministically, so a re-render is a git no-op.

### Capture seam — three parts

- **Auto-capture** inside `patterns_scan` / `patterns_adr` / `patterns_recommend`
  (and their CLI equivalents) — records the *advice* at zero workflow friction.
- **An explicit `patterns_record` tool / `patterns memory record` CLI** the
  skills call after a refactor actually lands — the only honest capture of an
  *outcome*.
- **A `PostToolUse` hook** on `Edit` / `Write` / `MultiEdit` — a coarse "edit"
  breadcrumb. It cannot know *which* pattern (intent is in the conversation, not
  the tool input), so it complements `patterns_record`, never replaces it.

### Recall + the smart loop

`patterns_recall` (and `/patterns-history`) read the folded journal. The
existing tools consult it: `patterns_recommend` surfaces an already-`accepted`
ADR for the same force instead of re-deciding; `patterns_scan` diffs against the
last scan of that path; the `pattern-application` skill checks whether a module
already had a pattern applied.

## Rationale

### Why project-scoped, not `${CLAUDE_PLUGIN_DATA}`

This is the deliberate inverse of `fleet`'s ADR-0002. `fleet` state is
*ephemeral session machinery* (tmux panes, PID locks, event offsets) that nobody
wants in their repo and that *should* die on `/plugin uninstall`. Design-pattern
memory is the opposite: **durable architectural knowledge** — "we chose Strategy
for provider dispatch, here is the ADR" — that must survive uninstall, be
code-reviewed in PRs, and travel to teammates. That is exactly what `docs/adr/`
directories exist for, and exactly what the user meant by "remember what *we*
have." The global fallback keeps ad-hoc CLI use working when there is no repo.

### Why a hybrid JSONL + Markdown store

- Append-only JSONL is lock-free and concurrency-safe; tailers tolerate partial
  lines. Status changes are *new events*, never edits — no in-place mutation.
- Rendered Markdown ADRs are the human- and PR-facing surface and match the
  plugin's Markdown-native catalog.
- A pure-JSONL store would lose the reviewable decision record; pure Markdown
  would make status transitions an editing/merge problem; SQLite would put an
  unreviewable binary in git.

### Why the capture seam is three parts

No single seam is sufficient. Auto-capture is friction-free but blind to
outcomes. The hook is automatic but semantically coarse. Only an explicit
skill-invoked `record` call captures "Strategy was applied to `providers/ai.py`,
verified, links ADR-3." All three together cover advice, file churn, and real
outcomes.

### Why writers never raise

A memory-write fault (a read-only dir, a full disk) must never break a
`patterns_*` tool call. Every writer routes through `_append`, which swallows
its own errors to `journal.err`; the MCP server wraps memory calls in
`_safe_memory` as a second layer; the hook's bash wrapper has a `trap 'exit 0'`.

## Consequences

### Positive

- The plugin owns durable, reviewable, team-shared architectural memory that
  survives `/plugin uninstall` and travels with the repo.
- Every surface — MCP tools, CLI, skills, the hook — feeds one journal.
- Existing tools get measurably smarter (prior decisions, scan diffs) with no
  new user action required.

### Negative

- Adds a committed `.claude/plugins/design-patterns/` directory to consuming
  repos. Teams that do not want it can `.gitignore` it; the plugin still works
  (it just stops being team-shared).
- `render()` rewrites all decision files on every recorded decision/applied
  event — O(n) per write. Acceptable: these are not hot paths and the journal
  is small (tens to low-hundreds of events per project).

### Neutral / operational

- Memory resolution reads `$PWD`; outside a project repo it falls back to
  `${CLAUDE_PLUGIN_DATA:-~/.claude/plugins/data/design-patterns}/projects/<hash>/`.
- The plugin's own test suite (`tests/test_catalog.py`) isolates memory side
  effects to a throwaway dir so test runs never touch a real journal.

## References

- BDM-52 — epic: onboard `design-patterns` to the marketplace + cross-session
  pattern memory.
- BDM-54 — `lib/pattern_memory.py` core module.
- BDM-55 — MCP server integration (`patterns_record`, `patterns_recall`,
  auto-capture, the recommend smart loop).
- BDM-56 — `patterns memory` CLI subcommands + the PostToolUse capture hook.
- BDM-57 — `/patterns-history` command + memory-aware skills.
- BDM-58 — Markdown ADR / index renderers + ADR status lifecycle.
- `fleet/docs/adr/0002-plugin-data-directory.md` — the contrasting decision to
  put *session* state under `${CLAUDE_PLUGIN_DATA}`.
