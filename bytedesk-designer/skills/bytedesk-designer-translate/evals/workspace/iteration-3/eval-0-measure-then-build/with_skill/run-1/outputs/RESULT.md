# RESULT — translate r3-s5 (studio, render-failed state)

Run folder: `2026-08-28-studio-render-failed/` (design root = this outputs directory, as instructed).

What was done
1. Preflight: codex-cli 0.146.0 answered `OK` on attempt 1; Playwright 1.62.1; authority-doctor CONNECTED on ~/Documents/GitHub/ByteDeskAI/design-system @ 9845b41 (read-only; nothing modified there).
2. Vendored tokens/css/bytedesk.css → `surfaces/tokens/design.css` + `surfaces/.source-sha`.
3. Measured once on the 100/20px grid (plus 2× crops) → `translate/SPEC.md` (column rects, row pitches, type sizes with wrap checks, invented-element list).
4. Codex built the surface from the spec (round 1), then applied a one-region patch (round 2: timeline message tops + header gap). Claude never wrote markup; every Codex call went through codex-exec.sh, text mode, first attempt each time.
5. Each round was shot with Playwright, compared with compare.mjs, and both the shot and diff.png were read before deciding the next step.

Scores (surface ↔ mockup; layoutScore is the gate, pixelDiff is informational against a generated PNG)
| round | layoutScore | pixelDiff | top hotspot lumDiff |
|---|---|---|---|
| r1 | 0.9908 | 0.0592 | 0.003 |
| r2 | 0.9909 | 0.0574 | 0.003 |

Stopped after round 2 per the stopping rule (top lumDiff < 0.04, score moved < 0.005). Remaining diff is glyph grain, not layout. No implementation URL was given, so the pixelDiff gate was not run.

Files
- Deliverable: `2026-08-28-studio-render-failed/surfaces/render-failed.html` (loads `./tokens/design.css`; zero hex/rgb literals, `var(--bd-*)` only)
- `surfaces/tokens/design.css`, `surfaces/.source-sha`
- `translate/SPEC.md`, `translate/notes.md`, `translate/grid-render-failed.png`
- `translate/prompts/render-failed-r1.txt`, `render-failed-r2.txt` (+ `*-reply.txt`, `*-log.txt`, `*.attempts.json`)
- `translate/shots/render-failed-r1.png`, `render-failed-r2.png`
- `translate/diff/render-failed-r1/`, `render-failed-r2/` (diff.png + report.json)
- `state.json`
