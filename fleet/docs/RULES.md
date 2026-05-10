---
description: Rules for the fleet multi-session Claude system — hooks, skills, dashboard, authorization model. Source-of-truth for the OSS-extractable fleet subsystem.
alwaysApply: false
globs:
  - .claude/hooks/**
  - .claude/skills/fleet-*/**
  - scripts/woodpecker-cli.py
  - scripts/claude-sessions/**
---

# Fleet Rules

This file is the single source of truth for rules that apply to the **fleet** multi-session Claude system. The fleet system is intended for OSS extraction; consolidating its rules here keeps the extraction surface clean — when the system is split out, this file moves with it as-is.

Scope of "fleet":

- `.claude/hooks/*` — PreToolUse / PostToolUse / SessionStart / etc. gates
- `.claude/skills/fleet-*/*` — fleet-* skills (`fleet-spawn`, `fleet-review`, `fleet-tournament`, `fleet-chain`, `fleet-cleanup`, `fleet-wait`)
- The `claude-sessions` dashboard / `spawn-claude-feature` launcher (currently `~/.local/bin/`, vendored under `scripts/` per BDP-366)

If a rule applies only to ByteDesk-specific concerns (Jira ticket conventions, Helm topology, .NET stack), it does **not** belong here. Put it in `general.md`, `backend.md`, `project-management.md`, etc.

## Authorization model

Authorization in the fleet tree is **hierarchical** — see [ADR-0046](../../docs/architecture/adr/0046-hierarchical-fleet-authorization.md). The act of spawning a child session **is** the authorization for that child's bounded actions. Per-action human authorization only applies at the root (depth 0).

Every gated action falls into one of four classes:

| Class | Examples | Auth rule |
|---|---|---|
| Local-blast | file edits, commits, lints, test runs | No gate |
| PR-level | open PR, comment, review, **merge**, label | Depth-aware: `depth==0` → human in transcript; `depth≥1` → inherited from spawn |
| Repo-destructive | force push, branch delete, history rewrite | Always require human, regardless of depth |
| External | production deploy, secret rotation, outbound webhook/email | Always require human + per-action explicit authorization |

When adding a new fleet hook or skill that gates an action, declare its class and apply the matching rule. Do not invent ad-hoc authorization checks.

## PR merge authorization (PR-level gate)

`gh pr merge` is the canonical PR-level gate. The hook at `.claude/hooks/pr-merge-guard.sh` enforces, at depth 0, two paths:

- **STRICT.** If the user's most recent message contains a specific PR# in any recognized form (`#N`, `merge N`, `PR N`, `pull/N`), the command's PR# must match. This catches the "merge #999 in the message but the model runs `gh pr merge 346`" mismatch.
- **BARE** (BDM-11 loosened policy, 2026-05-09). If the user's message contains NO specific PR#, a bare word `merge` (e.g. `merge`, `merge it`, `merge them all`, `please merge`, `yes merge`, `go ahead and merge`) authorizes whatever PR the command names. The trade-off: the user is implicitly trusting whichever PR the model chose to merge. The historical "vague approval" rule (rejecting `ship it` / `merge them` even with one open PR) was tightened to "rejecting only when negation is present."

The bare path does NOT fire when the message contains:
- `don't merge` / `do not merge` / `never merge`
- `merge conflict` (compound noun, not imperative verb)

Other phrasings without the literal word `merge` (`ship it`, `approve it`, `yes`, `lgtm`) still block. The loosening is specifically the word `merge`.

**Fleet child sessions (depth ≥ 1):** the parent agent's spawn act is the authorization. The transcript-based human-auth check is skipped and `gh pr merge` is allowed without per-PR confirmation. Unchanged.

Mechanically enforced by `.claude/hooks/pr-merge-guard.sh` (PreToolUse on Bash). The hook reads `CLAUDE_SESSION_DEPTH` from the environment to decide which rule applies. Bypass forms — `gh pr merge --squash <N>` (flag-before-number) and bare `gh pr merge` (PR inferred from current branch) — are caught at depth 0 by extracting the last bare-digit token from the command and falling back to `gh pr view --json number` to resolve the branch's PR.

Test fixture: `.claude/hooks/tests/test-pr-merge-guard.sh` — run it before changing the hook.

## Hook conventions

When adding or modifying a fleet hook:

- Place hooks under `.claude/hooks/`. Place tests under `.claude/hooks/tests/` and exercise both happy paths and fail-safe blocks.
- Hooks must **fail safe** — when state required for a decision (transcript, env var, external lookup) is missing or unreadable, default to block (`exit 2`) on safety-relevant gates and to allow (`exit 0`) on observability-only hooks. Document the choice in the hook header.
- Read `CLAUDE_SESSION_DEPTH` from the environment to detect fleet children. Do not read it from any other source — `spawn-claude-feature` is the only authoritative writer.
- Wire hooks into `.claude/settings.json` under the appropriate event matcher. Keep matchers tight (e.g. `"matcher": "Bash"` rather than `".*"`) so unrelated tool calls aren't slowed by hook execution.

## Spawn discipline

When spawning a child session via `spawn-claude-feature` or a `fleet-*` skill:

- Pass `--parent <BDP-N>` so the dashboard tree shows the parent-child relationship.
- Pass `--max-cost` and `--max-runtime` only if you have a justified reason to override the default. Hardcoded literal caps in fleet skills are a code smell — see BDP-368 for the self-tuning replacement.
- Recursion is capped at `--max-depth 2` by default. Raising the cap requires explicit `--allow-recursion` and should be justified in the spawn prompt.
- Children opening their own PRs are allowed to merge them at depth ≥ 1 (per ADR-0046). Spawn prompts that explicitly disallow merging should say so in plain text — the hook itself does not enforce parent-imposed restrictions today.

## Event observability

The fleet system emits structured events to `~/.claude-sessions/<TICKET>.events` (JSONL) for tool-level activity (review posted, PR merged, commit pushed, etc.). The notify daemon tails these files and dispatches notifications through pluggable sinks (desktop, terminal bell, fifo, Slack webhook). Parent agents can also poll the event log directly via `claude-sessions events <TICKET>`.

Wired by `.claude/hooks/event-emitter.sh` (PostToolUse on Bash). The hook is intentionally an **observability hook**, not a gate — it always exits 0 even on internal failures, because blocking tool execution because of an event-logging error would be the wrong tradeoff.

### Event format

```json
{"ts":"2026-05-09T17:34:01Z","ticket":"BDP-367-rev","depth":1,
 "kind":"review_comment","detail":{"pr":"346"}}
```

Fields:

- `ts` — UTC ISO-8601, second resolution.
- `ticket` — `$CLAUDE_SESSION_TICKET` or `"unknown"` if unset.
- `depth` — `$CLAUDE_SESSION_DEPTH` (integer).
- `kind` — one of the classified event kinds (see table below).
- `detail` — kind-specific structure; pr number, branch name, verdict, etc.

### Classified event kinds

| Kind | Trigger | Detail |
|---|---|---|
| `review_comment` | `gh pr review ...` (no verdict flag) | `{pr}` |
| `review_summary` | `gh pr review ... --approve\|--request-changes` | `{pr, verdict}` |
| `merge` | `gh pr merge ...` | `{pr}` |
| `pr_opened` | `gh pr create ...` | `{}` |
| `commit_pushed` | `git push ...` | `{branch}` |

Adding a new kind: extend the classification in `.claude/hooks/event-emitter.sh`, add a test case in `.claude/hooks/tests/test-event-emitter.sh`, and update the daemon's default `notify.config.toml` if the new kind should fire a notification by default.

### Notification config

User-controlled at `~/.claude-sessions/notify.config.toml` (auto-generated with sane defaults if missing). Per-kind list of sinks:

```toml
[events]
review_summary = ["desktop"]
merge          = ["desktop", "bell"]
pr_opened      = ["desktop"]
review_comment = []     # too noisy by default
commit_pushed  = []
```

Sinks today: `desktop` (notify-send-style toast), `bell` (terminal bell), `fifo` (append to `~/.claude-sessions/notifications.fifo`), `slack` (POST to `$CLAUDE_SESSIONS_SLACK_WEBHOOK` if set).

### Querying the event log

`claude-sessions events <TICKET> [--since=<ts>] [--kinds=<kind,...>] [--json|--plain] [--follow]` — read events for a session. Useful for parent agents that want to know what a child has done since the last turn without polling the full dashboard.

## Session lifecycle and cleanup

Fleet sessions follow a normal create-work-cleanup lifecycle. The cleanup step — `claude-sessions kill <TICKET>` plus worktree removal — is **part of the work**, not a separate destructive operation. It does not require a fresh per-session authorization once the session's work is shipped or otherwise resolved.

### Allowed without explicit authorization

- The session's PR has been merged.
- The session ended naturally (final review posted, agreed-upon artifact produced) and has been idle.
- The session is in `error` or `done` state and the user has already been informed of the result.
- A child session was just spawned and is misconfigured (wrong cap, wrong slug, failed to start) and has produced no in-flight work.

### Still ask first

- The session has uncommitted work in its worktree (the kill itself fail-safes by aborting `git worktree remove`, but the user may want to inspect or rescue the work before forcing).
- The session is in `working` state mid-task.
- The session has produced output the user has not yet seen.
- Killing would orphan an active child session, or interrupt a chain of dependent sessions tracked by `fleet-chain`.
- The session is the parent of one or more active children (always check `claude-sessions tree <ticket>` before killing a parent).

### Operational notes

- `claude-sessions kill` is interactive by default and prints what it's about to remove. Pipe `y` to confirm; the kill aborts safely if the worktree has uncommitted changes.
- Use `claude-sessions tree <ticket>` before killing a parent session to verify no children are still active.
- After a routine cleanup, surface what was reclaimed (session, worktree, branch) in chat so the user has a record. Don't narrate the steps — just the outcome.
