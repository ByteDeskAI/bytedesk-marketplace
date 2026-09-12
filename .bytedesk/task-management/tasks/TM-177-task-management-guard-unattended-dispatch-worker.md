---
id: "TM-177"
kind: "task"
status: "done"
created: "2026-09-11T19:43:00.335Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: guard unattended dispatch workers against repo-destructive and external actions"
epic: "EP-021"
acceptance: [{"text":"in a worker env, pre-bash exits 2 with a reason for: git push --force/-f/+refspec, git push to a branch other than the task's tm/<id> branch, branch or tag deletion, git reset --hard, git filter-branch, gh pr merge, gh release, and deploy/secret/outbound-message commands","done":true,"at":"2026-09-11T20:19:37.923Z"},{"text":"in a worker env, git push -u origin <own tm/ branch>, gh pr create, git commit and ordinary commands are allowed","done":true,"at":"2026-09-11T20:19:38.088Z"},{"text":"outside a worker env the hook exits 0 without starting node (fast path in tm-hook.sh)","done":true,"at":"2026-09-11T20:19:38.206Z"},{"text":"tmux and topology spawns set TM_DISPATCH_WORKER=1 and pass the guard through --settings; a test asserts both argv/env","done":true,"at":"2026-09-11T20:19:38.327Z"},{"text":"unit tests cover every blocked and allowed command above; the hook bash suite exits 0","done":true,"at":"2026-09-11T20:19:38.459Z"}]
evidence: [".bytedesk/task-management/evidence/TM-177-VERIFY.md"]
commits: ["0fe92e5"]
blockedBy: []
blocks: ["TM-180"]
actor: "main"
session: "c3738e82-1fbf-4fc3-a6a3-06f965eac51c"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T20:21:44.230Z"
comments: [{"author":"main","ts":"2026-09-11T19:47:50.991Z","text":"delegated 2026-09-11 by lead session c3738e82 to Agent-tool worker 'w-guard' in an isolated worktree; work is live, not abandoned. Lead reviews and merges; do not park or restart unless that worker is confirmed gone. Stop gate cannot see Agent-tool delegation (CAP-0003)."},{"author":"main","ts":"2026-09-11T20:19:38.747Z","text":"merged to main as 0fe92e5 (worker commits 8aad117, 1b29278); lead trial-merged onto fc25845 and ran unit 1414/1414, test-hooks 65, test-hooks2 40, test-pool 26, all exit 0; merged tree identical to trial."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-177-VERIFY.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-177-VERIFY.md","sha256":"a2ab54267419012837c66cd02587d2e2ad2d547f886727cf6f697e4625d6eeac","bytes":4406,"at":"2026-09-11T20:19:38.610Z"}}
closed: "2026-09-11T20:19:38.868Z"
---

Dispatched workers run claude -p --dangerously-skip-permissions (lib/dispatch/tmux.mjs:32) with no guard. Keep skip-permissions (decision, Ryan 2026-09-11) and add a PreToolUse Bash guard for worker sessions, following ADR-0001 action classes. Spawn paths set TM_DISPATCH_WORKER=1 (tmux.mjs:60, topology envFor at topology.mjs:149). bin/tm-hook gains a pre-bash case; hooks/hooks.json gains a Bash matcher; hooks/tm-hook.sh exits before starting node when EVENT is pre-bash and TM_DISPATCH_WORKER is unset. Also inject the hook via --settings in the worker command so it holds when the worker session did not load the plugin.