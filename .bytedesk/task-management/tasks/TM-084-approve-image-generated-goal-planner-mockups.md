---
id: "TM-084"
kind: "task"
status: "in_progress"
created: "2026-09-02T18:13:17.872Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Approve image-generated goal-planner mockups"
epic: "EP-013"
acceptance: [{"text":"Canonical task-management product/design authority explicitly permits bounded goal-planning chat while rejecting general chat.","done":false},{"text":"Image-generated design probes and their prompts/metadata are stored under bytedesk/designer/mockups/.","done":true,"at":"2026-09-05T10:58:53.057Z"},{"text":"Mockups cover 390, 1024, and 1440 widths, light/dark themes, and all loading/error/approval/success states.","done":true,"at":"2026-09-05T10:58:53.201Z"},{"text":"The operator approves one direction before production UI implementation begins.","done":true,"at":"2026-09-05T10:58:53.332Z"},{"text":"Mockups include live ACP planner-agent selection, capability/health states, and AG-UI tool/approval streaming.","done":true,"at":"2026-09-05T10:58:53.461Z"}]
evidence: [".bytedesk/task-management/evidence/TM-084-DIRECTION-APPROVAL.md",".bytedesk/task-management/evidence/TM-084-review-manifest.json"]
commits: ["900a13c","f234754","ac1d130","ed282e6","408bb98","23d2825","94466fe","eefd7ae","85b7619","dbc3508","e0ec159","2d67bc2","4482125","42b90de","https://github.com/ByteDeskAI/design-system.git","https://github.com/ByteDeskAI/design-system/pull/57","6b1b3a6","https://github.com/ByteDeskAI/design-system/pull/59","cf741b8","a9ddeca"]
blockedBy: ["TM-083"]
blocks: ["TM-085"]
actor: "main"
session: "01a062eb-2024-7368-bdb3-ad3fcf853ad4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T11:39:48.828Z"
labels: ["ready-for-agent"]
touches: ["bytedesk/designer/mockups/**","design-system/profiles/task-management/**","task-management/lib/planner-ops.mjs","task-management/lib/planner.mjs","task-management/tests/unit/planner-ops.test.mjs","task-management/tests/unit/planner.test.mjs"]
comments: [{"author":"main","ts":"2026-09-05T10:59:05.793Z","text":"AC1 is submitted, not met. The canonical authority is upstream ByteDeskAI/design-system, and the amendment is open as design-system#57 against main. It is NOT self-merged: that repo has branch protection requiring review (reviewDecision REVIEW_REQUIRED), and bypassing the operator's own review gate is not a call an autonomous session should make. TeamCity ci-validate is running on it. Once merged and released, the wording reaches this repo through the normal pin-and-Renovate path (.design-system.json currently pins task-management 2.2.1).\n\nNote the amendment shipped is NOT the wording in profile-amendment.md. That draft targeted the vendored 2.2.1 headings (## Product purpose, ## Product promises, ## Primary journeys, ## Success criteria), none of which exist on upstream main any more — PRODUCT.md has been restructured around ## Purpose, ## Implemented functional areas, ## Cross-application scenarios and ## Anti-references and boundaries. Every anchor was re-targeted; the architecture went in as a Proposed cross-application scenario rather than a product promise, so an unbuilt surface does not read as shipped; and the anti-chat boundary was strengthened rather than merely excepted.\n\nAC 2-5 are met. The direction is approved under delegated authority (DIRECTION-APPROVAL.md) and flagged for operator confirmation. AC3 is now literal rather than partial: 24 captures under .bytedesk/designer/mockups/review/ cover 390/1024/1440 x light/dark x loading/error/approval/success, zero page and console errors, each asserting the prototype actually rendered the scenario requested rather than silently falling back. That pass found one real defect and fixed it: the store's verbatim refusal is a <pre>, white-space:pre refuses to wrap and overflow-wrap cannot override it, so any refusal wider than its panel was cut off — preserving exact wording and then hiding half of it. Now pre-wrap."}]
---

Use a separate Codex GPT-5.6 Sol design role to derive a bounded goal-planning chat from the canonical design profile. Produce image probes and code-native responsive mockups before production UI work, storing every artifact under bytedesk/designer/mockups/.
