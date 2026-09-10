---
id: "TM-151"
kind: "task"
status: "open"
created: "2026-09-10T01:35:36.878Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a ready Claude composer showing a placeholder hint reads as not-ready, in both claude.json ready patterns"
acceptance: [{"text":"A ready pane showing Claude's placeholder hint is detected as ready, in both ready.pattern and ready.tmux_pattern","done":false},{"text":"A pane that is genuinely mid-answer is still not detected as ready","done":false},{"text":"The measurement is redone against a live pane in both states, not reasoned about","done":false},{"text":"All four claude.json fields are decided deliberately and per-field — ready.tmux_pattern, ready.pattern, composer.empty_tmux_pattern, composer.empty_pattern — with the composer TM-111 negative preserved and the choice argued, not inherited by find-and-replace","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "2ee26155-9e57-4cf8-8bc4-a8379f88e5a4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T01:38:20.908Z"
type: "bug"
labels: ["plugin:agent-orchestration"]
priority: "high"
comments: [{"author":"main","ts":"2026-09-10T01:38:05.803Z","text":"IMPLEMENTATION SHAPE, proposed by the TM-135 dispatcher and tested by the integrator. It works. But testing it surfaced that this task is bigger than two fields, and that a blanket fix is dangerous.\n\nTHE PROPOSED SHAPE. Do not reason about \"emptiness\". A placeholder is a fixed known string and real content is not, so the pattern becomes: bare prompt glyph OR prompt glyph followed by this provider known placeholder prefix. For claude that prefix is `Try \"` — the hint always begins that way and only the tail varies. A user or an agent mid-answer does not begin a line that way. It degrades safely: an unseen placeholder reads as not-ready, which is today behaviour, not a regression.\n\nTested candidate: `^\\\\s*[│|]?\\\\s*[>❯]([^a-zA-Z0-9]*$|[^a-zA-Z0-9]*Try \")`\n\n| line | matches |\n|---|---|\n| bare composer `❯ ` | YES |\n| placeholder `❯ Try \"write a test for <filepath>\"` | YES |\n| agent mid-answer `❯ read the inbox file 001-ping` | no |\n| TM-111 plan-approval modal `❯ 1. Yes, and switch to BYPASS PERMISSIONS` | no |\n\nIt also survives assertTmuxPattern: no `{`, `}` or `:`, no newline, no trailing whitespace class.\n\nFOUR FIELDS, NOT TWO. The same two strings are declared in four places in claude.json:\n\n  ready.tmux_pattern           ^\\\\s*[│|]?\\\\s*[>❯][^a-zA-Z0-9]*$\n  composer.empty_tmux_pattern  ^\\\\s*[│|]?\\\\s*[>❯][^a-zA-Z0-9]*$          (identical)\n  ready.pattern                (^|\\\\n)\\\\s*[│|]?\\\\s*[>❯][^a-zA-Z0-9\\\\n]*$\n  composer.empty_pattern       (^|\\\\n)\\\\s*[│|]?\\\\s*[>❯][^a-zA-Z0-9\\\\n]*$  (identical)\n\nDO NOT BLANKET-REPLACE THEM. The composer note says exactly why, and it is load-bearing safety rather than tidiness: the negative is what makes it a COMPOSER test rather than a prompt test. It answers 0 on `❯ read the inbox file 001-ping`, and it answers 0 on the plan-approval modal `❯ 1. Yes, and switch to BYPASS PERMISSIONS` — the TM-111 case where pressing Enter means something destructive. The note also states the two are declared separately BECAUSE codex proves they are not the same question, and a find-and-replace across all four re-conflates precisely what that separation exists to keep apart.\n\nSo: decide per field. For ready.* admitting the placeholder is the fix. For composer.empty_* admitting it is arguably also correct — a composer showing a hint IS empty — but that is a second judgment with TM-111 consequences and must be argued separately, not inherited.\n\nNOTE THE CODEX PRECEDENT RUNS THE OTHER WAY. TM-130 fixed codex by matching ONLY the literal placeholder: `^\\\\s*›\\\\s*Ask Codex to do anything`, no bare-glyph branch at all. So the two adapters would end up with structurally different ready patterns — codex requires the hint, claude admits it optionally. That is defensible, since the CLIs render differently, but whoever implements should state which they chose and why rather than making them look alike.\n\nTWO CONSTRAINTS TO HOLD THE IMPLEMENTER TO, both of which already bit this epic. The tmux form must pass assertTmuxPattern while the JS form has no such limit, so the two will not be textually identical even though they must mean the same thing — that asymmetry is a trap, not an inconsistency to tidy away. And it must be MEASURED against a live pane in all three states — bare, placeholder, mid-answer — with the numbers recorded in the adapter note the way TM-130 did and the way the existing composer note does. Both of these patterns shipped after being verified by reading. That is how they got here."}]
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