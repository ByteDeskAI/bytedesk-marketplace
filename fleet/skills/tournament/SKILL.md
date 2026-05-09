---
name: fleet-tournament
description: Spawn N variant agents on the same Jira ticket, each with a different strategy hint, then auto-spawn a judge that reads all the resulting PRs and merges the best one. Recursive orchestration — implements the variants pattern from the Multi-Session Claude roadmap (#5.1). Use when the user says "fleet tournament", "/fleet-tournament", "spawn N variants on BDP-X", "tournament for BDP-X", "race variants", or any phrasing about parallel-strategy A/B/C-testing on a single ticket.
user-invokable: true
argument-hint: "<BDP-N> [--variants N] [--strategies LIST]    # default 3 variants"
allowed-tools:
  - Bash
  - Read
  - Write
  - mcp__plugin_atlassian_atlassian__getJiraIssue
  - mcp__plugin_atlassian_atlassian__getTransitionsForJiraIssue
  - mcp__plugin_atlassian_atlassian__transitionJiraIssue
  - mcp__plugin_atlassian_atlassian__addCommentToJiraIssue
---

## What this skill does

Tournament orchestration for the multi-session command center:

```
/fleet-tournament BDP-360
```
spawns 3 variant sessions (`BDP-360-v1`, `BDP-360-v2`, `BDP-360-v3`) on the same ticket, each with a different strategy hint. Installs a rule that, when **all variants reach `done`**, spawns a judge session (`BDP-360-judge`). The judge:

1. Reads each variant's PR diff via `gh`.
2. Compares them against the ticket's acceptance criteria.
3. Picks a winner.
4. Closes the losing PRs (without merging).
5. Comments the verdict on the winner's PR.
6. Optionally merges the winner if it has CI green and the user pre-approved auto-merge.

All five sessions (3 variants + judge + parent if user-initiated) live as siblings in the dashboard tree, and `claude-sessions tree BDP-360` shows the full bracket.

## When to use this

Tournaments are expensive — three implementations of the same feature. Use them for:
- High-stakes design decisions where you want to compare approaches (e.g. "which state-management library for the deploy panel?").
- Greenfield features where the right architecture isn't obvious.
- Refactors where you want to A/B/C-test cleanup strategies before committing to one.

Don't use them for:
- Small bugfixes (overkill).
- Tickets with one obvious implementation.
- When you don't have time/budget to evaluate the outputs (judge can't substitute for human taste here).

## Steps

1. Parse args:
   - `<BDP-N>` (required): the source ticket.
   - `--variants N` (default 3): how many variants. Cap at 5.
   - `--strategies "a,b,c"` (optional): explicit strategy hints; otherwise pull from the **Default strategies** below.
   - `--allow-recursion`: pass through to spawn-claude-feature for variants spawned from inside another session (depth-2 cap).
2. Fetch the ticket via Jira; abort if Done or not found.
3. Refuse if any session named `<BDP-N>-v*` or `<BDP-N>-judge` already exists in the dashboard.
4. Compute `parent`:
   - If invoked from inside a session, parent = `$CLAUDE_SESSION_TICKET`.
   - If invoked manually in chat, parent = `<BDP-N>` (the implementer ticket itself doesn't get a session — its variants do).
5. Transition `<BDP-N>` to In Progress.
6. **Pre-write all variant prompt files.** Each variant's prompt is the same base prompt + a strategy stanza injected near the top:

   ```
   You are competing in a 3-way tournament to implement <BDP-N>.
   Your variant:  v1
   Your strategy: <strategy-1>
   Read the strategies of the other variants below to understand the spread:
     v2: <strategy-2>
     v3: <strategy-3>
   Implement <BDP-N> using YOUR strategy. Open a PR with title:
     "BDP-N (variant v1): <one-line summary>"
   Include in the PR description:
     - Strategy: <strategy-1>
     - Tradeoffs vs other strategies: ...
     - Self-evaluation: where this approach wins, where it might lose
   When the PR is open, exit. Do not merge. The judge will decide.
   ```

7. **Spawn N variants.** For each:
   ```
   spawn-claude-feature <BDP-N>-v$i v$i-of-<BDP-N> \
     --prompt-file /tmp/<BDP-N>-v$i-prompt.txt \
     --full-auto \
     --parent <parent> \
     [--allow-recursion if from inside a session] \
     --max-cost 5.00 \
     --max-runtime 90
   ```
8. **Pre-write the judge prompt** at `/tmp/<BDP-N>-judge-prompt.txt` using the **Judge prompt template** below. List the variant tickets so the judge knows where to look.
9. **Install the judge rule** in the rules engine:
   ```bash
   jq -n --arg id "tournament-<BDP-N>-judge" \
         --argjson wait_for '["BDP-N-v1","BDP-N-v2","BDP-N-v3"]' \
         --arg wait_state "done" \
         --arg exec "spawn-claude-feature BDP-N-judge judge-of-BDP-N --prompt-file /tmp/BDP-N-judge-prompt.txt --full-auto --parent <parent> --allow-recursion --max-cost 2.00 --max-runtime 30" \
         --argjson timeout 240 \
         --arg created "$(date -Iseconds)" \
         --arg label "Tournament BDP-N: spawn judge after all variants done" \
         '{...}' > "$HOME/.claude-sessions/rules/tournament-<BDP-N>-judge.json"
   ```
   Timeout 240min (4h) — generous because variants can take a while.
10. Comment on the Jira ticket: "Tournament started, N variants spawned, judge will pick winner."
11. Report the spawned tournament with `claude-sessions tree <BDP-N>` so the user can see the full bracket.

## Default strategies

When `--strategies` isn't passed, use these heuristic defaults based on the ticket type. Pick the 3 most relevant:

| Strategy | Hint to inject |
|---|---|
| `simple` | "Take the simplest possible approach. Minimum abstractions. Inline what would normally be extracted. Optimize for code I could read in 30 seconds." |
| `idiomatic` | "Match the existing conventions in this codebase as closely as possible. Read 3 similar features first; mimic their structure." |
| `clean-architecture` | "Apply Clean Architecture / DDD principles where appropriate. Separate domain, application, and infrastructure concerns." |
| `performance` | "Optimize for runtime performance. Acceptable to add complexity if it materially improves throughput / latency." |
| `defensive` | "Maximize input validation, error handling, and observability. Assume every external call can fail." |
| `experimental` | "Try a non-obvious approach — a different library, a different pattern, something the existing codebase hasn't done before. Justify why it's worth considering." |

Default for an unknown ticket type: `simple`, `idiomatic`, `experimental`.

## Judge prompt template

```
You are the judge in a 3-way tournament for <BDP-N>.

Variant sessions and their PRs (look up via gh pr list --head feature/<BDP-N>-v*):
  - <BDP-N>-v1
  - <BDP-N>-v2
  - <BDP-N>-v3

Read first:
  1. The Jira ticket: https://bytedesk.atlassian.net/browse/<BDP-N>
  2. Each variant's PR description (note the "Strategy:" + "Tradeoffs:" sections).
  3. Each variant's diff: gh pr diff <NUMBER>
  4. The applicable .claude/rules/*.md files based on the touched paths.

Evaluation criteria, in priority order:
  1. Correctness — does it actually solve the ticket?
  2. Rule compliance — does it respect .claude/rules/?
  3. Tests — present and meaningful?
  4. Maintainability — would the author of this codebase 6 months from now thank you?
  5. Strategy fit — does the chosen approach match the ticket's nature?
  6. Code quality — clarity, naming, no dead code

For each variant, write a verdict comment on its PR:
  gh pr review <NUMBER> --comment -b "<your evaluation, 3-5 sentences>"

Then pick a winner. For the winner:
  gh pr review <WINNER_NUMBER> --approve -b "WINNER. Reasoning: <2-3 sentences>"

For the losers, close the PR (do NOT delete the branch):
  gh pr close <LOSER_NUMBER> --comment "Closed: lost tournament for <BDP-N>. Winner: PR #<WINNER>"

Comment on the Jira ticket with the verdict + a one-paragraph rationale.

Hard constraints:
  - Never push to any branch.
  - Never merge any PR (the user merges the winner manually after reviewing your verdict).
  - Never delete branches.
  - If you cannot decide, post your indecision on the Jira ticket and ask the user — don't pick at random.

Exit when: verdict comments posted, losers closed, Jira commented.
```

## Output format

```
Tournament started for BDP-360 (3 variants):

  ●  BDP-360-v1  (strategy: simple)        — spawning…
  ●  BDP-360-v2  (strategy: idiomatic)     — spawning…
  ●  BDP-360-v3  (strategy: experimental)  — spawning…

  Rule installed:  tournament-BDP-360-judge
  Judge will spawn when all variants reach done (timeout: 4h).

  Estimated tournament cost ceiling: $17 (3 × $5 variants + $2 judge).

Watch:    claude-sessions tree BDP-360
Live:     claude-sessions watch
Cancel:   claude-sessions kill --tree BDP-360-v1   (kills v1 only — see below)

To cancel the whole tournament:
  claude-sessions kill --tree BDP-360-v1
  claude-sessions kill --tree BDP-360-v2
  claude-sessions kill --tree BDP-360-v3
  claude-sessions rules cancel tournament-BDP-360-judge
```

## Constraints

- Maximum 5 variants. Beyond that, costs and judge cognitive load both blow up.
- Each variant gets its own worktree, so 3 variants = 3 fresh `npm install`s. First spawn is slowest.
- The judge cannot merge — only score and comment. The user is the final decision-maker on whether to merge the winner.
- Tournament timeout is 4h by default. If variants haven't finished by then, the judge rule expires and you have to investigate manually.
- Do not run more than 2 tournaments concurrently — local k8s and dep cache make 6+ active variants thrash the laptop.

## Examples

```
/fleet-tournament BDP-360
/fleet-tournament BDP-360 --variants 4
/fleet-tournament BDP-360 --strategies "simple,clean-architecture,performance"
```
