---
id: "TM-523"
kind: "task"
status: "in_progress"
created: "2026-10-09T05:19:55.488Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Subagents launched with isolation:'worktree' are refused heredoc edits and npm ci (88 refusals across 10 subagents)"
epic: "EP-029"
acceptance: [{"text":"The refusing component is identified with file:line or the documented Claude Code behaviour","done":false},{"text":"A subagent in an isolated worktree can edit files and run npm ci through a supported path, or the lead rules say to dispatch a tm worker instead","done":false}]
evidence: []
commits: ["bec824d2"]
blockedBy: []
blocks: []
actor: "@pool"
session: "fd2b831f"
branch: "tm/TM-523-subagents-launched-with-isolation-worktree-are-r"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-523-subagents-launched-with-isolation-worktree-are-r"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-11-01T20:59:26.526Z"
priority: "medium"
touches: [".claude/rules/subagent-worktree-isolation.md","agent-orchestration/docs","task-management/hooks"]
comments: [{"author":"main","ts":"2026-10-09T05:24:46.649Z","text":"Admission deferred 2026-10-09: WIP limit 12 is full. Admit and dispatch when a slot frees (the protocol is ready in the lead's scratchpad)."},{"author":"main","ts":"2026-11-01T20:54:27.123Z","text":"{\"event\":\"start\",\"at\":\"2026-11-01T20:54:26.990Z\",\"owner\":\"fd2b831f\",\"worktree\":\"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-523-subagents-launched-with-isolation-worktree-are-r\",\"branch\":\"tm/TM-523-subagents-launched-with-isolation-worktree-are-r\",\"base_revision\":\"c9cd187ec93aef43a8e513769d3cccbade7d48a5\",\"base_source\":\"server-tip\",\"intent\":\"Implement TM-523 to its acceptance criteria: Subagents launched with isolation:'worktree' are refused heredoc edits and npm ci (88 refusals across 10 subagents)\",\"boundaries\":[\"agent-orchestration/docs\",\"task-management/hooks\"],\"dependencies\":[],\"checks\":[\"agent-orchestration: npm ci\",\"agent-orchestration: unit\",\"agent-orchestration: build:check\",\"task-management: unit\",\"agent-orchestration: plugin validate\",\"task-management: plugin validate\",\"plugin-rsync: tests\"],\"files\":[\"agent-orchestration/docs\",\"task-management/hooks\"]}"}]
governance: {"version":1,"runtime":"topology","workflowRunId":"tm-TM-523","leadId":"fd2b831f","recordPath":"/home/ryan/.local/state/bytedesk/agent-orchestration/management/8890762dbb279261/TM-523.json","state":"working"}
integrationBranch: "main"
dispatched: {"backend":"tmux","run":"tmux:tm-TM-523","session":"fd2b831f","at":"2026-11-01T20:54:38.290Z","anchors":[{"pid":2684718,"start":"241381150"}]}
---

From audit-transcripts.md problem 4. Find which guard refuses (the marketplace worktree guard or Claude Code built-in), document the supported way for a lead to give a subagent write access in an isolated worktree (or route edits through tm dispatch), and fix the guard if it is ours. Evidence paths are in the audit.