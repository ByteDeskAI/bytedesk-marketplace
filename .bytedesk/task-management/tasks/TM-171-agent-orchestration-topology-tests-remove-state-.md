---
id: "TM-171"
kind: "task"
status: "open"
created: "2026-09-11T18:32:45.601Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: topology tests remove state dirs before stopping the processes that write them"
epic: "EP-019"
acceptance: [{"text":"Every topology test that starts a process or tmux server stops it before removing the directory it writes to or whose socket it uses, in one hook or a finally block","done":false},{"text":"No test leaves a tmux server or ao-topology supervise process alive after the suite; checked by listing tmux -L/-S servers and supervise processes before and after a full run","done":false},{"text":"node tests/stability.mjs --runs 10 --pattern 'tests/unit/topology-*.test.mjs' reports stable on a clean tree","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-11T18:32:51.763Z"
labels: ["plugin:agent-orchestration"]
---

Found by W1 during EP-019 (report 2026-09-11). node:test runs t.after hooks in registration order (verified with a scratch test). Where a test registers rm(root) BEFORE the hook that stops a live writer, the directory is removed under a running process. In tests/unit/topology-supervision.test.mjs this produced an intermittent hookFailed ENOTEMPTY (3 in 32 runs), fixed in EP-019 (2f4f163) by reaping before rm. The same order remains in: topology-supervision-consistency.test.mjs:115 (rm) before :141 tmux -S <socket under root> kill-server and :143 acker abort (live writer into state/leads/probes; the sleep-120 test server may survive up to 120 s if its socket is already deleted); topology-supervision-consistency.test.mjs:43 before :51 controller.abort (lower risk, superviseRepository awaited in the body); topology-management.test.mjs:10 fixture rm before :151 child.kill and possibly :182 kill-server (not yet read). Line numbers are as of commit 2f4f163.