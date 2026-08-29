# RESULT — render-failed state, translated from r3-s5.png

Followed skills/bytedesk-designer-translate: preflight (codex 0.146.0 OK, playwright 1.62.1),
authority resolved by --authority → CONNECTED @ 9845b41, tokens vendored, mockup gridded and
measured once into translate/SPEC.md, Codex built the surface from the numbers, then one
patch round on the hotspots the diff named. Stopped at round 2 by the stopping rule.

| round | layoutScore | pixelDiff (informational) | what changed |
|---|---|---|---|
| r1 build | 0.9745 | 0.0686 | — |
| r2 patch | 0.9748 | 0.0682 | timeline mono 12.5→11 (no wrapping, 5th entry visible), status +14px up, Runs label +8px up |

Remaining difference is text rendering (model prose vs real IBM Plex), not structure.
No implementation URL was given, so the pixelDiff gate was not run.

## Files (all under this folder)
- surfaces/render-failed.html — the deliverable; loads surfaces/tokens/design.css, no hex/rgb, data-bd-theme="dark"
- surfaces/tokens/design.css + .source-sha — vendored authority sheet
- translate/SPEC.md — measurements + invented-element list
- translate/grid-render-failed.png, translate/mockup-render-failed.png
- translate/prompts/render-failed-r{1,2}.txt — exactly what Codex received
- translate/shots/render-failed-r{1,2}.png, translate/diff/render-failed-r{1,2}/{diff.png,report.json}
- translate/render-failed-r{1,2}-{reply,log}.txt, *.attempts.json — codex transcripts
- translate/notes.md — provenance + per-round decisions
- state.json — viewed screenshots and scores
