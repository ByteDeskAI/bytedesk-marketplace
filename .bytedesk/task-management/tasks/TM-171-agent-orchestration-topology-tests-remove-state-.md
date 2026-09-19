---
id: "TM-171"
kind: "task"
status: "done"
created: "2026-09-11T18:32:45.601Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: topology tests remove state dirs before stopping the processes that write them"
epic: "EP-019"
acceptance: [{"text":"Every topology test that starts a process or tmux server stops it before removing the directory it writes to or whose socket it uses, in one hook or a finally block","done":true,"at":"2026-09-13T20:29:10.790Z"},{"text":"No test leaves a tmux server or ao-topology supervise process alive after the suite; checked by listing tmux -L/-S servers and supervise processes before and after a full run","done":true,"at":"2026-09-13T20:29:10.915Z"},{"text":"node tests/stability.mjs --runs 10 --pattern 'tests/unit/topology-*.test.mjs' reports stable on a clean tree","done":true,"at":"2026-09-13T20:38:33.547Z"}]
evidence: [".bytedesk/task-management/evidence/TM-171-TEARDOWN.md"]
commits: ["401158a","7bc09e1","5637b0f"]
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
updated: "2026-09-13T20:38:44.954Z"
labels: ["plugin:agent-orchestration","ready-for-agent"]
comments: [{"author":"main","ts":"2026-09-12T03:40:51.081Z","text":"Second instance measured, on merged origin/main 12e0bac (2026-09-12). tests/unit/topology-repo-enrollment.test.mjs:148, 'session start activates an enrolled repository, and N concurrent linked-worktree activations converge on one supervisor', fails in its cleanup hook: hookFailed ENOTEMPTY, rmdir '/tmp/ao-enroll-converge-*/home'. Every assertion passes first; the teardown removes the temp directory while a supervisor the test started is still writing into it. Measured 1 failure in 5 runs at 1-minute load 20-31 (5-minute load ~110); W3 measured the same file 5 of 5 green at load ~10 before merge, so it is load-sensitive rather than new. Not caused by PR #114 (TM-304), which touches only src/, dist/, docs and one control-seam test — verified with a byte-order path comparison whose control passes. Product code is unaffected: this is a test teardown ordering bug of the same class this task already covers. Fix it the way TM-164's tests were fixed: one hook that reaps the spawned supervisors, then removes the directory."}]
triagedBy: "auto"
branch: "feat/dispatch-duplicate-guard"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
evidenceSources: {".bytedesk/task-management/evidence/TM-171-TEARDOWN.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-171-TEARDOWN.md","sha256":"c6cae98c43f0924e2a751f72947da0351cf1d691ee3eddba7cc92c52cd649cc2","bytes":5365,"at":"2026-09-13T20:38:33.695Z"}}
parkedReason: "AC1 and AC2 verified on 0b63a79 (branch tm/TM-171-teardown, clean worktree): the detector reports 7 violations on pristine HEAD and 0 after the fix across the same 46 files, and a live-server census around the full run shows 8 before, 8 after, 0 leaked, with a planted control proving the comparison can detect a leak. 446/446 topology unit tests pass. AC3 is the only thing left and cannot be claimed yet: node tests/stability.mjs --runs 10 --pattern 'tests/unit/topology-*.test.mjs' is mid-flight (started 16:26:35, run 1 of 10 clean). Resume by reading that run's output; when reading it, check the RUN COUNT and not only the verdict, because TM-181 records that this harness calls an empty run stable. The branch is committed and not merged."
closed: "2026-09-13T20:38:36.240Z"
---

Found by W1 during EP-019 (report 2026-09-11). node:test runs t.after hooks in registration order (verified with a scratch test). Where a test registers rm(root) BEFORE the hook that stops a live writer, the directory is removed under a running process. In tests/unit/topology-supervision.test.mjs this produced an intermittent hookFailed ENOTEMPTY (3 in 32 runs), fixed in EP-019 (2f4f163) by reaping before rm. The same order remains in: topology-supervision-consistency.test.mjs:115 (rm) before :141 tmux -S <socket under root> kill-server and :143 acker abort (live writer into state/leads/probes; the sleep-120 test server may survive up to 120 s if its socket is already deleted); topology-supervision-consistency.test.mjs:43 before :51 controller.abort (lower risk, superviseRepository awaited in the body); topology-management.test.mjs:10 fixture rm before :151 child.kill and possibly :182 kill-server (not yet read). Line numbers are as of commit 2f4f163.