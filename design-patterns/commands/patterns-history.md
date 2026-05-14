---
description: Recall this project's pattern memory — prior scans, decisions, and applied refactors
argument-hint: "help | [\"<force or topic>\"] [--path <path>] [--limit <n>]"
---

# Patterns History

Parse `$ARGUMENTS` into a `patterns_recall` MCP call.

Help behavior:

- `/patterns-history help`, `/patterns-history --help`, or `/patterns-history -h` returns help only.
- Help must include purpose, usage, options, examples, and the backing MCP tool.
- Do not call `patterns_recall` when the user asks for help.

Argument mapping:

- First quoted or unflagged text: `query` — optional architecture force or topic. When supplied, prior ADR decisions matching that force are surfaced first under `matchedDecisions`.
- `--path <path>`: optional file or directory. When supplied, the most recent scan of that path is included under `lastScan`.
- `--limit <n>`: optional cap on how many recent events to return. Defaults to 20.

Inference behavior:

- Every argument is optional. With no arguments, return the full memory summary for the project.
- Do not ask for arguments just because they are missing.
- The response reports whether memory is `project`-scoped (a `.claude/plugins/design-patterns/` journal committed in the current repo) or `global` (a per-user fallback used when the working directory is not a project). Lead the answer by stating which mode is in effect.

Examples:

```text
/patterns-history
/patterns-history "provider dispatch"
/patterns-history --path backend/app/providers
/patterns-history "duplicate delivery" --limit 40
```

Report what the project already knows: project-vs-global mode, recorded ADR decisions and their statuses, patterns already applied and where, and recent scans and recommendations. When a `query` was supplied, lead with any matching prior decisions so the user builds on them instead of re-deciding. There is no `patterns_record` slash command — durable outcomes are written by the skills (`patterns memory record` / the `patterns_record` MCP tool), not by users.
