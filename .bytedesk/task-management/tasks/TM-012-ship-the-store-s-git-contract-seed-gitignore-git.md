---
id: "TM-012"
kind: "task"
status: "done"
created: "2026-07-29T23:08:51.781Z"
title: "Ship the store's git contract: seed .gitignore + .gitattributes on init, audit it in doctor"
epic: "EP-002"
acceptance: []
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/87"]
blockedBy: []
blocks: []
actor: "main"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-30T19:08:08.677Z"
labels: ["adoption","rank-10"]
priority: "medium"
comments: [{"author":"main","ts":"2026-07-29T23:08:51.912Z","text":"Build plan (from the ranked survey): seedGitFiles(p) in lib/templates.mjs beside seedTemplates (templates.mjs:94-104 — same create-only-if-absent shape, returns what it created, ~15 lines), called from VERBS.init (bin/tm:136) right after seedTemplates(P). Both files go INSIDE .bytedesk/task-management/, never the repo root: .gitignore = index.json, state.json, state.lock, dashboard.*, *.tmp; .gitattributes = events.jsonl merge=union and events.*.jsonl merge=union, git's built-in answer for an append-only log — both sides survive, and all three readers already sort by ts and skip unparseable lines (store.mjs:286-303, time.mjs:24-41, render.mjs:114-126). | A git-hygiene check in diagnose() (lib/doctor.mjs:29), shelling git -C <root> ls-files .bytedesk/task-management with the same execFileSync shape lib/paths.mjs:20 uses — note that helper is not exported, so export it or inline the call. Split into two findings: missing .git"},{"author":"main","ts":"2026-07-29T23:08:51.958Z","text":"Watch out for: This writes into a user's VCS surface — stay inside .bytedesk/task-management/, create only when absent, never touch the root .gitignore. Do NOT make tracked cache files an error: tm doctor exits 1 on error (bin/tm:505) and the whole selling point is dropping it into pre-commit/CI, so an error would break the gate for every existing adopter on upgrade day, for a condition doctor refuses to repair. Do NOT have the fix RETURN a git rm --cached line: repair() prints f.fix() returns under '## fixed"}]
rank: 5062.5
session: "55951e93-6838-4974-8033-11461bdd2dc4"
closed: "2026-07-30T19:08:08.676Z"
---

