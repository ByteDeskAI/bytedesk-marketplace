---
id: "TM-394"
kind: "task"
status: "done"
created: "2026-10-05T11:28:44.420Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: detect and repair broken repository checkouts (dangling gitdir) autonomously, then ensure a lead"
epic: "EP-028"
acceptance: [{"text":"services ensure, supervise and lead ensure detect a dangling gitdir, missing .git or fsck errors in every registered repo and report the path","done":true,"at":"2026-10-09T02:25:57.752Z"},{"text":"Repair runs with no operator step: clone remote, match revision, adopt .git, keep every local difference as a named stash or backup branch, back up the old pointer; refuse and alert when no remote or no close match","done":true,"at":"2026-10-09T02:25:58.175Z"},{"text":"After repair a lead is ensured for the repo","done":true,"at":"2026-10-09T02:25:58.670Z"},{"text":"The code path that creates /tmp-backed worktrees at real checkout paths is found and fixed","done":true,"at":"2026-10-09T02:25:59.162Z"},{"text":"Tests: dangling-gitdir fixture repaired with local edits stashed; no-remote repo refused with an alert and left unchanged","done":true,"at":"2026-10-09T02:25:59.663Z"}]
evidence: [".bytedesk/task-management/evidence/TM-394-landing.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/198"]
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-10-09T02:56:33.664Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T13:31:51.781Z","text":"Worker done at ae5b6593; PR #198 opened; conflicting with #194 (src/services/cli.mjs, dist) — worker resolving. Root-cause AC: no shipping code creates the /tmp-backed layout; traced to an ad-hoc command during v0.2.2 release work 2026-08-26 (Codex session in bytedesk-marketplace-server)."},{"author":"main","ts":"2026-10-05T14:32:43.247Z","text":"PR #198 round 2: APPROVE at 278c916d (all 5 findings fixed). Follow-ups filed (mount-point refusal + comment; clear verb). Merge waits on #212 (TM-400) landing, then integration merge + blob check."},{"author":"review-sweep","ts":"2026-10-06T14:14:57.220Z","text":"review-sweep: PR #198 \"TM-394: detect and repair broken repository checkouts, then ensure a lead\" has had no activity for 24h — needs an independent review or a decision."},{"author":"main","ts":"2026-10-09T01:24:06.973Z","text":"Independent review verdict: approved (PR #198 R2 APPROVE at 278c916d; delta review APPROVE at 9d0a5f73 for the safe-git routing — no data-loss path; mutation: removing read-tree best.rev at :249 fails test (b)). Merges after 0.16.1 with one more main merge."},{"author":"main","ts":"2026-10-09T02:56:33.656Z","text":"Independent review verdict: approved (PR #198, round 2 APPROVE at 278c916d plus delta APPROVE at 9d0a5f73) — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/198#issuecomment-6072994647"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-394-landing.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-394-landing.md","sha256":"a9bb2785d7a4807f6a5bf1b2bfff82674574933b7e60dcd0f53929ba58ec332c","bytes":577,"at":"2026-10-09T02:26:00.105Z"}}
closed: "2026-10-09T02:26:00.569Z"
---

# HIGH PRIORITY — repair broken repository checkouts autonomously

**From:** Hana Braith (c2c984bc), lead of agent-fabric. **On behalf of:** Ryan (operator), 2026-10-05.
**Related:** message `agent-fabric-lead-autoload-2026-10-05` (always-available leads). A repo whose
checkout is broken has no lead identity, so it cannot get a lead at all. Fix both.
**Please:** create a `!high`, `ready-for-agent` task labelled `plugin:agent-orchestration`, with acceptance criteria, then implement it.

## What was broken
`/home/ryan/Documents/GitHub/ByteDeskAI/agent-orchestration` had a `.git` FILE reading
`gitdir: /tmp/agent-orchestration-git.6oDVR7/repo.git/worktrees/agent-orchestration`. That temp repo
had been deleted, so the directory was a linked worktree with nothing behind it. Every Git command
failed with `fatal: not a git repository`, and `ao-topology lead status` reported identity
`kind: path`, `record: null`, `status: none`. Root cause to find: some tool (release, packaging or a test)
made a worktree from a /tmp bare repo at a real checkout path and then removed the /tmp repo.

## How I repaired it by hand today (the procedure to automate)
1. Detect: `.git` is a file whose `gitdir:` target does not exist.
2. Clone the remote (from `bytedesk-package.yaml` `spec.repository`, or package.json) with `--no-checkout` into a temp dir.
3. Find the matching revision: read each candidate tree into a scratch index with
   `--work-tree=<broken dir>` and count differences. Here it was tag v0.2.3 (9287a35); only one file differed.
4. Back up the `.git` pointer file, move the clone's `.git` into the checkout, then do a mixed reset
   to the matched revision (keeps every file on disk).
5. Stash local edits, hard-reset to origin/<default>, pop the stash. If the pop conflicts, keep
   the stash and record it. Never drop it.
Result: `main` at c843d38 = origin/main, clean tree, fsck clean, lead identity is now
`kind: git-common-dir`. The one local edit (`.claude/settings.json` without `autoUpdate`) conflicted
with upstream deleting that file in 0701f89, so upstream won and the edit is kept as `stash@{0}`.

## Required behaviour (acceptance criteria to adopt)
- **Detect:** `services ensure`, `supervise` and `lead ensure` check every registered repo for a
  dangling `gitdir`, a missing `.git`, or a corrupt repo (fsck errors), and report the repo path.
- **Repair autonomously:** run the procedure above with no operator step. Hard safety rules:
  never delete or overwrite a working-tree file; keep every local difference as a named stash or a
  backup branch; back up the old `.git` pointer; refuse and alert (do not guess) if no remote is known
  or no revision matches closely. Record each repair in the recovery state file and the journal.
- **Then ensure a lead** for the repaired repo (ties into the always-available-leads task).
- **Prevent:** find and fix the code path that makes /tmp-backed worktrees at real checkout paths.
- **Tests:** a fixture repo with a dangling gitdir is repaired, local edits are kept in a stash, and
  a repo with no remote is refused with an alert rather than changed.

## Second defect found while sending this: guard-project-install.mjs false positive
The PreToolUse Bash hook `agent-orchestration/scripts/guard-project-install.mjs` blocked a plain
`ao-topology mailbox send` with a heredoc body. Its trigger regex (line 15) matches the word "git"
followed by the word "commit" anywhere on one line of the command, including inside message text.
Message: `FAIL .../agent-fabric/.claude/settings.json: enables task-management@bytedesk; enable it in
~/.claude/settings.json instead`. Fix: parse for a real Git commit invocation, not prose.
**Rule conflict to settle:** that guard forbids project-scope `enabledPlugins`, but Ryan's shared
rules (`~/.agents/AGENTS.md`, "Claude Code plugins from a local marketplace") say a repo that uses a
plugin declares it under `enabledPlugins` in its own `.claude/settings.json`. agent-fabric
(branch `develop`) does exactly that. One of the two must change; until then every commit in
agent-fabric is blocked. Tell me which, and I will apply the agent-fabric side.

## Open question
`ByteDeskAI/agent-orchestration` (standalone, v0.2.x, last push 2026-09-16) looks superseded by
`bytedesk-marketplace/agent-orchestration`, which the installed `ao-topology` runs from. If it is
retired, say so and archive it rather than keeping it registered.

Reply to my outbox with the task IDs, PR links and landing evidence.
