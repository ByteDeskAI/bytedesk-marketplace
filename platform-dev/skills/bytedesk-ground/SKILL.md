---
name: bytedesk-ground
description: >-
  Ground yourself on recent ByteDesk activity before acting. Summarizes the last
  N hours of commits across bytedesk-platform (develop) and the sibling
  bytedesk-omnigent repo (main), the BDP-N Jira keys those commits reference, and
  the recent/open PRs — then pulls the referenced issues/PRs for full context.
  Use for "ground yourself", "ground yourself on the last N hours/commits",
  "what changed recently", "catch me up", "what did we ship today", or at the
  start of a session resuming in-flight work.
user-invokable: true
argument-hint: "[hours=12]"
allowed-tools:
  - Bash
  - Read
---

## Mission

Turn "ground yourself on the last N hours" — the single most-repeated ritual in
the transcripts — into one deterministic command plus a focused follow-up read,
instead of an ad-hoc `git log` + PR dig every time.

## Procedure

1. Run the helper (default window 12h; pass the hours the user asked for):
   ```bash
   ground --hours <N>          # human summary
   ground --hours <N> --json   # machine-readable
   ```
   It prints, read-only:
   - **bytedesk-platform** commits on `origin/develop` (fetched fresh)
   - **bytedesk-omnigent** commits on `origin/main` (the sibling repo, when present)
   - the **BDP-N keys** those commit subjects reference
   - the **recent/open PRs** by last update

2. Open the referenced context for the actual grounding — don't stop at the
   commit list:
   - Pull each referenced **BDP-N** issue (Atlassian MCP `getJiraIssue`) for
     scope/status. Default `cloudId = bytedesk.atlassian.net`.
   - Read the open/relevant **PRs** (`gh pr view <n>`) for what's in flight.
   - For "why did we…" / architectural questions, also query MemPalace
     (`mempalace_search`, wing `bytedesk_platform`) and the relevant ADRs.

3. Summarize back to the user: what landed, what's in flight, what's referenced,
   and (if they asked to continue work) the obvious next step — citing BDP-N and
   PR numbers so they can reconcile from git history.

## Notes

- Read-only. It fetches `origin/develop` / `origin/main` but never mutates.
- The omnigent section is skipped (not an error) when the sibling
  `../bytedesk-omnigent` checkout isn't present.
- For a deeper "is my current branch landed?" question, use the worktree
  operator's `landed` verb instead; this skill is about recent *activity*, not a
  single branch's merge state.
