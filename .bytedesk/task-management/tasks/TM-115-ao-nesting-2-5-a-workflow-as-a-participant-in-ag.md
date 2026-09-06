---
id: "TM-115"
kind: "task"
status: "done"
created: "2026-09-06T22:55:06.691Z"
board: "bytedeskai/bytedesk-marketplace"
title: "AO nesting 2/5: a workflow as a participant in agents[]"
epic: "EP-016"
acceptance: [{"text":"A spec naming a child workflow validates, launches the child, and the conductor can send to it by id","done":true,"at":"2026-09-06T23:15:18.930Z"},{"text":"A reply from the child's conductor satisfies wait --from <participant> in the parent","done":true,"at":"2026-09-06T23:15:19.069Z"},{"text":"reply --token works, closing the gap its own error message already promised","done":true,"at":"2026-09-06T23:15:19.195Z"}]
evidence: [".bytedesk/task-management/evidence/TM-115-nested-workflow.sh"]
commits: ["ee6f626"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-06T23:15:19.427Z"
touches: ["agent-orchestration/tests/live/nested-workflow.sh","agent-orchestration/topology/cli.mjs","agent-orchestration/topology/lib/spec.mjs"]
closed: "2026-09-06T23:15:19.423Z"
---

Step 2. A child workflow becomes an entry in agents[] addressed exactly like an agent: {id, workflow, inputs}. The conductor does send --to reviewers / wait --from reviewers and never learns it is a team.

Reuses what exists rather than inventing: agents[].agent (spec.mjs:100-112) is the precedent for a deferred-resolution entry that tolerates a missing cli; cli.mjs:481 already does 'if (!agent?.pane) continue' so a pane-less agent is tolerated on the delivery path — that continue becomes the forward branch; sendMessage and recordReply both already take runDir, so cross-run addressing needs no bridge.

Reply direction: the parent mints the participant's token as for any agent and injects it into the child conductor's launcher env as AO_PARENT_AGENT_TOKEN; the child answers with reply --run $AO_PARENT_RUN_DIR --agent $AO_PARENT_AGENT_ID --token $AO_PARENT_AGENT_TOKEN, satisfying recordReply's existing check unchanged.

Bundled fix: --token is named in recordReply's own error text but was never wired (cli.mjs:525-532). Wire it — required here anyway, since the child conductor already holds its own AO_AGENT_TOKEN for its own run.