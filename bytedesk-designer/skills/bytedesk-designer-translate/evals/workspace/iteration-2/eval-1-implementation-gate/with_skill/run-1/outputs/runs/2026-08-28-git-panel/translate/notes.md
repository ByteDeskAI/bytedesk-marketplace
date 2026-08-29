Tool: codex exec (codex-cli 0.146.0), text mode, via scripts/codex-exec.sh
Date: 2026-08-28
Requested by: Ryan Helms
Mockup: ~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r5-q3.png — Codex image_gen render, prompt at prompts/r5-q3.txt in that run (1586×992, scale 1.2391 to 1280 logical)
Authority: ~/Documents/GitHub/ByteDeskAI/design-system @ 9845b41 — the surface loads the APP's sheet (surfaces/tokens/app-global.css = app/src/styles/global.css with the import rewritten) which imports the app's vendored tokens (app/.context/design-system, .source-sha de482617). That vendored copy is 2 lines behind authority HEAD (adds --bd-product-agent-mail); nothing this surface uses. Recorded in surfaces/.source-sha.
Logical size: 1280×800
Status: surface = measured translation; mockup = direction only, not a pixel source

## Round 1 — build (prompts/git-panel-r1.txt, 146 s)
Scores: pixelDiff 0.0868, layoutScore 0.9875 (masks: stage 366,63,516,437 and thumbs 368,519,235,78).
Hotspots read: 11,14 (440,560) lum .116 · 10,14 (400,560) .127 · 14,14 (560,560) .047 · 1,2 (40,80) .142 · 9,17 (360,680) .076.
Diagnosis: every structural miss was the app sheet winning on specificity over Codex's single-class rules — `.agents .agent-row` grid (Connect buttons wrapped under names), `.solution-row` surface fill + padding, `.strip` border/margin/min-height (thumbs 21 px low, stray hairline at y 530), `.toolbar` padding/gap (buttons 12 px right, gaps +8), `.stage` margin (12 px right), `.row-line` space-between (status words right-aligned).

## Round 2 — patch (prompts/git-panel-r2.txt, 121 s), six rules appended, nothing else changed (verified by diff)
Scores: pixelDiff 0.0840, layoutScore 0.9902 (Δ +0.0027).
Hotspots: 10,14 / 11,14 / 13,14 / 14,14 / 12,14 all on the thumbnail row (illustration + the 3 px below the mask + label 5 px high) — skipped per loop rules. First chrome hotspot 1,6 (40,240) lumDiff 0.032 < 0.04; 26,17 (1040,680) .024; 2,15 (80,600) .036 — all text speckle in diff.png, no edges.
Stop: both stopping conditions hold (top chrome hotspot < 0.04, layoutScore moved < 0.005). Residual = mockup text grain vs real glyphs, and the unselected thumb's faint hairline border the mockup draws (r2-a) that the surface omits.

## Implementation gate — INCONCLUSIVE
http://127.0.0.1:4174 is the Vite dev build without the Tauri backend: every `invoke()` rejects, so `solution` stays null, no Projects, no agents, no GitPanel, no Project section. The screenshot (shots/git-panel-app.png) is the empty shell. A pixelDiff against it measures absent content, not drift; the number is recorded (0.1073, threshold 16) only so nobody re-runs it expecting otherwise. What COULD be measured on the shell is in RESULT.md (column dividers, row hairlines, insets), by luminance-edge scan of both screenshots.
