# SPEC — Designer Studio workbench (three-column), measured from r3-s5.png

Logical width 1280 × 800 (PNG is 1586×992, scale 1.239). All numbers logical px, measured on
translate/grid-render-failed.png (orange = 100, blue = 20). Layout is per-layout: every studio
state shares this frame; only the centre stage content and timeline change.

## Frame
- Window ground: --bd-bg-base. Outer inset 12 on all sides; panels end at y=788.
- Three panels, each 1px --bd-border-default hairline, radius 6, gap 8 between panels:
  - LEFT   x 12–334  (w 322, 25%)  fill --bd-bg-surface
  - CENTRE x 342–952 (w 610, 48%)  fill --bd-bg-base (stage stays on the ground, unlifted)
  - RIGHT  x 960–1268 (w 308, 24%) fill --bd-bg-surface
- Panel inner inset 16 (left/right), 12 (top).

## LEFT column
- Agent rows ×4, first baseline-centre y=40, pitch 36 (rows at 40/76/111/147), row h 36.
  Columns inside the row: name x=27 (sans 14, primary); status dot Ø8 at x=117 + word at
  x=128 (sans 13, success green); version x=187 (mono 13, primary); "Connect" button
  x 252–321 × h 26 (sans 13, --bd-bg-elevated fill, hairline border, radius 6).
- Hairline divider y=165.
- "Runs" label y=187 (sans 14, primary, x=27).
- Run rows ×5 at y 215/239/262/286/309 (pitch 23.5, h 23): id mono 13 at x=27, status word
  right-aligned to x=321 (mono 13; failed = danger red, ok = success green).
  First row carries an --bd-bg-elevated hover fill spanning x 20–326.
- "View all…" y=332 sans 13 secondary. Divider y=345.
- Timeline y 363–630: entries each start with a header line (sender mono 12 primary +
  timestamp mono 11 secondary, 12 gap) then 1–2 body lines mono 12.5 primary; line pitch 18,
  entry pitch ~65 for two body lines, ~48 for one. Divider y=645.
- Composer textarea x 27–320, y 660–760 (h 100), fill --bd-bg-base, hairline border,
  radius 6, placeholder "Message codex…" mono 13 secondary at inset 8; resize grip bottom-right.
- Send button x 239–320, y 738–767 (81×29), accent fill, on-brand text sans 14, radius 6,
  overlapping the textarea's bottom-right corner by ~22.

## CENTRE column
- Stage area y 14–698 on ground. Content stack centred at x=650 (column centre):
  - Status: dot Ø10 danger red at x=605,y=179; word "exhausted" sans 16 danger red to its
    right (gap 10) — together centred.
  - Attempts disclosure panel x 462–839 (w 377), y 208–295 (h 87), hairline border, radius 6,
    fill --bd-bg-base (same as ground). Three mono 13 rows, pitch 22, first row y=229; a ▸
    caret at x=474 on the first row only. Four aligned columns at x 490 / 600 / 685 / 738:
    name · "exit N" · "300s" · "produced no".
  - Sentence "Codex produced nothing. Nothing was written." mono 13 primary, centred, y=338.
  - "Retry" button x 612–688 (76×31), y 366–397, plain (--bd-bg-elevated, hairline), sans 14.
- Thumbnail strip: one card x 353–449 (w 96) y 583–684 (h 101), 1px accent-orange border
  (selected), radius 6, hollow; inner hairline rule at y=658 and label "r1-a" mono 12 centred
  in the bottom 26px band. No other slots.
- Hairline divider y=698.
- Toolbar y 710–752 (h 42): four buttons w 132, gap 14, starting x=358:
  Re-render 358–489 (accent fill, on-brand text), New variant 504–636, Ask agent 650–781,
  Blind read 796–928 (plain: --bd-bg-elevated, hairline). Labels sans 15.

## RIGHT column (inspector)
- Inner left inset 16 (text x=976). Three stacked sections, hairline dividers at y=211 and 420.
- Section heading sans 16 primary: "Brief" y=36, "Art direction" y=240, "Critique" y=447.
- Brief body: sans 13 primary, line pitch 22, first line y=65, 5 lines.
- Art direction: 5 bullets (· glyph at x=976, text x=990) sans 13, pitch 25, first y=272.
- Critique: 6 lines mono 12.5 primary, pitch 23, first y=479.

## Type & material
- Sans = var(--bd-font-sans), mono = var(--bd-font-mono). Body 13, labels 14, buttons 14–15,
  headings 16, status word 16. Weight regular throughout; headings medium.
- Matte: no shadows, no glow, no gradients. Radius 6 everywhere. Accent only on Send,
  Re-render and the selected thumbnail outline.

## Mockup INVENTED — do not build
- Nothing structural in this frame is invented (no title bar in r3-s5). The stage has no
  image in this state, so no placeholder is needed.
- The dotted underline under "direct" and "300s" in the attempts table is rendering noise.
