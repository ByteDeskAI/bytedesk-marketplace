---
id: "TM-307"
kind: "task"
status: "in_progress"
created: "2026-10-03T01:42:46.891Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: withLock leaves an ownerless lock when killed between mkdir and owner.json, wedging every supervisor"
epic: "EP-019"
acceptance: [{"text":"a process killed at any point during acquisition never leaves an ownerless lock (test: hooks at every step, including a real child process SIGKILLed mid-acquire, then a second acquirer succeeds without manual recovery)","done":false},{"text":"a legacy empty lock directory is taken over by the next acquirer; a populated live lock is still never reclaimed; concurrent acquirers still get exactly one winner (multi-process test)","done":false},{"text":"every other admission in ao that does mkdir-then-write is identified and uses the same atomic helper, or is listed with why it is safe","done":false},{"text":"shipped: merged, plugin updated, services restarted, and a live kill -9 of process-compose leaves supervisors healthy (restarts settle, no TOPOLOGY_LOCK_TIMEOUT)","done":false}]
evidence: []
commits: ["f8af1cd8"]
blockedBy: []
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T02:36:04.193Z"
priority: "highest"
comments: [{"author":"main","ts":"2026-10-03T02:14:44.054Z","text":"Shipped: PR #170 merged (f8af1cd8, 0.15.2); plugin f8af1cd8fb11 installed; services restarted; Codex/Grok copies auto-refreshed to 0.15.2. Live AC4: kill -9 of process-compose x6 (the exact outage trigger) → all 8 processes back each time, settle at restarts=0, 0 empty (ownerless) lock directories, and every supervisor's tick record rewritten within 41 s by the post-kill pid with reconciled=true. (Per-process log files were not used as evidence: process-compose resets them per start, so a zero-growth count there proves nothing.)"}]
---

Live outage 2026-10-02 16:12–21:40: presence/.publish.lock was an EMPTY directory (no owner.json), created 16:12:54 when the operator session's kill -9 tests killed process-compose and with it every supervisor mid-acquire. withLock (topology/lib/lockfile.mjs) admits by mkdir(lockPath) and only afterwards awaits processIdentity() and writes owner.json; a death in that window leaves an ownerless generation, and 'unknown ownership fails closed' means nobody ever reclaims it. Every supervisor then timed out after 30 s (TOPOLOGY_LOCK_TIMEOUT, owner null), exited 1 and was restarted by process-compose — ~606 restarts per repository supervisor over 5.5 h. Removed by hand (empty dir, no owner). Fix: atomic admission — mkdtemp a private sibling, write owner.json into it, then rename() it onto lockPath (atomic; an existing EMPTY dir is replaced, a populated one yields ENOTEMPTY/EEXIST = held). An ownerless lock can then never be created by this code, and a legacy empty orphan is replaced by the next acquirer without any age heuristic. Sweep stale .pending-* siblings. Audit every other mkdir-then-write admission in ao (grep mkdir across topology/ src/) and route them through the same helper.