---
id: "TM-151"
kind: "task"
status: "open"
created: "2026-09-10T01:35:36.878Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a ready Claude composer showing a placeholder hint reads as not-ready, in both claude.json ready patterns"
acceptance: [{"text":"A ready pane showing Claude's placeholder hint is detected as ready, in both ready.pattern and ready.tmux_pattern","done":false},{"text":"A pane that is genuinely mid-answer is still not detected as ready","done":false},{"text":"The measurement is redone against a live pane in both states, not reasoned about","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:35:43.322Z"
type: "bug"
labels: ["plugin:agent-orchestration"]
priority: "high"
---

`providers/claude.json` decides a Claude pane is ready with two regexes that both end `[^a-zA-Z0-9]*$`. That forbids letters after the prompt glyph. When Claude renders a placeholder hint into an otherwise empty, ready composer — `❯ Try "write a test for <filepath>"` — the letters in the hint make a ready pane read as not-ready, and `role ensure reviewer` fails with `TOPOLOGY_SESSION_START`.

Measured by the TM-135 dispatcher against a live reviewer pane sitting ready at that placeholder: shipped `tmux_pattern` matched 0 lines; `^\s*❯` matched at line 12; `.` matched 1 as a sanity control. Reproduced twice.

BOTH PATTERNS ARE AFFECTED, not just the one measured. The integrator tested each against the live placeholder string:

| pattern | bare composer | placeholder hint |
|---|---|---|
| `ready.tmux_pattern` — `^\s*[│\|]?\s*[>❯][^a-zA-Z0-9]*$` | match | NO MATCH |
| `ready.pattern` — `(^\|\n)\s*[│\|]?\s*[>❯][^a-zA-Z0-9\n]*$` | match | NO MATCH |

So fixing only `tmux_pattern` leaves the non-tmux readiness path broken in the same way.

Same class as the Codex defect TM-130 fixed: Codex had exactly this shape with `› Ask Codex to do anything`, measured 0, and was corrected. Claude was measured at that time against a pane whose composer happened to be bare, so this case was never seen.

Why it looked like it worked: the lead succeeded only because its composer was bare at the moment of its readiness check. That is a race against what Claude chooses to render, not a property of the role — which is why this reproduces on the reviewer and not reliably on the lead.

The fix must not simply allow any trailing text, or a pane mid-answer reads as ready. It needs to distinguish an empty composer showing a hint from a composer with real content, and that distinction should be stated wherever it lands.