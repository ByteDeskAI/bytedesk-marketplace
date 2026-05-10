---
name: review
description: Spawn a dedicated reviewer session for a given session's open PR. The reviewer agent reads the diff, posts inline + summary review comments on GitHub, then exits. Works two ways — invoked by you in chat against any open PR, or invoked autonomously by an implementer session (auto-detects parent and ties the reviewer in as a child). Use when the user says "fleet review", "/fleet:review", "spawn a reviewer for BDP-N", "have someone review BDP-N's PR", or when an implementer session has just opened its PR and wants a second LLM pair of eyes.
user-invokable: true
argument-hint: "[BDP-N]    # ticket whose open PR should be reviewed (omit when called from inside the implementer session)"
allowed-tools:
  - Bash
  - Read
  - Write
---

## What this skill does

Spawns a brand-new reviewer session whose only job is to read and comment on another session's PR. The reviewer:

1. Reads the PR diff via `gh`.
2. Reads the original Jira ticket for context.
3. Cross-references the relevant `.claude/rules/*.md` files based on the diff.
4. Posts inline review comments on specific lines via `gh pr review --comment`.
5. Posts a final overall verdict (APPROVE / REQUEST_CHANGES / COMMENT) with a summary.
6. Exits.

Reviewer runs in full-auto in its own worktree off `origin/develop` (same as the implementer's branch state). Spawned as a fresh session with no shared context with the implementer.

## Two invocation modes

### Mode A — manual (you in chat)
```
/fleet:review BDP-364
```
Pass the ticket explicitly. Spawns a reviewer at the top level (no parent).

### Mode B — autonomous (implementer session calling its own reviewer)
The implementer's prompt should include this near the end:
```
After your PR is open and CI is green, invoke /fleet:review (no arguments).
The skill will auto-detect this session as its parent.
```
When invoked with no arguments inside a session, the skill reads `$CLAUDE_SESSION_TICKET` from the environment and uses that as the source ticket. The reviewer is spawned with `--parent <implementer>` so it shows as a child in the dashboard tree. This is recursion: depth 1 (parent) → depth 2 (reviewer). Hits the `--max-depth 2` cap exactly; further recursion from the reviewer is rejected unless the user passes `--allow-recursion`.

## Steps

1. **Resolve the source session.** If `<BDP-N>` is in args, use it. Else read `$CLAUDE_SESSION_TICKET`. If both empty, refuse with usage hint.
2. **Resolve the parent.** If invoked inside a session, the source IS the parent. If invoked manually with `<BDP-N>`, set `--parent <BDP-N>` so the reviewer appears as a child of the implementer's session in the dashboard tree.
3. **Look up the PR:**
   ```
   gh pr list --head feature/<BDP-N>-* --state open --json number,url,headRefName --limit 1
   ```
   If no open PR, refuse with a clear message.
4. **Refuse duplicates.** If the dashboard already shows a session named `<BDP-N>-rev`, refuse — there's already a reviewer running for this PR.
5. **Build the reviewer prompt** at `/tmp/<BDP-N>-review-prompt.txt` using the **Reviewer prompt template** below.
6. **Spawn:**
   ```
   spawn-claude-feature <BDP-N>-rev review-of-<BDP-N> \
     --prompt-file /tmp/<BDP-N>-review-prompt.txt \
     --full-auto \
     --parent <BDP-N> \
     --max-cost 1.50 \
     --max-runtime 20
   ```
   Reviewer ceilings are tight on purpose — review is bounded work; if a reviewer is still going at 20 minutes or has spent >$1.50 something is wrong.
7. Report the spawned reviewer in chat with the dashboard tree command (`claude-sessions tree <BDP-N>`) so the user can see the parent-child relationship.

## Reviewer prompt template

```
You are a code reviewer for PR #<NUMBER> on the bytedesk-platform repo.

PR:     <URL>
Branch: <BRANCH>
Source ticket: <BDP-N> (https://bytedesk.atlassian.net/browse/<BDP-N>)

Your job, in order:
  1. Read the source ticket's description (use mcp__plugin_atlassian_atlassian__getJiraIssue).
  2. Read the PR diff: gh pr diff <NUMBER>
  3. Read the PR's description: gh pr view <NUMBER>
  4. Identify which .claude/rules/*.md files apply based on the touched paths.
     Read each one. Flag any rule violations.
  5. For each non-trivial issue you find, post an inline comment:
        gh pr review <NUMBER> --comment -F /tmp/comment.md
     Use one comment per concrete issue. Don't pile multiple unrelated points
     into one comment. Reference specific file:line where possible.
  6. Post a final overall review:
        gh pr review <NUMBER> --request-changes -b "<summary>"     # if blocking issues
        gh pr review <NUMBER> --comment        -b "<summary>"     # if minor or suggestions
        gh pr review <NUMBER> --approve        -b "<summary>"     # if clean

What you are looking for, in priority order:
  - Correctness: does the change actually do what the ticket asked?
  - Rule violations: anything in .claude/rules/*.md that this PR breaks
  - Tests: are tests present and meaningful for what changed?
  - Security: secrets in code, missing input validation, dangerous patterns
  - Style alignment with surrounding code
  - Dead code, leftover debug prints, TODOs without owners

What you are NOT doing:
  - Bikeshedding (no nitpicks on naming preferences, formatting that's already linted, etc.)
  - Suggesting refactors unrelated to the ticket scope
  - Adding code yourself — comments only

Hard constraints:
  - Never push to the branch.
  - Never close or merge the PR.
  - Never modify CI or repository settings.
  - If the diff is >2000 lines, post a comment saying so and request the implementer split the PR; don't try to review the whole thing.

Exit when: final review is posted (approve / request-changes / comment).
```

## Output format

```
Spawned reviewer for BDP-364:

  Reviewer session: BDP-364-rev
  Reviewing PR:     #346 (https://github.com/.../pull/346)
  Source session:   BDP-364

Watch:    claude-sessions attach BDP-364-rev
PR view:  gh pr view 346 --web

Review will appear as inline + summary comments on the PR when complete.
```

## Constraints

- Only spawn reviewers for sessions with open PRs. If the source session has no PR yet, refuse.
- Don't spawn a reviewer for an already-merged PR.
- Don't spawn multiple reviewers for the same PR concurrently. If `BDP-N-rev` already exists in the dashboard, refuse.
- The reviewer is short-lived — usually <10 minutes. Use `/fleet:cleanup` to sweep it after the review lands.

## Examples

```
/fleet:review BDP-364
```
