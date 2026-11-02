---
id: "TM-392"
kind: "task"
status: "done"
created: "2026-10-05T11:27:31.221Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: fix project-scope plugin enablement and other startup blockers automatically instead of warning and blocking commits"
epic: "EP-028"
acceptance: [{"text":"The guard blocks only an actual commit command, not quoted text, heredoc bodies or arguments that mention it","done":true,"at":"2026-10-05T13:06:45.721Z"},{"text":"Per Ryan's 2026-10-05 decision (AGENTS.md wins): agent-orchestration neither blocks nor warns on project-scope enablement of agent-orchestration or task-management; already-installed old hooks stop blocking once the plugin updates; nothing edits another repo's settings","done":true,"at":"2026-10-05T13:06:46.114Z"},{"text":"Tests prove a real commit succeeds with project-scope enablement and an old pre-commit hook installed, no PreToolUse gate remains, and git-hook install is retired (each fails on the old code); unit suite, build:check and plugin validate pass","done":true,"at":"2026-10-05T13:06:46.443Z"}]
evidence: [".bytedesk/task-management/evidence/TM-392-landing.md"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/194","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/211","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/212","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/221"]
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-10-05T15:29:44.031Z"
priority: "high"
comments: [{"author":"main","ts":"2026-10-05T12:32:01.371Z","text":"Ryan's decisions (2026-10-05, asked by the marketplace lead): (1) AGENTS.md wins. A repo MAY declare agent-orchestration and task-management under its own .claude/settings.json enabledPlugins, so the commit guard must stop blocking project-scope enablement of them; at most a non-blocking note. (2) No tool auto-edits another repo's settings.json; where a fix is needed, print the exact edit and the repo's own lead applies it. So AC1 (auto-remove), AC2 (repair commit) and AC4 (AGENTS.md names exceptions) are superseded by: the guard and the SessionStart warning stop treating project-scope enablement as an error. AC3 (guard precision) stands. AC5/AC6 (lead startup hygiene, role prompt) are split out to their own task."},{"author":"main","ts":"2026-10-05T12:54:16.951Z","text":"Worker done at 3890fbfc; PR #194 -> fix/ao-local-nats-autostart; independent review running. Follow-up: topology/cli.mjs:151 help text, after PR #192 merges."},{"author":"review-sweep","ts":"2026-10-05T15:18:33.715Z","text":"review-sweep: TM-392 is done with commits and no reviewer verdict — needs an independent review or a decision."},{"author":"main","ts":"2026-10-05T15:29:44.026Z","text":"Independent review verdict: approved (lead-dispatched reviewer, APPROVE at 3890fbfc) — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/194#issuecomment-5995048657"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-392-landing.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-392-landing.md","sha256":"1c7f06e08aeccd598bdcd429eb97dac50e90ed2a31d8ace8885ec144a5f43dca","bytes":1443,"at":"2026-10-05T13:06:46.779Z"}}
closed: "2026-10-05T13:06:47.143Z"
---

Reported by Ryan from an agent-fabric lead session on 2026-10-05. Ryan's instruction: a startup problem caused by configuration must be fixed autonomously, not reported to a person and left blocking.

## What happened

At SessionStart in /home/ryan/Documents/GitHub/ByteDeskAI/agent-fabric (branch develop), the agent-orchestration hook printed:

> agent-orchestration: /home/ryan/Documents/GitHub/ByteDeskAI/agent-fabric/.claude/settings.json enables task-management@bytedesk at project scope.
> Every `git commit` in this repository will be blocked until it is removed. Fix: delete "task-management@bytedesk": true from "enabledPlugins" in .../agent-fabric/.claude/settings.json
> (keep it in ~/.claude/settings.json, where these plugins are enabled for every project).

The lead could not act on that message. The warning (`projectScopeWarning` in `agent-orchestration/src/services/project-scope.mjs`) and the PreToolUse commit guard (`scripts/guard-project-install.mjs` / `scripts/check-no-project-plugin-installs.mjs`) report the problem and block. Nothing repairs it, so every commit in the repo stays blocked until a person edits the file.

**The guard also gives a false positive.** It blocked a Bash call that only ran `tm task new ... --body -` with a heredoc whose text contained the words "git commit". The guard matches the whole command string, not the command that actually runs. Filing this very ticket was blocked that way.

The lead also hit a policy conflict that it could not resolve alone. `~/.agents/AGENTS.md` ("Claude Code plugins from a local marketplace") says a repo that uses a plugin declares it under its own `.claude/settings.json` `enabledPlugins`. The guard (CHANGELOG, "Commit guard") says agent-orchestration and task-management are user-scope installs and must never be enabled at project scope. The shared rule does not mention this exception.

The same session start also found two other problems that need someone to decide what to do with them:
- TM-013 in agent-fabric was `in_progress` and stale (more than 90 minutes) with 0/3 acceptance criteria ticked, even though commit ca13503 ("feat(install): one line puts a Fabric node on a Linux host") appears to deliver it.
- The checkout had uncommitted edits (AGENTS.md, README.md, several task files, the config and .gitignore files in .bytedesk/task-management) and three untracked ADRs (ADR-0007..0009).

## Required behaviour

1. **Fix it at startup.** When a guarded plugin (`DEFAULT_PLUGINS`) is enabled at project scope, the SessionStart hook (or `services ensure` / the repository supervisor) removes the entry from the repo's `.claude/settings.json` itself. It keeps the file's other keys, including `extraKnownMarketplaces` and any non-guarded `enabledPlugins`. It checks that the plugin is still enabled at user scope before removing the project entry, and fails closed (warns, no edit) if the plugin is not enabled at user scope or the file cannot be parsed. Then it commits the change as a chore commit on the current branch, or leaves it staged with a clear message if the tree has unrelated staged work. The guard must not block the commit that makes this repair.
2. **Guard precision.** The guard blocks only when the command that actually runs is a commit. It does not block when "git commit" appears in quoted text, heredoc bodies or arguments.
3. **One rule, not two.** Change `~/.agents/AGENTS.md` (the shared rules, outside this repo) or the guard so they agree. The shared rule should name agent-orchestration and task-management as user-scope-only exceptions to "declare plugins in the repo's own settings".
4. **Stale work at lead startup.** When the lead starts and finds an `in_progress` task that is stale, it decides what to do on its own. If commits on the branch carry the task's evidence, it verifies the acceptance criteria and closes the task (`tm accept`, `tm evidence`, `tm done`). Otherwise it parks the task with a reason. It must not just print a list for a person to read. The same applies to a dirty working tree: the lead either attributes the changes to a task and commits them, or reports exactly which files are unowned.
5. **The pattern in general.** When a lead finds at startup that it is blocked by configuration that a plugin owns, it files a ticket with that plugin's lead in this store, with full details: the exact message, the file, the repo and the conflicting rules. After the fix lands, the lead runs `plugin-rsync <plugin>` and carries on without a person stepping in. Document this in the lead role prompt.

## Repro

In any enrolled repo, add `"task-management@bytedesk": true` to `.claude/settings.json` `enabledPlugins`, start a Claude Code session, then try to commit. For the false positive, run any Bash command whose heredoc text contains the two words "git commit".
