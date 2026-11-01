---
id: "TM-528"
kind: "task"
status: "in_progress"
created: "2026-10-09T09:41:59.509Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Admission base anchors on a stale default branch and can never narrow; reviews of Passport tasks cover 1,000+ unrelated files"
epic: "EP-029"
acceptance: [{"text":"A started task record can be re-based to the server merge-base of the configured target_branch, with a recorded event","done":false},{"text":"Admission warns or refuses when target_branch is unset and the default-branch base differs from the PR base","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: ["TM-543"]
actor: "pool"
session: "fd2b831f"
branch: "tm/TM-528-admission-base-anchors-on-a-stale-default-branch"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-528-admission-base-anchors-on-a-stale-default-branch"
filedBy: {"board":"bytedeskai/bytedesk-passport","agent":"a01e40af","task":"TM-262"}
triagedBy: "human"
updated: "2026-11-01T21:02:36.194Z"
priority: "high"
links: [{"type":"relates to","id":"TM-526"}]
comments: [{"author":"main","ts":"2026-10-09T09:46:49.728Z","text":"Verification target: Passport PR #87 (bytedesk-passport) sets management.target_branch=program/passport-goals-import. It is a protected key (TM-442), so it needs the operator's merge (Ryan). TM-528's fix must be proven against Passport once #87 is on its main: re-base TM-262 (expected 31 files against program/passport-goals-import, not 1,022 from f0b29dd), then TM-258 and TM-265."},{"author":"main","ts":"2026-11-01T20:52:17.292Z","text":"Triaged by lead fd2b831f 2026-11-01: accepted as high. Fix belongs in agent-orchestration/topology/lib/management.mjs admissionBase + resumed-admission path: add a lead/operator-attributed re-base verb that recomputes base from server tip of target_branch, refuses unless the new base is a server ancestor of the finish revision, and records a base-narrowed event. Requested by bytedesk-passport lead a01e40af (blocks Passport TM-258/262/265)."},{"author":"main","ts":"2026-11-01T20:53:22.658Z","text":"{\"event\":\"start\",\"at\":\"2026-11-01T20:53:22.539Z\",\"owner\":\"fd2b831f\",\"worktree\":\"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-528-admission-base-anchors-on-a-stale-default-branch\",\"branch\":\"tm/TM-528-admission-base-anchors-on-a-stale-default-branch\",\"base_revision\":\"8189a6bd34faf7bcb0885492301c2d12078b3c8a\",\"base_source\":\"server-tip\",\"intent\":\"Add a lead/operator-attributed, server-verified re-base of a started task record onto the merge-base of management.target_branch (recorded base-narrowed event; refuse unless new base is a server ancestor of the finish revision), and warn/refuse at admission when target_branch is unset and the default-branch base differs from the PR base.\",\"boundaries\":[\"agent-orchestration/topology/lib/management.mjs\",\"agent-orchestration/topology/cli.mjs\",\"agent-orchestration/tests\",\"agent-orchestration/dist\",\"agent-orchestration/CHANGELOG.md\",\"agent-orchestration/package.json\"],\"dependencies\":[],\"checks\":[\"agent-orchestration: npm ci\",\"agent-orchestration: unit\",\"agent-orchestration: build:check\",\"task-management: unit\",\"agent-orchestration: plugin validate\",\"task-management: plugin validate\",\"plugin-rsync: tests\"],\"files\":[\"agent-orchestration/CHANGELOG.md\",\"agent-orchestration/dist\",\"agent-orchestration/package.json\",\"agent-orchestration/tests\",\"agent-orchestration/topology/cli.mjs\",\"agent-orchestration/topology/lib/management.mjs\"]}"}]
touches: ["agent-orchestration/CHANGELOG.md","agent-orchestration/dist","agent-orchestration/package.json","agent-orchestration/tests","agent-orchestration/tests/unit/topology-management.test.mjs","agent-orchestration/topology/cli.mjs","agent-orchestration/topology/lib/management.mjs"]
labels: ["ready-for-agent"]
governance: {"version":1,"runtime":"topology","workflowRunId":"tm-TM-528","leadId":"fd2b831f","recordPath":"/home/ryan/.local/state/bytedesk/agent-orchestration/management/8890762dbb279261/TM-528.json","state":"working"}
integrationBranch: "main"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-528","session":"fd2b831f","at":"2026-11-01T20:53:46.696Z","anchors":[{"pid":2620428,"start":"241375991"}]}
---

Repo: bytedesk-passport (consumer). Component: agent-orchestration/topology/lib/management.mjs admissionBase() (lines 538-579) and the resumed-admission path (lines 651-663).

What happens: with no management.target_branch in the consumer config, admissionBase anchors on the default branch (main). Passport main is far behind the real integration branch program/passport-goals-import, so every task got base f0b29dd (main, 2026-09-11). The review ranges then cover more than 1,000 files of other tasks work:
- TM-262 at 6d510be: 1,022 files (31 against program/passport-goals-import)
- TM-258 at 3be57c5: 1,108 files (13 in scope)
- TM-265 at 461e239: 1,050 files
The reviewer correctly requested changes on all three for the range alone. TM-258 code is otherwise approvable.

Why it is stuck: a resumed admission only ever WIDENS base_revision (TM-349, line 657). Even after the operator sets management.target_branch (a protected key), the started records keep f0b29dd. There is no supported way to narrow a base to a server-verified merge-base, and reviewer request inherits the record base.

Reproduce: consumer with default branch behind the integration branch and no target_branch; admit a task whose worktree branches from the integration branch; finish; read review_request.base_revision.

Asked for: a supported, server-verified re-base for a started record when target_branch is (re)configured, for example recompute via server-tip of target_branch, refuse unless the new base is a server ancestor of the finish revision, and record a base-narrowed event with operator or lead attribution. Also: admission should refuse, or at least warn, when target_branch is unset and the default-branch merge-base is not the PR base.