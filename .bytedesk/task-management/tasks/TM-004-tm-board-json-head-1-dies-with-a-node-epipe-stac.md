---
id: "TM-004"
kind: "task"
status: "done"
created: "2026-07-29T23:08:49.930Z"
title: "tm board --json | head -1 dies with a node EPIPE stack trace"
epic: "EP-002"
acceptance: [{"text":"a closed reader leaves no stack trace on stderr from any tm verb","done":true,"at":"2026-07-29T23:13:10.408Z"},{"text":"the same holds for bin/tm-mcp when the client disappears","done":true,"at":"2026-07-29T23:13:10.455Z"},{"text":"a real write error still fails loudly rather than exiting 0","done":true,"at":"2026-07-29T23:13:10.499Z"}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/59"]
blockedBy: []
blocks: []
actor: "main"
branch: "feat/task-management-plugin"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-29T23:13:10.550Z"
labels: ["store-cli","rank-01"]
priority: "high"
comments: [{"author":"main","ts":"2026-07-29T23:08:50.058Z","text":"Build plan (from the ranked survey): bin/tm, beside const out = (s) => process.stdout.write(...) at line 62: process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; }). One listener is per-stream, not per-call, so it covers out, emit (bin/tm:64) and the one raw write, if (!out_) return process.stdout.write(text) in VERBS.export at bin/tm:489. | Same listener in bin/tm-mcp after the createInterface at line 11 — there a closed pipe means the client is gone, so exit 0 rather than dumping a stack into a dead stream. One line, same diff, but describe it as the separate failure it is. | tests/test-read.sh: seed one task whose body exceeds 64 KB so the payload beats the pipe buffer deterministically instead of depending on fixture task count, then run tm board --json | head -1 and tm export json | head -1 and assert stderr contains neither 'EPIPE' nor 'Unhandled'. | One CHANGELOG entry under Fixed."},{"author":"main","ts":"2026-07-29T23:08:50.101Z","text":"Watch out for: Keep the rethrow so a real ENOSPC/EBADF still fails loudly. Do not build a lib/stdout.mjs for this — two lines in two entry points is the whole change. Assert on stderr, not on 0: the pipeline's exit status is head's (0), the tm process exits 1, and the visible symptom is the stack on stderr."}]
closed: "2026-07-29T23:13:10.549Z"
---

