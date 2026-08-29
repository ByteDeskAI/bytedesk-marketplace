Tool: codex exec (codex-cli 0.146.0), text mode, via scripts/codex-exec.sh — all three rounds succeeded on attempt 1
Date: 2026-08-28
Requested by: Ryan Helms
Mockup: ~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r4-p4.png — codex image_gen, prompt at that run's prompts/r4-p4.txt; its notes.md already flagged the inspector as bleed ("became an asset inspector — ignore")
Authority: ByteDeskAI/design-system @ 9845b41 (1 uncommitted change in the working tree) — tokens vendored to surfaces/tokens/bytedesk.css (.source-sha)
Logical size: 1280×800 (mockup 1586×992, scale 1.2391)
Status: surface = measured translation; mockup = direction only, not a pixel source
Masks (all rounds): the stage image where it shows around the modal — 326,16,37,601 · 917,16,59,601 · 363,16,554,95

## Round 1 — build
Prompt: prompts/new-project-r1.txt (SPEC.md in full + copy). Hotspots read: 6,18 Send (lum 0.11) · 25,3 inspector · 6,4 Connect · 27,15 inspector.
First compare masked the whole stage rect (326,16,650,601), which also hid the modal — recomputed with the three strips above. Scores: layoutScore 0.9724 (0.978 with the over-mask), pixelDiff 0.0652.
Diagnosis by sampling block colours: the 45% scrim dimmed Send to [136,51,11] vs mock [226,78,1]; modal/type-card/input fills two steps too light (elevated vs mock ≈ subtle); Connect/toolbar buttons filled where the mock is border-only; "Marketing sites and brochure pages" wrapped to 3 lines (wrap check was borderline at 76 vs 74); chevron glyph rendered as a dot; stage names overflowed their columns.

## Round 2 — patch (5 changes, 30 changed lines)
1 scrim 45%→12% · 2 modal/type cards/input → --bd-bg-subtle · 3 inspector column bg base, Connect/toolbar transparent, stage/thumbs base · 4 card padding 9px 6px + letter-spacing −0.1px (wrap now 2 lines) · 5 stage names 8.5px, CSS chevron.
Scores: layoutScore 0.978 (+0.0056), pixelDiff 0.0785. Top hotspots: 6,4 Connect column lum 0.062 · 25,3 inspector (different content by design) · 6,3 Connect · 10,9 type cards 0.037.
Diagnosis: every left-column cell carried the same ~0.05 offset — the mock's cards measure [17,21,25], i.e. one step above ground (--bd-bg-subtle), not two (--bd-bg-surface).

## Round 3 — patch (1 change, 1 line)
Agents/Projects/Conversation cards → --bd-bg-subtle. Codex changed exactly that line (verified by diff).
Scores: layoutScore 0.9824 (+0.0044), pixelDiff 0.0786. Hotspots: 6,4 lum 0.042 (Connect label speckle) · 25,3 / 27,15 / 26,7 inspector, lum 0.07–0.09 — the mock's invented asset-inspector vs the project inspector, different by design · 10,9 0.037, 10,12 0.005, 20,9 0.025 — type-card title speckle.

## Stop
Round 3 is the ceiling; layoutScore moved 0.0044 (< 0.005) and the top non-inspector hotspot is 0.042 with no edge in diff.png — only text and anti-aliasing speckle. The inspector cells will never converge because the content is deliberately different. Final: layoutScore 0.9824, pixelDiff 0.0786 (strict pixelDiff is not the gate against a generated PNG; no implementation URL was given, so no pixelDiff gate was run).
