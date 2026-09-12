---
id: "TM-174"
kind: "task"
status: "done"
created: "2026-09-11T19:42:59.683Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: tm config <key> deletes the key, and dotted keys write a literal top-level key"
epic: "EP-021"
acceptance: [{"text":"tm config <key> with no value prints that key's value and leaves config.json byte-identical","done":true,"at":"2026-09-11T19:52:05.072Z"},{"text":"tm config dispatch.enabled true sets config.dispatch.enabled === true and writes no top-level 'dispatch.enabled' key","done":true,"at":"2026-09-11T19:52:05.211Z"},{"text":"getPath/setPath are exported from lib/settings.mjs and used by the config verb; no second copy","done":true,"at":"2026-09-11T19:52:05.340Z"},{"text":"regression tests for both, shown failing on the pre-fix commit","done":true,"at":"2026-09-11T19:52:05.462Z"}]
evidence: [".bytedesk/task-management/evidence/TM-174-VERIFY.md"]
commits: ["c4d6d80","59e72e4"]
blockedBy: []
blocks: []
actor: "main"
session: "c3738e82-1fbf-4fc3-a6a3-06f965eac51c"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-12T02:07:26.588Z"
comments: [{"author":"main","ts":"2026-09-11T19:47:50.619Z","text":"delegated 2026-09-11 by lead session c3738e82 to Agent-tool worker 'w-config' in an isolated worktree; work is live, not abandoned. Lead reviews and merges; do not park or restart unless that worker is confirmed gone. Stop gate cannot see Agent-tool delegation (CAP-0003)."},{"author":"main","ts":"2026-09-11T19:52:05.730Z","text":"merged to main as c4d6d80 (worker commit d7e1019); lead re-ran config-cli.test.mjs 6/6 and full unit suite 1380/1380, exit 0, clean worktree"}]
evidenceSources: {".bytedesk/task-management/evidence/TM-174-VERIFY.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-174-VERIFY.md","sha256":"3ddb827bec666edb49c0c42df6d41e916b6e009020d625acdd27a08b7c73f710","bytes":2178,"at":"2026-09-11T19:52:05.597Z"}}
closed: "2026-09-11T19:52:05.862Z"
---

B1: bin/tm config with a key and no value calls writeConfig({[key]: undefined}); JSON.stringify drops the key, so what reads like a read deletes it (lib/store.mjs:408-417). B2: the documented 'tm config dispatch.enabled true' (skills/pool/SKILL.md:24, docs/agent-first.md:282, docs/use-cases.md:560) writes a literal top-level 'dispatch.enabled' key the pool never reads. Fix in the config verb, reusing getPath/setPath from lib/settings.mjs:318-333 (export them).