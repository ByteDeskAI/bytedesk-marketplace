# New-project dialog — translated

**Surface:** `surfaces/new-project.html` (loads `surfaces/tokens/bytedesk.css`, vendored from design-system @ 9845b41; no hex anywhere, `var(--bd-…)` only, root `data-bd-product`). Measurements in `translate/SPEC.md`; every Codex prompt, render and diff is under `translate/`.

## What you would hear from me

The dialog is built to the measured numbers: 554×520 modal at (363,111), 26px Name input, three card rows at 72px with 90/104/100px cards, Website outlined in accent, dashed "Define your own", mono footnote, Cancel + accent "Create project" at 99×26. The workbench behind it matches the mockup's geometry (313/676/291 columns, 34px agent rows, 63×20 Connect buttons, thumbnail strip, toolbar with the outlined Re-render).

**One caveat about "exact match".** A generated PNG is direction, not a pixel source — the image model redraws chrome and garbles microcopy every render — so "pixel perfect against the PNG" is not a number that reaches zero, and I do not report a strict pixel diff as the gate. The number that gates "this surface is the mockup" is the coarse layout score, and it landed at **0.982** (its practical ceiling on a good translation is ~0.97–0.98). What remains in the diff is text anti-aliasing and glyph speckle, plus the inspector, which differs on purpose. The number that *can* reach zero is surface ↔ implementation, and that gate was not run because no dev URL was given; when the app is pointed at this surface's stylesheet, a `pixelDiff` under 0.01 is the bar.

**What I changed from the picture, on purpose:**
- The inspector behind the dialog shows the selected project the way the rest of the app does (Solution → Project → Brief prompts → Deliverables → Stages → Brief → Art direction, per r4-p5, with the plugin's real stage names). The mockup's "Selection r2-a.png / ID img_7f2b9c1d / Dimensions / Tags / Notes / History" panel is the model filling space with image-file metadata; the mockup run's own notes already flagged it as bleed.
- The Projects card shows the selected project's row ("Internal docs · active") instead of "No projects yet", so the inspector is not describing a project that does not exist.
- The stage fog and thumbnail imagery are neutral ground-colour placeholders.
- The modal scrim is 12% of ground rather than the token's 72% `--bd-overlay-backdrop`: the mockup does not visibly dim the workbench (Send measures full accent), and matching that was the instruction. Say the word and it goes back to the token.
- Fills follow the mockup's measured luminance using the nearest token: panels and the modal on `--bd-bg-subtle`, buttons border-only. The mockup renders about one token step darker than the system everywhere; the tokens win, so the surface is slightly lighter than the PNG on every fill. That is the authority, not drift.

Type is small (8.5–15px) because the mockup was rendered at 1586px and read as 1280 logical; I built to the measured cap heights rather than "normal" UI sizes.

## Scores per round (layoutScore = gate, pixelDiff = informational)

| round | change | layoutScore | pixelDiff | top hotspot |
|---|---|---|---|---|
| 1 | build from SPEC | 0.9724 | 0.0652 | 6,18 Send, lum 0.110 (scrim dimming it) |
| 2 | scrim 12%, modal fills → subtle, buttons border-only, card padding/wrap, chevron, stage names | 0.9780 | 0.0785 | 6,4 Connect column, lum 0.062 |
| 3 | left cards → `--bd-bg-subtle` (one line changed) | **0.9824** | 0.0786 | 6,4 Connect label, lum 0.042 |

Masks all rounds: the stage image where it is visible around the modal (326,16,37,601 · 917,16,59,601 · 363,16,554,95). Round 1 was first scored with a mask over the whole stage rect, which also hid the modal (0.978); the corrected number is the one in the table.

## Stop reason

Round 3 is the ceiling. layoutScore moved +0.0044 (< 0.005) and the top hotspot outside the inspector is 0.042 with no edge in `diff.png` — text speckle, a coin flip to chase. The inspector cells (25,3 / 27,15 / 26,7 at lum 0.07–0.09) cannot converge because their content is different by design. All three Codex invocations succeeded on attempt 1 (`translate/*.attempts.json`).
