---
id: "TM-015"
kind: "task"
status: "done"
created: "2026-07-30T00:51:28.158Z"
title: "Intermittent concurrency-suite failures under full-suite runs"
epic: "EP-002"
acceptance: [{"text":"the failure is reproduced deliberately, or attributed to the environment with evidence","done":true,"at":"2026-07-31T03:06:30.540Z"},{"text":"if the lock is at fault, withLock's 30s deadline and staleLock's pid-liveness window are the two candidates to examine","done":true,"at":"2026-07-30T19:40:33.128Z"}]
evidence: [".bytedesk/task-management/evidence/TM-015-store.mjs"]
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/90","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/92","74b2927","fe274a2"]
blockedBy: []
blocks: []
actor: "main"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T03:06:52.430Z"
type: "bug"
priority: "high"
labels: ["flake","concurrency"]
comments: [{"author":"main","ts":"2026-07-30T00:51:28.327Z","text":"Observed twice inside ./run-tests.sh, with DIFFERENT assertions each time: once \"concurrent labels are all kept\" (a lost label), once \"8 concurrent creates write 8 files\" plus the id/index assertions. Both times the third full run was green."},{"author":"main","ts":"2026-07-30T00:51:28.365Z","text":"Ruled out: (1) not caused by the tm log render PR — its changes touch lib/render.mjs, bin/tm log and test assertions, none on the write path; (2) not the render->ntfy import cycle, which already existed as ntfy->store->notify-hook->ntfy before that edge was added; (3) not suite contention — run-tests.sh iterates tests/*.sh sequentially; (4) not reproducible: 6/6 green in isolation and 11/11 green under an artificially generated load average of ~4, with zero stderr from the create processes."},{"author":"main","ts":"2026-07-30T00:51:28.493Z","text":"Leading hypothesis, unproven: withLock breaks a lock after LOCK_STALE_MS (30s) of waiting, and staleLock treats an ESRCH pid as dead — so a holder that exits between the check and the write, or a waiter starved past 30s, could let two processes in. Both are narrow and neither has been demonstrated. Do NOT ship a speculative lock change; reproduce first."},{"author":"main","ts":"2026-07-30T19:25:56.135Z","text":"REPRODUCED and one real bug fixed in #90: withLock's deadline branch broke a lock a live process held (staleLock said alive; the || deadline overrode it), losing one side of a read-modify-write on index.json. Caught by running six copies of the concurrency suite at once — the shape was 8 files with a short index, exactly a lost index write. NOT closing: one run in twelve still came up short after the fix, with a different shape (7 files — a create that refused, not an index that lost a row), not reproducible again in 24 heavier runs and no error captured. Repro recipe: 6-12 parallel 'bash tests/test-concurrency.sh' on a loaded machine."},{"author":"main","ts":"2026-07-30T19:40:33.319Z","text":"ROOT CAUSE, fixed in #92: writeAtomic stages at .tm-tmp-<pid>-<name>, which ends in .md, and every reader globbed .endsWith('.md') — so a lister saw another process's staging file, the rename moved it, and readFileSync hit ENOENT. That was the create that never wrote a file (8 creates -> 7 files/ids/rows). Two bugs total: #90 fixed a waiter breaking a live lock; #92 fixed this. Reproduced at 14 parallel suite copies (2 of 3 rounds failed), 42/42 clean after."},{"author":"main","ts":"2026-07-31T03:06:39.389Z","text":"Root cause found by tracing, not inspection: the break path deleted whatever file was at the lock path, not the file it had judged stale. Trace under load showed four processes inside the lock within 2ms — three entered via break — after a holder released and several waiters all read the empty path as 'stale'. Fixed by (a) never breaking a lock that merely vanished, since open(wx) already arbitrates, and (b) clearing a dead holder's lock under a second exclusive lock, re-reading the verdict while holding it. Also fixed a defect in the first draft of that fix: the stale branch continued past the deadline check, so a waiter behind someone else's break spun a core flat and aged out their breaker after 30s. 60 repro rounds clean (previously failed by round 17), 4 concurrency suites in parallel clean, and the suite now asserts single-holder directly."}]
parkedReason: "one unexplained shortfall remains after the lock fix — 7 files, no captured error, not reproducible in 24 heavier runs"
session: "55951e93-6838-4974-8033-11461bdd2dc4"
reopenedReason: "recurs: 8 concurrent creates still mint a duplicate id under full-suite load, ~1 run in 5-10. Reproduces on committed HEAD, so it is not the 0.6.x work. The empty-lock window fix in staleLock closed one cause; something else lets two holders through, since nextId already runs inside withLock."
closed: "2026-07-31T03:06:39.444Z"
---

