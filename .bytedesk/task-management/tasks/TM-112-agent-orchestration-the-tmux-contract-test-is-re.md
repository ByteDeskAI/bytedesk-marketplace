---
id: "TM-112"
kind: "task"
status: "done"
created: "2026-09-06T04:55:11.509Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the tmux contract test is red — a ready pattern that spans a line break can never match"
epic: "EP-016"
acceptance: [{"text":"npm run test:contract passes from the plugin directory","done":true,"at":"2026-09-06T23:49:26.219Z"},{"text":"The fixture's ready pattern matches under the per-rendered-line search the launcher actually uses","done":true,"at":"2026-09-06T23:49:26.332Z"},{"text":"Whether the shipped claude and codex patterns can match a prompt at end-of-line is settled either way, with evidence","done":true,"at":"2026-09-06T23:49:26.446Z"}]
evidence: [".bytedesk/task-management/evidence/TM-112-topology-launch.test.mjs"]
commits: ["a49f7da"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-06T23:49:26.885Z"
comments: [{"author":"main","ts":"2026-09-06T23:49:12.559Z","text":"Measured on tmux 3.4 rather than assumed. Two corrections to the report: (1) the fixture declares no tmux_pattern, so it never reached the per-rendered-line search — it took the JS polling path, where a newline pattern does match, and the tmux contract test passes today. The report's cause was wrong; the coverage gap behind it was real, because that meant waitReadySubscribed, the path every shipped adapter takes, was untested. (2) The trailing-whitespace question is settled: tmux does trim it (#{C/r:>[[:space:]]} = 0, #{C/r:>$} = 2), and both shipped tmux_patterns already end at the prompt character, so neither can be bitten. The JS patterns end in \\s but run against a captured screen that keeps its newlines, so they match too — verified against a real capture."}]
closed: "2026-09-06T23:49:26.676Z"
---

npm run test:contract fails today, deterministically, from the plugin directory: 'launch → send → wait → status → stop with fake agents in tmux', all three agents reporting 'ready pattern not seen within 10000ms'.

Cause: tests/fixtures/fake-agent.json declares ready.pattern 'ready\\n>' — a pattern spanning a line break — while TM-099 moved readiness to tmux's per-rendered-line content search (#{C/r:}, launch.mjs:299). No single rendered line contains a newline, so the pattern is unmatchable on that path. The fixture predates the change and was never updated; tests/live/two-projects.sh passes because its pattern is single-line ('fake-agent ready').

Demonstrated directly against tmux 3.4:
  tmux new-session -d -s p "printf 'ready\\n> '; sleep 20"
  #{C/r:ready\\n>}  -> 0   (no match)
  #{C/r:ready}      -> 1   (matches)

A related question the same probing raised, NOT yet proven to bite in production and worth checking as part of this: tmux also strips trailing whitespace from a rendered line. For a pane whose last line is '> ', #{C/r:>[[:space:]]} returns 0 while #{C/r:>$} returns 2. Both shipped adapters end their pattern with \\s — claude.json is (^|\\n)\\s*[│|]?\\s*[>❯]\\s and codex.json is (^|\\n)\\s*[›>❯]\\s. If a real agent ever takes its full timeout while its prompt is plainly visible on screen, this is the first thing to check. I could not confirm it end to end because both real launches died earlier on TM-110 and TM-111.

Found while writing the 0.4.0 hand-test plan.