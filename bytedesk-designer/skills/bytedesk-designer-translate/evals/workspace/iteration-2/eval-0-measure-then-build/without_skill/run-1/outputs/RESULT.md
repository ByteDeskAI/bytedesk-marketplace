# Result — failed-render state (r3-s5) as real HTML

## What I did

1. Read the approved mockup `~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r3-s5.png`.
   It is 1586×992 px, i.e. the 1280×800 window at 1.239× — every measurement below was divided by 1.239.
2. Read the design authority (read-only): `design-system/DESIGN.md`, `tokens/css/bytedesk.css`,
   `profiles/README.md`. There is no `profiles/designer` (or studio) profile yet, so only the family
   foundation applies. Per DESIGN.md §10 I did **not** read colour values off the PNG into the page —
   I sampled the PNG only to decide *which* `--bd-*` token each element maps to.
3. Measured the mockup programmatically (pillow edge scans on rows/columns, per-region brightest pixel)
   to get panel boxes, row pitches, control sizes and type sizes, then built the HTML against the
   token layer and iterated three times against a headless-Chrome screenshot at 1280×800.

## Files (all in this directory)

| File | What it is |
|---|---|
| `failed-render.html` | The deliverable. Static 1280×800 page, dark theme, `--bd-*` tokens, IBM Plex Sans/Mono. |
| `screenshot-1280x800.png` | Headless Chrome render of the HTML at 1280×800. |
| `mockup-1280x800.png` | The approved mockup resampled to 1280×800 for 1:1 comparison. |
| `compare-stacked.png` | Mockup (top) over render (bottom). |
| `diff.png` | Pixel difference (auto-levelled) — useful only for spotting structural drift; text anti-aliasing dominates. |
| `RESULT.md` | This file. |

## Token mapping (mockup sample → authority token)

| Element | Sampled | Token used |
|---|---|---|
| Canvas | #0F1215 | `--bd-bg-base` |
| Panels | #14181C | `--bd-bg-subtle` |
| Composer field | #1F2327 | `--bd-bg-surface` |
| Buttons / selected run | #252A2E / #212729 | `--bd-bg-elevated` |
| Panel & section hairlines | #262A2E | `--bd-border-dimmest` |
| Attempts box / field border | #262A2E–#303438 | `--bd-border-dimmer` |
| Button border | — | `--bd-border-default` |
| Re-render / Send / thumb ring | #E63C15 | `--bd-brand-orange` |
| failed / exhausted | #F43725 | `--bd-danger` |
| ok dots + labels | #36B947 | `--bd-success` |
| Body text | ~#F0F2F4 | `--bd-text-primary` (authority value #E6E8EB, kept) |
| Run ids (unselected), placeholder | #D3D7DD | `--bd-text-secondary` |
| Timestamps, disclosure, bullets | #9BA2A7 | `--bd-text-tertiary` |

## Layout facts measured (CSS px)

- Window 1280×800; outer margin 12/14; columns 323 · 613 · 304 with 8 px gaps; panels 772 tall, 1 px hairline, 6 px radius.
- Left: providers 157 (4 rows × 36, Connect 71×28) · Runs 178 (rows 23 px pitch, selected row inset 6) · transcript flex · composer 136 (field 115 tall, Send 82×30 bottom-right with 2 px canvas ring).
- Centre: stage flex; attempts table 384 wide, rows 22 px; Retry 77×32; variants strip 123 tall with 96×102 thumb (2 px orange ring, 27 px caption); action row 38 px buttons 132 wide, 13 px gaps.
- Right: Brief 201 · Art direction 208 · Critique flex. Headings 16 px sans; body 14 px / 22 lh; bullets 12 px mono / 25 lh; critique 11 px mono / 23.5 lh.
- Type: sans 14–15 px for labels/buttons; mono 12 px for ids/versions/attempts/summary; mono 11 px (`--bd-text-console-sm`) for transcript and critique; status 14.5 px mono.

## Known deviations / notes

- Sampled text whites are brighter than `--bd-text-primary` (#E6E8EB). Kept the token per DESIGN.md ("never read a colour value off generated art").
- The Brief paragraph needed two explicit `<br>`s to reproduce the mockup's sentence-per-line wrap — the mockup text is not natural wrapping at that width.
- Mono glyphs in the mockup render slightly heavier than Chrome's IBM Plex Mono at 11–12 px; sizes are matched by advance width, not by visual weight.
- The tokens are inlined as a `:root` subset (with a comment) because this page is a standalone deliverable; in the app they should be `@import`ed from `.context/design-system/tokens/css/bytedesk.css`.
- Not covered (out of scope of the mockup): light theme parity, hover/focus states, richness setting, reduced-motion.
