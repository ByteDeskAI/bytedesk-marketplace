# Build notes — r4-p4 "New project" dialog

## Method
1. Measured the mockup (1586×992) with ImageMagick luminance scans along rows/columns to get
   every frame edge: sidebar 0–387, canvas 403–1209 × 21–783, inspector 1224–1585,
   dialog 450–1136 × 136–782, type cards (5-up rows at y 308/447, content row at 586),
   input 471–1116 × 223–256, Create button 993–1116 × 730–764, thumbnails at y 790–877,
   toolbar buttons at y 938–972.
2. Zoomed crops (2×) to transcribe every string verbatim. All copy is legible; nothing in the
   mockup is garbled. Transcribed as-is, including "IOS and Android applications" (capital
   IOS) and the "…" ellipses in placeholders.
3. Colors come from the design-system token layer (`tokens/css/bytedesk.css`): IBM Plex
   Sans/Mono, `--bd-text-primary/secondary/tertiary`, `--bd-brand-orange` #EC4E02, status
   colours, border ramp. Surfaces the mockup uses that sit between token stops (shell
   #0C0F13, panel #0E1216, dialog #171B20) are declared as local variables at the top of the
   stylesheet and commented as mockup-measured.
4. Rendered headless Chrome at exactly 1586×992, produced a difference image and a 50 %
   blend overlay, and iterated three times on the residuals (card description type size,
   composer offset, toolbar button widths, canvas art visibility).

## Known residuals
- The mockup is a raster render with soft/uneven anti-aliasing; text edges differ at the
  sub-pixel level. Layout boxes, weights, sizes and copy match.
- The canvas hero image and the two thumbnails are abstract smoke + orange filament. They
  are recreated with CSS radial gradients and an SVG path, not the original bitmap, so the
  texture is an approximation.
- The Website card's description in the mockup has slightly uneven card widths
  (119/114/111/127/134 px) — reproduced as measured rather than normalised to a grid.

## Files
- new-project-dialog.html — the page (open in a 1586×992 viewport; fixed-size by design)
- render-final.png — headless Chrome screenshot of the HTML
- compare-diff-final.png — |mockup − render|, auto-levelled (bright = difference)
- compare-overlay-final.png — 50 % blend of mockup and render
- side-by-side-final.png — mockup (left) vs render (right), half scale
