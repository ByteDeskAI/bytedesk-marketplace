---
id: "TM-160"
kind: "task"
status: "done"
created: "2026-09-10T03:59:08.399Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the styled composer check reaches the ring gate but not the landing verdict, so a delivered message reports stuck-in-composer"
epic: "EP-018"
acceptance: [{"text":"A message that was submitted onto a pane that then renders a dim suggestion classifies as submitted, not typed-unsubmitted.","done":true,"at":"2026-09-10T04:10:14.830Z"},{"text":"A pane holding a genuine bright draft still classifies as typed-unsubmitted — the negative that makes the fix safe, and the one TM-151's styled test already encodes.","done":true,"at":"2026-09-10T04:10:14.977Z"},{"text":"The two paths consult ONE implementation, so they cannot drift again — this defect is precisely the drift of a fix applied to one of two callers.","done":true,"at":"2026-09-10T04:10:15.111Z"},{"text":"Driven on a live pane, not only in a unit test: the failure was observed on a real run and the fix should be too.","done":true,"at":"2026-09-10T04:28:24.204Z"}]
evidence: [".bytedesk/task-management/evidence/TM-160-LATE-ACK-VERIFICATION.md"]
commits: ["faae463","8be9365","b583601","5ef6202"]
blockedBy: []
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T04:29:06.492Z"
comments: [{"author":"main","ts":"2026-09-10T04:14:27.787Z","text":"MERGED at 8be9365 as part of the same branch, and NOT closed. Its live-pane criteria stay unticked for the same reason as its sibling: the fix is in, no live run has happened since, and a unit test is not a live verification.\n\nThe defect: the styled composer check reached the RING GATE but not the LANDING VERDICT, so a message that had actually been delivered reported stuck-in-composer while the reply sat in the outbox. Both paths now ask the same question.\n\nThat is the THIRD instance this epic of a fix reaching one of two callers — after the stray-flag guard that epic new carried and edit never received. Two instances were incidents; three is a class, and it now has a rule rather than another task: .claude/rules/verification-that-can-fail.md, merged at b53f5a4.\n\nGates on the merged tree: topology 361/361, unit 538 tests / 534 pass / 4 skipped, build:check 0."}]
blockedReason: "4/4, AC4 earned on a live pane. Same branch as TM-161's caller fix (tm/TM-161-cli-timeout, b583601) because the same live run proved both: the send reported 'ring: scribe | submitted | submitted' and the reply is in the scribe's outbox — where before the merge it reported stuck-in-composer with the reply already written. Blocked on the integrator's merge only."
evidenceSources: {".bytedesk/task-management/evidence/TM-160-LATE-ACK-VERIFICATION.md":{"source":"/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace/2ee26155-9e57-4cf8-8bc4-a8379f88e5a4/scratchpad/LATE-ACK-VERIFICATION.md","sha256":"09f7bc0549f2ed2da5872ca6bf1317720b73738be8b215f46c8a8acae10f375f","bytes":2669,"at":"2026-09-10T04:28:59.773Z"}}
closed: "2026-09-10T04:29:06.487Z"
---

Found by running the demo against MERGED main — an integration check the earlier runs could not perform, because they ran from worktrees.

WHAT HAPPENED. `send conductor -> scribe` reported:

    ring: scribe  stuck-in-composer  typed-unsubmitted

and the message HAD LANDED. The scribe's outbox holds 002-describe.reply.md with a correct, substantive answer read from the repository's README. So the delivery verdict was wrong in the safe direction — it never claimed a success it did not have — but it escalated a message that was delivered and answered.

THE CAUSE IS ONE LINE, and it is a half-applied fix rather than a new defect. TM-151 established that a composer holding only Claude's DIM suggestion text is empty, and that capture-pane -e is the only way to tell that from a bright draft. The styled rescue landed on the SAFE-TO-RING path — checkBellSafe at delivery.mjs:423 and whenSafe at :460 both consult styledRescue. The DID-IT-SUBMIT path does not: classifyLanding's input at delivery.mjs:769 still calls composerEmptyOnScreen, the plain-text pattern.

So after the pointer is submitted, the pane renders a suggestion, the plain check says 'not empty', and the landing is classified typed-unsubmitted. Rung R0 resubmits twice — which is safe, because R0 sends the submit key alone and never re-types — and then the ladder gives up and reports stuck-in-composer on a message the agent is already answering.

WHY IT MATTERS MORE THAN A WRONG LABEL. The census carries undeliveredMessages so the scheduler will not hand new work to an agent holding an undriven message, and status grows an ! UNDELIVERED banner. Both now fire for messages that were delivered. An operator who trusts them stops trusting them, which is worse than not having them.

THE FIX IS TO USE THE SAME ANSWER IN BOTH PLACES. composerEmptyOnScreen is a plain-text predicate over a captured screen, and the styled test needs the pane and a tmux handle, so this is not a one-word substitution — the landing path has to take the styled look the way checkBellSafe does, or classifyLanding has to accept an already-computed styled verdict. Either shape is small; picking one is the work.