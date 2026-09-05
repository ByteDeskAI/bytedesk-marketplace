---
id: "TM-105"
kind: "task"
status: "blocked"
created: "2026-09-05T11:26:50.225Z"
board: "bytedeskai/bytedesk-marketplace"
title: "design-system TeamCity settings.kts fails to load, marking every build red"
epic: "EP-013"
acceptance: [{"text":"The four Kotlin DSL capture errors no longer appear in the build log","done":false},{"text":"A ci-validate build whose step passes is reported as SUCCESS","done":false},{"text":"The change is reviewed by someone who owns the release/publish trust boundary","done":false}]
evidence: []
commits: ["0d35ce6"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T11:32:47.692Z"
type: "bug"
blockedReason: "Needs an administrator who owns the release/publish trust boundary; settings.kts states that gate in its own header"
priority: "high"
---

Separate from TM-104 and still open after it. Every ci-validate build in ByteDeskAI/design-system finishes FAILURE with 'Failed to load build settings from VCS' and four Kotlin DSL errors: 'Object CiValidate/ReleasePrepare/ReleasePublish/Renovate captures the script class instance. Try to use class or anonymous object instead' (.teamcity/settings.kts lines 66, 102, 124, 188). The cause is a top-level helper - fun BuildType.maskPublishingCredentials() - called from inside each object's BuildType initializer; in a .kts, top-level declarations are members of the script class, so calling one from an object initializer captures that instance. The documented fix is to move the helper into a plain .teamcity/*.kt file so it is a real top-level function rather than a script member.

NOT attempted autonomously, deliberately. settings.kts opens with an EXTERNAL SETTINGS GATE header stating that release preparation and publication stay manual until an administrator has reviewed and installed the immutable runner and authority, and that settings must be pinned from reviewed main/server configuration. That is an explicit administrator boundary tied to a credential trust boundary, and it also governs the ReleasePublish configuration that holds publishing secrets. An autonomous session editing it is exactly the change the header exists to prevent.

Consequence while it stands: the ci-validate STEP passes (build 2084 on PR #59: 178 tests, 0 failures, 'ci-validate PASS', exit 0) but the build is still reported red, so every PR in that repo shows a failing check. design-system#57 (EP-013 profile amendment, TM-084 AC1) and #59 (the Storybook fix) both sit behind it.