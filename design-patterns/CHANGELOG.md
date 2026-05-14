# Changelog

All notable changes to the `design-patterns` plugin are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this plugin adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] — 2026-05-14

Minor release: cross-session **pattern memory**. The plugin used to be entirely
stateless — every call reloaded the catalog and returned JSON, ADRs were printed
but never saved, scans were ephemeral. It now remembers what it found,
recommended, decided, and what refactors were applied, and reads that memory
back so its answers build on prior work instead of repeating it. Tracked as the
BDM-52 epic.

### Added

- **`lib/pattern_memory.py` (BDM-54):** the persistence + recall layer — an
  append-only JSONL journal at `<project-root>/.claude/plugins/design-patterns/`
  (with a per-user global fallback when the working directory is not a project
  repo). Writers (`record_scan` / `record_recommendation` / `record_decision` /
  `record_decision_status` / `record_applied` / `record_edit`) never raise;
  readers fold the journal into current decisions, a scan diff, an
  applied-pattern index, and a one-stop recall summary.
- **`patterns_record` + `patterns_recall` MCP tools (BDM-55):** record durable
  outcomes (applied refactors, ADR status changes) and recall what the project
  already knows. Dispatched dynamically — no `handle_request` change.
- **`/patterns-history` slash command (BDM-57):** the user-facing recall
  surface, backed by `patterns_recall`; registered in `SLASH_COMMAND_HELP`.
- **`patterns memory` CLI subcommands (BDM-56):** `where` / `recall` / `record`
  / `render` on `bin/patterns`, respecting the existing `--json` convention.
- **PostToolUse capture hook (BDM-56):** `hooks/hooks.json` +
  `hooks/event-emitter.sh` + `hooks/record_edit.py` drop a coarse "edit"
  breadcrumb into the journal on `Edit` / `Write` / `MultiEdit`. Never blocks a
  tool call.
- **Markdown ADR + index renderers (BDM-58):** every recorded decision or
  applied refactor regenerates `decisions/NNNN-slug.md` and `index.md` from the
  journal — deterministic, so a re-render is a git no-op.
- **`docs/adr/0001-pattern-memory.md`:** the design record for this feature.
- **`tests/test_pattern_memory.py`, `tests/test_mcp_memory.py`,
  `tests/smoke-memory.sh`:** unit, MCP-dispatch, and CLI/stdio coverage for the
  memory layer.

### Changed

- **Memory-aware skills (BDM-57):** all six skills now consult
  `patterns memory recall` before advising; `pattern-application` records the
  applied refactor afterward, `architecture-decision` records ADR status
  transitions, `architecture-issue-scan` leads with the scan `memoryDiff`.
- **Auto-capture in the existing surfaces (BDM-55 / BDM-57):** `patterns_scan`
  and CLI `scan` attach a `memoryDiff` (new / resolved smells vs the last scan of
  that path) and record the scan; `patterns_adr` and CLI `adr` record the ADR
  and surface its `adrNumber`; `patterns_recommend` surfaces `priorDecisions`
  plus a `memoryHint` when the project already has decisions for a related
  force.
- **`tests/test_catalog.py`:** isolates pattern-memory side effects to a
  throwaway dir so regression runs never touch the real journal.

### Build

- Version bumped `0.8.6` → `0.9.0` across `.claude-plugin/plugin.json`,
  `.codex-plugin/plugin.json`, `lib/pattern_mcp_server.py` (`SERVER_INFO`), and
  `lib/workbench_views.py`; the marketplace manifest's `design-patterns` entry
  and top-level version move in lockstep.

## [0.8.6] — 2026-05-14

Baseline: the plugin as onboarded into `bytedesk-marketplace` (BDM-53) from
`ByteDeskAI/design-pattern-references` — prior history lives in that repository.
At this version the plugin is entirely stateless: a source-neutral Markdown
catalog (120+ patterns plus playbooks, recipes, smells, frameworks, languages,
scorecards, snippets, taxonomy), an MCP server, 10 slash commands, 6 skills, the
`pattern-architect` agent, and a dynamic Python-backed workbench.
