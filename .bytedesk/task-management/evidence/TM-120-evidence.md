# TM-120 — the launcher was blind, the agents were fine

Captured on 2026-09-06 from iteration 12 of a loop running the tmux contract case, half its
iterations alongside a full `tests/live/two-projects.sh`. The contract test now keeps its scratch
tree on failure, which is what made this readable at all.

## What the launcher reported

    conductor  fake-agent:fable  "started (ready pattern not seen within 30000ms)"
    worker-a   fake-limit:x      "started (ready pattern not seen within 10000ms)"
    worker-b   fake-agent:w2     "started (ready pattern not seen within 30000ms)"

## What was actually on those panes

From `<run>/agents/<id>/pane.log`, escape codes stripped:

    conductor:  fake-agent fable ready
                > Read .../BOOTSTRAP.md and follow it exactly...
                READY
                >

    worker-a:   fake-agent x: You have reached your usage limit. Try again later.

    worker-b:   fake-agent w2 ready
                > Read .../BOOTSTRAP.md and follow it exactly...
                READY
                >

Every pane held exactly what was being waited for. The conductor had already ANSWERED. worker-a
held the line whose whole purpose is to be caught by the `usage limit` failure pattern — in a
healthy run its outcome is `screen matched failure pattern /usage limit/`, measured separately.

So this was never a slow agent, and never a wrong pattern. The launcher never saw the screen.

## Two ways that happens, both now closed

1. `captureAll` returned `""` when the tmux call failed — a timeout included — and `""` is exactly
   what a pane that has drawn nothing yet returns. A failed query was indistinguishable from a
   blank pane. It returns `null` now, the polling loop counts unreadable looks, and the timeout
   message says so instead of blaming the agent.
2. The subscription path decides from pushes only. If the server delivers nothing, nothing in this
   process has ever looked at the pane. It now takes one direct capture at the deadline before
   giving up — which, against this evidence, would have returned `ready` for two agents and
   `screen matched failure pattern /usage limit/` for the third.
