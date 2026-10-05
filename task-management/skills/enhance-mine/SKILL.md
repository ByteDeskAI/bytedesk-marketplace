---
name: enhance-mine
description: Mine what already happened — Claude transcripts, the board, pool.log and test logs — for recurring errors, workarounds and user complaints, then file bugs as tasks and enhancements as CAP proposals, deduped against the board. Use when the user runs /enhance-mine, says "mine the transcripts", "what keeps going wrong", "find issues automatically", "what are agents working around", or wants a weekly evidence sweep feeding /enhance.
user-invokable: true
argument-hint: "[--apply] [--days 14] [--top 15] [--min-count 2] [--test-log <file>]"
---

# Enhance — mine

[[enhance-research]] looks outward and at the code. This step looks at **what actually
happened**: the errors agents hit, the workarounds they reached for, and the corrections people
typed. Everything here is evidence with a count, not an opinion.

**Dry-run is the default.** Nothing is written until you pass `--apply`.

## Run it

```bash
.bytedesk/task-management/bin/tm enhance-mine                 # dry-run: coverage + ranked themes
.bytedesk/task-management/bin/tm enhance-mine --json          # the same, machine-readable
.bytedesk/task-management/bin/tm enhance-mine --apply         # file, comment, remember
```

| Flag | Default | Meaning |
|---|---|---|
| `--days N` | 14 | transcripts changed in the last N days; done tasks updated in that window |
| `--top N` | 15 | how many ranked themes to act on |
| `--min-count N` | 2 | occurrences before a theme is filed (board findings always qualify) |
| `--test-log <file>` | none | a test run's output; repeatable |
| `--project <dir>` | store root | whose transcripts to read |

## Sources

Each source reports its own coverage — files, entries, findings — or `skipped: <reason>`. A
source that ran and found nothing reads `0 file(s)`, never `skipped`, so an empty run and a
missing source cannot be confused. **Read the coverage block before trusting an empty theme
list.**

| Source | Where | What counts |
|---|---|---|
| transcripts | `~/.claude/projects/<root with / and . as ->*/**/*.jsonl` | `is_error` tool results; error codes (`TOPOLOGY_*`, `"code":"unknown_recipient"`); Bash workarounds (`tmux send-keys`, `sleep N`, `mailbox inbox`, `capture-pane`); short user messages that correct or complain |
| board | the store | in-progress tasks past `staleMinutes`; done tasks with no evidence |
| pool | `<store>/pool.log` | failure lines (optional) |
| tests | `--test-log` | `not ok` / `FAIL` lines (optional) |

Transcripts are streamed a line at a time; partial lines and unknown entry types are skipped and
counted, never fatal.

## Ranking

Findings cluster by signature — `error-code:<CODE>`, `tool-error:<tool>: <first line>`,
`workaround:<kind>`, `user:<theme>`, `board:<why>:<id>` — and score
`frequency × severity × userPain`. Errors weigh 3, user themes and board findings 2,
workarounds 1. userPain is 3 when a person said it, 2 for an error in a session where a person
also complained, otherwise 1.

## What --apply does

| Theme | Result |
|---|---|
| errors and refusals (`error-code`, `tool-error`, `pool`, `test`) | a task via `tm task new` with `--ac` and an evidence summary — so the store's create gate applies (an active epic is needed) |
| workarounds and user themes | a CAP proposal (`source: enhance-mine`) with acceptance criteria, ready for [[enhance-track]] |
| board findings | a comment on that task |
| a theme already on the board | a `tm comment` with the new evidence count, not a new item |

**Dedupe** matches by the `enhance-mine:<signature>` line stamped into every filed body, then by
title overlap with hand-filed items. The newest evidence seen per signature is kept in
`.bytedesk/task-management/enhance-mine.json` (git-ignored: it reflects one machine's
transcripts). A re-run with nothing newer files nothing and comments nothing; new evidence adds
one comment per signature per run. A refused create (no active epic, WIP limit) is reported as
`refused: <reason>` and retried next run.

**Redaction** happens at ingestion, before any signature, sample or title is derived:
`key: value` pairs whose key names a secret, `password`/`passwd`/`pwd` phrases, GitHub
(`gh[pousr]_`), OpenAI-style (`sk-`), Slack (`xox*`) and AWS keys, JWTs, private-key blocks, and
long hex or base64 runs. Over-redaction is the intended failure mode.

## Weekly schedule

Do not install a cron job for the user; offer one of these.

- In a Claude Code session: `/loop 7d /enhance-mine` (dry-run), reviewing before any `--apply`.
- From cron, in the project checkout:
  `0 9 * * 1  cd /path/to/repo && .bytedesk/task-management/bin/tm enhance-mine >> .bytedesk/task-management/enhance-mine.log 2>&1`

Keep scheduled runs dry; apply by hand after reading the themes.

## After a run

Present the coverage block and the top themes. Then hand off: bugs to [[board]], CAPs to
[[enhance-propose]] for sizing and [[enhance-track]] to accept. **Do not implement** a mined
finding unless the user names it.
