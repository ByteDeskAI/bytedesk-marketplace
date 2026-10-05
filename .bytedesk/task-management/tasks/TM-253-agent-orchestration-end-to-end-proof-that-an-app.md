---
id: "TM-253"
kind: "task"
status: "blocked"
created: "2026-09-25T18:03:22.953Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: end-to-end proof that an approved plan runs to cleanup with no prompt, and refuses without a grant"
epic: "EP-024"
acceptance: [{"text":"In a temporary enrolled repo, a lead in auto mode, authorized either by a live delegation or by the ADR-0027 server-side policy, runs admit, integrate, landing, close, cutover and cleanup with no prompt and no refusal.","done":false},{"text":"The same repo shows ao-topology itself refusing with no grant, with an expired grant, with a policy naming a different lead, and from a worker session.","done":false}]
evidence: []
commits: []
blockedBy: ["TM-250","TM-251"]
blocks: []
actor: "main"
session: "40645e47-066b-4937-abc2-55d42e9ea247"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["plugin:agent-orchestration"]
triagedBy: "human"
updated: "2026-10-02T05:15:42.815Z"
comments: [{"author":"main","ts":"2026-09-25T18:03:36.824Z","text":"Design suggestion from gateway lead d60f0608's research agent, 2026-09-25 (suggestion, not a decision): refusal tests: wrong SHA, wrong base, red CI, task outside the plan, expired grant, changed plan hash, grant made from inside a session, release not from release/*."},{"author":"main","ts":"2026-09-25T20:27:31.137Z","text":"Released from hold: Ryan approved lead autonomy directly in the marketplace lead's session on 2026-09-25 ('Approve all'). Decision recorded as ADR-0022. Still waits on TM-234."},{"author":"main","ts":"2026-10-02T05:14:53.073Z","text":"TM-288 board review (approved by Ryan 2026-10-02): blockers changed to TM-250 and TM-251, since TM-234, TM-243, TM-248 and TM-249 are done or merged (TM-248/249 code is merged; their store status is held only by the governed-completion worktree gate). AC1 now covers both authorities; AC2 lists the refusals."}]
---

Plan from gateway lead d60f0608, 2026-09-25, reported as approved by Ryan in that session ('Approve as written') with the operating model: 'All I should be involved in is the planning and approving plans. team leads should drive the completion and approvals after planning until it is released and cleaned up.' This changes ADR-0001 (merge is PR-level; branch delete is repo-destructive and deploy is external, both always human) and the 'humans merge' rule, so it is held for Ryan's confirmation in the marketplace lead's session and a recorded decision. Part (e). Research notes from the gateway lead: plugins cannot ship permission rules; autoMode settings are read only from user or managed scope; project permissions.allow is honoured and resolves before the classifier; env-var prefixes, $VAR command names and unmatched pipe segments defeat rule matching; after a first refusal the classifier also refuses harmless related calls.