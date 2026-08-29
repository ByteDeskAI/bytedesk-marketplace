Tool: codex exec (codex-cli 0.146.0), text mode, via scripts/codex-exec.sh — every round succeeded on attempt 1 (direct)
Date: 2026-08-28
Requested by: Ryan Helms
Mockup: ~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r4-p4.png — codex image_gen render, prompt at …/prompts/r4-p4.txt (round-4 state walk; notes.md there flags the inspector as bleed)
Authority: ~/Documents/GitHub/ByteDeskAI/design-system @ 9845b41 (1 uncommitted change at read time) — tokens/css/bytedesk.css vendored to surfaces/tokens/design.css (.source-sha)
Logical size: 1280×800 (mockup 1586×992, scale 1.2391)
Status: surface = measured translation; mockup = direction only, not a pixel source
Product scope: data-bd-product="platform" (accent = brand orange, same as the un-scoped default)

## Measuring
Hairlines pixel-scanned on rows y=60/285/330/630/747/835/955 and columns x=15/395/458/1100/1235/1580 (mockup px) and converted at /1.2391; SPEC.md carries the numbers. Column split reads 313/675/292 (24.5/52.7/22.8%), not the briefed 26/46/28 — built to the picture, since that is what was approved.
Invented by the mockup and not built: the asset inspector (Selection r2-a.png, ID/Type/Dimensions/Size/Tags/Notes/History) — replaced by the product's project inspector (r4-p5 shape) in its no-project state; document icons in the transcript.
Masks on every compare: stage-card interior strips and both thumbnails (the fog is not the surface's fog).

## Round 1 — build (prompts/new-project-r1.txt, 144 s)
layoutScore 0.9789 · pixelDiff 0.062 · top hotspots: 6,18 (Send button, lum 0.174) · 10,7 / 15,7 / 12,7 (type-card descriptions, lum ~0.073)
Read: shots/new-project-r1.png, diff/new-project-r1/diff.png. Findings: backdrop far too dark (the mockup barely dims the workbench); descriptions wrap to three lines; inspector Solution path and Project prompts/deliverables overlap — the spec had put more in the 197 px Project section than fits (spec error, corrected); solution row name runs into the chevron; transcript time/speaker not two columns.

## Round 2 — patch (prompts/new-project-r2.txt, 135 s)
Changes: backdrop → color-mix 28 % base; description 11 px + card padding 8/6; inspector Solution one-line path+sha, Project section prompts collapsed to "none yet", deliverables at 21 px pitch; solution-row/chevron and transcript speaker column.
layoutScore 0.9728 · pixelDiff 0.0715 · top hotspot 6,18 lum 0.056 (from 0.174). Score dipped slightly: the lighter backdrop lifts every non-dialog cell, and the mockup's ungoverned text everywhere now registers as speckle rather than being crushed by the dim. Descriptions still three lines on the 94 px cards.
Read: shots/new-project-r2.png, diff/new-project-r2/diff.png.

## Round 3 — patch (prompts/new-project-r3.txt, 136 s)
Re-measured the card type on the grid: description cap height 6.5 logical (≈9.5 px), title 8 (≈11.5 px); SPEC said 11.5/13 — corrected. Changes: description 9.5/13, title 11.5/16; Project settings rows up 7 px to y 655/676/697/718.
layoutScore 0.9740 · pixelDiff 0.0687 · hotspots: 6,18 lum 0.056 (Send button: same rect, residual is button text vs render brightness) · 20,9 lum 0.072 (Desktop app description text) · 25,8 lum 0.036 (mockup's Tags/Add tag vs our Stages strip — invented region) · 10,7 lum 0.045 (Website description).
Read: shots/new-project-r3.png, diff/new-project-r3/diff.png.

## Stop
Round 3 is the ceiling. Top remaining hotspot lum 0.056 sits on the Send button (text residual, not an edge); layoutScore moved 0.0012 since round 2 (< 0.005). Every remaining hotspot is text speckle inside a block or the inspector region the mockup invented. One known text residual: "Marketing sites and brochure pages" still breaks to three lines at 9.5 px in a 94 px card; the mockup's glyphs are narrower than IBM Plex Sans at that size.
No implementation URL was given, so no pixelDiff gate was run; pixelDiff figures above are surface↔mockup and are not a gate.
