---
id: "TM-120"
kind: "task"
status: "in_progress"
created: "2026-09-07T00:23:11.539Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the tmux contract test fails intermittently and its error text has never been captured"
epic: "EP-017"
acceptance: [{"text":"A failing run's full output is captured, including the launch JSON and the pane log of whichever agent did not come up","done":false},{"text":"The cause named in that evidence is fixed, or the test is made robust against it with the reason recorded","done":false}]
evidence: []
commits: ["6328c83","5be70c6"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-07T00:27:15.303Z"
comments: [{"author":"main","ts":"2026-09-07T00:27:15.299Z","text":"First failure captured, and it is not what the timeout wording suggests.\n\nFrom the kept run (iteration 4 of a capture loop, contract test running alongside a live suite), the launch JSON shows ALL THREE agents failing readiness:\n\n  conductor  fake-agent:fable  'started (ready pattern not seen within 30000ms)'\n  worker-a   no-such-cli-zz    'command \"no-such-cli-zz\" not found'   <- expected\n  worker-a   fake-limit:x      'started (ready pattern not seen within 10000ms)'\n  worker-b   fake-agent:w2     'started (ready pattern not seen within 30000ms)'\n\nThe load-and-timeout story does not survive that list. fake-limit is the fixture adapter whose whole job is to print 'You have reached your usage limit' and be caught by a FAILURE pattern — its expected outcome is 'screen matched failure pattern /usage limit/', not a timeout. It timed out instead. So the screen the launcher was looking at had nothing on it at all: neither the ready pattern nor the failure pattern matched anything, for three different adapters, in the same run.\n\nThat points at the SCREEN, not at speed — either the pane genuinely drew nothing, or screenSince() sliced everything away (its baseline anchor returns '' when the marker is found at the end of the capture rather than before the agent's output). Both are testable and neither is 'the machine was busy'.\n\nNote this signature predates today's fixture change: TM-112's original report described exactly it, with the older 10s timeout on every agent. That means TM-112 fixed a real latent hazard but not this, and the 10s->30s raise there was treating a symptom of something else.\n\nNext: the contract test now keeps its scratch tree on failure (it deleted the run, and with it agents/<id>/pane.log, which is the only record of what the pane actually had on it). A capture loop is running to catch it again with that log intact."}]
---

npm run test:contract's tmux case failed 2 of about 9 runs today, and the reason was never captured. Every failure was observed only as a summary line; every deliberate attempt to reproduce it passed.

What is measured:
- Standalone: five consecutive clean passes.
- Alongside a full tests/live/two-projects.sh run: passed, 10.8s.
- Two contract runs concurrently: both passed.
- Failed twice, both while other heavy suites were running, both times seen only as '# fail 1' because a grep discarded the detail.

So the load hypothesis is unconfirmed and its two obvious variants are contradicted. The fixture's ready timeout was already raised from 10s to 30s under TM-112 on a guess about the same thing, which may have been treating a symptom.

The first step is not a fix, it is to stop losing the evidence: loop the contract suite keeping the full output of any failing run, then diagnose. The likely assertion is launched.agents.every(a => a.ready), which already prints the whole launch JSON — that names the agent, the candidate and the reason, and none of it has ever been read.