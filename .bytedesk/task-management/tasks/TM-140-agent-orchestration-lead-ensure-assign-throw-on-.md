---
id: "TM-140"
kind: "task"
status: "open"
created: "2026-09-09T21:54:31.722Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: lead ensure/assign throw on supervision failure while every other verb degrades"
epic: "EP-018"
acceptance: [{"text":"The lead handler's two direct startRepositorySupervision call sites go through the same non-fatal ensureSupervision wrapper as every other verb, so lead ensure and lead assign degrade rather than throw when supervision cannot start.","done":false},{"text":"A test asserts the degradation: with supervision made to fail, lead assign still returns its result with a supervision field reporting the failure, and exits 0.","done":false},{"text":"Whichever behaviour is chosen is the SAME for lead assign and role assign lead — verified by a test that drives both surfaces and compares, so the two cannot drift again.","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-09T21:54:31.729Z"
---

Found by the TM-134 worker while rebasing its CLI patch, and confirmed by the integrator on main at 89b5531. d79db04 introduced ensureSupervision(ctx) — a non-fatal wrapper that returns {started:false, error} rather than throwing — and wired launch, session open and send to it, on the stated reasoning that a repo with no supervisor publishes stale presence, which is a degraded repo and not a failed command. role assign/ensure/reassign now use it too. But the lead handler in topology/cli.mjs still calls startRepositorySupervision DIRECTLY (two call sites inside the lead handler), so a supervision failure makes 'lead ensure' and 'lead assign' throw while the identical operation through 'role assign lead' degrades. Two surfaces onto one operation must not differ on failure handling.