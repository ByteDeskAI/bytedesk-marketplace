# RESULT — r3-s5 "render failed / attempts exhausted" → surfaces/render-failed.html

Deliverable: `surfaces/render-failed.html` (loads `surfaces/tokens/bytedesk.css`, vendored from design-system @ 9845b41, `.source-sha` beside it).
Token-only colour (grep for hex/rgb/hsl is empty), `data-bd-product="designer-studio"`, IBM Plex Sans/Mono via the authority's tokens, fixed 1280×800.

What I did: preflight (codex-cli 0.146.0 exec OK, Playwright 1.62.1), authority-doctor CONNECTED, gridded the mockup (scale 1.2391),
wrote `translate/SPEC.md` (rects, pitches, type sizes, copy, invented-element list), handed Codex the build prompt, then patched only what
the diff and my eye named. Codex produced on attempt 1 every round. I never wrote markup.

| round | change | layoutScore | pixelDiff | note |
|---|---|---|---|---|
| r1 | build from SPEC | 0.9648 | 0.0705 | structure correct; Brief wrap, timeline clip, mono sizes |
| r2 | 4 patches (Brief box, mono sizes) | 0.9676 | 0.0667 | Brief fixed; timeline narrowed → 5th entry hidden |
| r3 | timeline box 290px | 0.9676 | 0.0667 | no change: 11px mono still 297px — spec wrong, re-measured → 10.5px |
| r4 | mono 10.5px (exception) | 0.9675 | 0.0667 | line fits; entry pitch still 5px over |
| r5 | entry gap/offset (2nd exception, disclosed) | 0.9675 | 0.0651 | done; remaining hotspots are Brief text speckle |

layoutScore is the surface↔mockup number (ceiling ~0.97 by design); pixelDiff against a generated PNG is reported only for the record.
Implementation gate not run: no URL was given. Two rounds beyond the three-round ceiling — both fixed visible clipping with measured numbers; see `translate/notes.md`.

Files:
- `surfaces/render-failed.html`, `surfaces/tokens/bytedesk.css`, `surfaces/.source-sha`
- `translate/SPEC.md` (with the two re-measurements marked), `translate/grid-render-failed.png`, `translate/notes.md`
- `translate/prompts/render-failed-r1..r5.txt`, `translate/render-failed-r{1..5}-reply.txt`, `*-log.txt`, `*.attempts.json`, per-round HTML `translate/render-failed-r1..r4.html`
- `translate/shots/render-failed-r1..r5.png`, `translate/diff/render-failed-r1..r5/{diff.png,report.json}`
- `state.json`
