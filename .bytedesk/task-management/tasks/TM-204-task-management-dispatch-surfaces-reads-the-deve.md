---
id: "TM-204"
kind: "task"
status: "done"
created: "2026-09-14T00:46:42.204Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: dispatch-surfaces reads the developer's live config, so the suite reports the machine"
epic: "EP-021"
acceptance: [{"text":"the test passes a store it owns (tempStore/TM_ROOT) or an explicit config, so the ambient project config cannot change its verdict","done":true,"at":"2026-09-14T01:02:36.298Z"},{"text":"every other test that calls resolveBackend, detectHostCaps or config() without explicit paths is audited the same way, and each either owns its store or is documented as host-dependent","done":true,"at":"2026-09-14T01:02:36.382Z"},{"text":"the failure is reproduced first by setting dispatch.backends in a scratch store and watching the test go red, then fixed","done":true,"at":"2026-09-14T01:02:36.460Z"},{"text":"node --test task-management/tests/unit/*.test.mjs passes with dispatch.backends set and unset in the project store","done":true,"at":"2026-09-14T01:02:36.538Z"}]
evidence: [".bytedesk/task-management/evidence/TM-204-evidence.md"]
commits: ["25b5417","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/120"]
blockedBy: []
blocks: []
actor: "pool"
session: "pool-tm-204"
branch: "tm/TM-204-task-management-dispatch-surfaces-reads-the-deve"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-204-task-management-dispatch-surfaces-reads-the-deve"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-09-14T01:03:30.058Z"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-204","session":"pool-tm-204","at":"2026-09-14T00:46:59.454Z"}
evidenceSources: {".bytedesk/task-management/evidence/TM-204-evidence.md":{"source":"/tmp/tm204/TM-204-evidence.md","sha256":"15c145cad8c957411095525dd70cc8c38329fb2b78209ad3bdc23b19c9b46595","bytes":4619,"at":"2026-09-14T01:02:21.649Z"}}
comments: [{"author":"@pool","ts":"2026-09-14T01:03:29.961Z","text":"PR #120 — https://github.com/ByteDeskAI/bytedesk-marketplace/pull/120. Follow-up for the session-env class filed as TM-205."}]
closed: "2026-09-14T01:03:30.054Z"
---

Found while rebasing TM-198 (2026-09-13). tests/unit/dispatch-surfaces.test.mjs 'keeps an overridden name in its configured place rather than promoting it' calls resolveBackend({ registry, caps: {} }) with no store paths, so lib/dispatch/backend.mjs reads the AMBIENT project config through paths(). This repo's store currently sets dispatch.backends to [tmux, manual] (set by the lead so the pool could work around TM-198), which leaves both 'topology' and 'fake' absent from the configured order; the registry order then wins and the assertion expecting 'fake' fails. Measured at commit 9a616ef: 14 pass / 1 fail with this repo's config, 15 pass / 0 fail with TM_ROOT pointing at an empty store. No code changed between those two runs — the same commit passed in full (1487/1487) two days ago before the config edit. This is the failure mode .claude/rules/verification-that-can-fail.md calls 'the suite was reporting the machine': a green run proves nothing about a commit while any test can read the developer's live store.