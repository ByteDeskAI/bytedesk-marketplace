---
id: "TM-140"
kind: "task"
status: "done"
created: "2026-09-09T21:54:31.722Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: lead ensure/assign throw on supervision failure while every other verb degrades"
epic: "EP-018"
acceptance: [{"text":"The lead handler's two direct startRepositorySupervision call sites go through the same non-fatal ensureSupervision wrapper as every other verb, so lead ensure and lead assign degrade rather than throw when supervision cannot start.","done":true,"at":"2026-09-10T01:13:35.271Z"},{"text":"A test asserts the degradation: with supervision made to fail, lead assign still returns its result with a supervision field reporting the failure, and exits 0.","done":true,"at":"2026-09-10T01:13:35.526Z"},{"text":"Whichever behaviour is chosen is the SAME for lead assign and role assign lead — verified by a test that drives both surfaces and compares, so the two cannot drift again.","done":true,"at":"2026-09-10T01:13:35.757Z"}]
evidence: [".bytedesk/task-management/evidence/TM-140-TM-140-141-INTEGRATION-VERIFICATION.md"]
commits: ["14b3ecd","73536a1"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:17:32.424Z"
comments: [{"author":"main","ts":"2026-09-09T23:40:04.369Z","text":"In progress with a live teammate, spawned this session as part of the EP-018 close-out wave. Nothing committed to its branch yet; work is in flight in its own worktree. Deliberately not merged or closed early: every worker this session returned at least one finding that changed the outcome, and two of those were bugs that a green diff and a passing test both agreed with — an unreachable retry rung whose stub reported an empty composer forever, and a brief instruction that would have granted the same cutover slot to two agents. The lead session owns the merge, the gates and the closure."},{"author":"main","ts":"2026-09-10T01:17:32.420Z","text":"Reconciled by the mainline integrator. Status was already correct — the fix is on main and verified (topology-supervision-consistency.test.mjs 3/3, npm run test:topology 294/294, npm run test:unit 465 pass / 4 skipped, matching the wave-2 baseline). The provenance was not: this task recorded commits 59ca483 and 04d26a6, and neither carries the fix. 59ca483 is TM-142's merge (mailbox.mjs, topology-addressing.test.mjs) and 04d26a6 is a rules/agent-scaffolding commit. The real change is 14b3ecd, merged at 73536a1 — topology/cli.mjs, topology/lib/supervision.mjs, and the new topology-supervision-consistency.test.mjs. Corrected to those two.\n\nCause: the git-link hook stamps `git rev-parse HEAD` at hook time onto the active claim, so any commit made while this task held the claim was stapled on regardless of what it touched. That is the same-repo sibling of TM-144 (which fixed the cross-repo case by reading the ref instead of the cwd); the in-repo case is still open and is worth its own task."}]
parkedReason: "session ended (e01dd923-50ea-45d8-9911-b9d5faed94bd)"
evidenceSources: {".bytedesk/task-management/evidence/TM-140-TM-140-141-INTEGRATION-VERIFICATION.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-140-141-INTEGRATION-VERIFICATION.md","sha256":"6dc87d055cdcba7dfade254d0d4076a71c96d7da376f9629bc408c412f491429","bytes":3089,"at":"2026-09-10T01:13:35.014Z"}}
closed: "2026-09-10T01:13:35.992Z"
---

Found by the TM-134 worker while rebasing its CLI patch, and confirmed by the integrator on main at 89b5531. d79db04 introduced ensureSupervision(ctx) — a non-fatal wrapper that returns {started:false, error} rather than throwing — and wired launch, session open and send to it, on the stated reasoning that a repo with no supervisor publishes stale presence, which is a degraded repo and not a failed command. role assign/ensure/reassign now use it too. But the lead handler in topology/cli.mjs still calls startRepositorySupervision DIRECTLY (two call sites inside the lead handler), so a supervision failure makes 'lead ensure' and 'lead assign' throw while the identical operation through 'role assign lead' degrades. Two surfaces onto one operation must not differ on failure handling.