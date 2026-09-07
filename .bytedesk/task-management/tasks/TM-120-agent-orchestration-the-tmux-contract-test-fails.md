---
id: "TM-120"
kind: "task"
status: "open"
created: "2026-09-07T00:23:11.539Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the tmux contract test fails intermittently and its error text has never been captured"
epic: "EP-017"
acceptance: [{"text":"A failing run's full output is captured, including the launch JSON and the pane log of whichever agent did not come up","done":false},{"text":"The cause named in that evidence is fixed, or the test is made robust against it with the reason recorded","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-07T00:23:11.546Z"
---

npm run test:contract's tmux case failed 2 of about 9 runs today, and the reason was never captured. Every failure was observed only as a summary line; every deliberate attempt to reproduce it passed.

What is measured:
- Standalone: five consecutive clean passes.
- Alongside a full tests/live/two-projects.sh run: passed, 10.8s.
- Two contract runs concurrently: both passed.
- Failed twice, both while other heavy suites were running, both times seen only as '# fail 1' because a grep discarded the detail.

So the load hypothesis is unconfirmed and its two obvious variants are contradicted. The fixture's ready timeout was already raised from 10s to 30s under TM-112 on a guess about the same thing, which may have been treating a symptom.

The first step is not a fix, it is to stop losing the evidence: loop the contract suite keeping the full output of any failing run, then diagnose. The likely assertion is launched.agents.every(a => a.ready), which already prints the whole launch JSON — that names the agent, the candidate and the reason, and none of it has ever been read.