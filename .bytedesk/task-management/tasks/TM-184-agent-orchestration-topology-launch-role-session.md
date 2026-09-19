---
id: "TM-184"
kind: "task"
status: "open"
created: "2026-09-11T20:36:42.792Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: topology-launch role-session tests create and kill named sessions on the operator's tmux server when TMUX is inherited"
epic: "EP-019"
acceptance: [{"text":"Every test in topology-launch.test.mjs that touches tmux sets TMUX:'' and a per-test TMUX_TMPDIR, and scopes every kill-session with -S or -L","done":false},{"text":"A guard test (or the suite runner) fails when any tmux-touching test would inherit the caller's TMUX","done":false},{"text":"Running the topology suite from inside a tmux session creates no session on the caller's server, checked by listing the caller's server sessions before and after","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["plugin:agent-orchestration","ready-for-human"]
triagedBy: "human"
updated: "2026-09-13T21:29:46.930Z"
comments: [{"author":"main","ts":"2026-09-13T20:28:02.605Z","text":"Second and third instances, found during TM-171 (2026-09-13). tests/unit/topology-supervision.test.mjs:36,38 and tests/unit/topology-lead.test.mjs:36,41,46 call run('tmux', ...) with NO env at all. topology-supervision even builds an isolated env via isolatedEnv() (TMUX:'', TMUX_TMPDIR under the test root) and then never passes it to the tmux calls, so the server is created in the operator's default /tmp/tmux-1000 and $TMUX is inherited from the operator's shell. That is guards 1 and 2 of .claude/rules/tmux-test-isolation.md missing; only guard 3 (a unique -L <name> on every call, including kill-server) is holding, and the rule says plainly that guard 3 exists to survive exactly this.\n\nMeasured, not read: a live-server census around a full topology unit run showed two sockets left behind in /tmp/tmux-1000 named ao-lead-test-<pid>-<ts> and ao-supervise-<pid>-<ts>. Both were dead ('no server running'), so no server leaked and TM-171's AC2 is unaffected — but the socket files prove which directory these tests write into.\n\nNot fixed here: adding env to those calls changes what the child node processes in topology-lead inherit, which is a behaviour change this teardown-ordering task should not smuggle in."}]
---

Found by W5 during TM-168 (2026-09-11). Running node --test --test-concurrency=1 tests/unit/topology-*.test.mjs from a shell inside tmux (TMUX set) made the existing role-session tests in tests/unit/topology-launch.test.mjs create and kill their own named sessions (ao-aatest01, ao-prompt01) on the OPERATOR's server. They ran no kill-server, but they violate .claude/rules/tmux-test-isolation.md rules 1 and 3 (no TMUX:'' and unscoped kill-session), and a session-name collision would kill a real agent session. Other sessions and workers have run the suite from inside tmux today. Workaround until fixed: run the suite with TMUX='' and a private TMUX_TMPDIR.