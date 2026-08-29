# RESULT

## What I would say to the user

I built the r4-p4 "New project" dialog as a single self-contained HTML page and matched it
to the mockup by measurement rather than by eye.

**How it was matched.** I scanned the PNG for luminance edges to get exact box positions
(dialog 450–1136 × 136–782, five-up type-card rows at y 308 and 447, content row at 586,
input 471–1116 × 223–256, Create button 993–1116 × 730–764, sidebar cards, inspector
dividers, thumbnails, toolbar), then rendered the HTML in headless Chrome at the mockup's
exact 1586×992 and iterated against a pixel-difference image and a 50 % overlay until only
sub-pixel text anti-aliasing remained. Every string was transcribed from 2× crops; all copy
in the mockup is legible and is reproduced verbatim (including "IOS and Android
applications" with capital IOS — I kept it as drawn; tell me if you want "iOS").

**Design system.** Type, colour and borders come from the authority's token layer
(`tokens/css/bytedesk.css`): IBM Plex Sans / Plex Mono, `--bd-text-*`, `--bd-brand-orange`
#EC4E02, success/warning/danger dots, and the border ramp. Three surface values the mockup
uses that fall between token stops (shell #0C0F13, panel #0E1216, dialog #171B20) are declared
as clearly-labelled local variables so they're easy to swap for tokens if the authority adds
them. The authority repo was not modified.

**What is not literally pixel-identical.**
- The canvas hero art and the two thumbnails are an abstract smoke + orange filament
  bitmap in the mockup; I recreated them with CSS gradients and an SVG path, so the texture
  is an approximation. If you have the source render, drop it in as an `<img>` in
  `.canvas .art` and `.thumb .art`.
- The mockup is a soft raster render; glyph edges differ at the sub-pixel level. Layout
  boxes, weights, sizes, and copy match. Whole-image RMSE vs the mockup is 8.0 %, almost all
  of it in the artwork region.
- The page is fixed at 1586×992 by design (it's a screen match, not a responsive layout).

## Files (all in this directory)

| File | What it is |
|---|---|
| `new-project-dialog.html` | The page. Open in a 1586×992 viewport. |
| `render-final.png` | Headless-Chrome screenshot of the HTML at 1586×992. |
| `side-by-side-final.png` | Mockup (left) vs render (right), half scale. |
| `compare-overlay-final.png` | 50 % blend of mockup and render — misalignments show as ghosting. |
| `compare-diff-final.png` | Auto-levelled \|mockup − render\|; bright = different. |
| `NOTES.md` | Measurement method, token mapping, known residuals. |

Directory: `skills/bytedesk-designer-translate/evals/workspace/iteration-1/garbled-text-trap/without_skill/outputs/`
