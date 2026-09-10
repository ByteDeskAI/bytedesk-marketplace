---
id: "TM-111"
kind: "task"
status: "done"
created: "2026-09-06T04:54:59.039Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: Claude's folder-trust modal reads as a launch timeout"
epic: "EP-016"
acceptance: [{"text":"An agent that stalls on a trust prompt is reported as awaiting a human decision, not as a bare timeout","done":true,"at":"2026-09-07T00:02:26.547Z"},{"text":"The precondition is documented where an operator will meet it before their first launch","done":true,"at":"2026-09-07T00:02:26.795Z"}]
evidence: [".bytedesk/task-management/evidence/TM-111-TM-111-trust-modal-attention.md"]
commits: ["cbd176f","1069713"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:38:21.084Z"
comments: [{"author":"main","ts":"2026-09-06T23:57:59.423Z","text":"Reproduced live, and the report's mechanism is inverted. The modal draws '❯ No, exit' as a menu row, and claude.json's ready pattern matched it — so the launch reported ready:true in 5s, not a timeout, and then typed the bootstrap pointer into a modal whose Enter means 'No, exit'. A false ready is worse than the timeout described. Measured on tmux 3.4 against two live panes: the real input box is '❯' + U+00A0 and nothing else (#{C/r:...[>❯][^a-zA-Z0-9]*$} matches at line 29), the modal's menu row does not match that at all (0). Fixed both halves — the pattern no longer matches a menu, and attention_patterns turns the modal into a named, actionable outcome in 5s."}]
closed: "2026-09-07T00:02:46.949Z"
---

A real Claude agent launched into a repository Claude has not seen opens its folder-trust modal — 'Is this a project you created or one you trust?' with No, exit / Yes, I trust this folder. No prompt glyph is ever drawn, so claude.json's ready.pattern cannot match, the agent pays the full 30s timeout_ms, and the launcher reports 'started (ready pattern not seen within 30000ms)' with no indication why. It then sends the bootstrap pointer anyway, into a modal that swallows it.

Reproduced live against a fresh throwaway repo — which is exactly what a test plan tells an operator to create, so this will be the first thing anyone hits.

The evidence is recoverable and that part works well: <run>/agents/<id>/pane.log holds the modal verbatim, because pipe-pane attaches before the shell is touched. That is worth naming in the docs as the first thing to read when an agent times out with a healthy CLI.

Not a false positive like TM-110 — readiness is telling the truth, the agent genuinely is not ready. The question is whether 'waiting for a human' deserves to be a distinct detected state rather than an unexplained timeout. It is a known, matchable screen, and the operator's action differs completely: trust the directory once, versus debug a provider.

Options: detect the trust prompt and report it as its own outcome; or document the precondition prominently and have doctor warn when a consumer repo is not in Claude's trusted list, if that list is readable.