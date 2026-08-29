# SPEC — git-panel state (mockup r5-q3.png)

Logical size 1280×800 (mockup 1586×992, scale 1.2391). Measured on translate/grid-git-panel.png
and by luminance scan (divider/edge positions). Every number below is logical px.

## Columns
| region | x | width | note |
|---|---|---|---|
| left | 0–339 | 339 | hairline at x=339 |
| centre | 340–905 | 566 | hairline at x=906 |
| right | 906–1280 | 374 | |
Ratio 26.5 / 44.2 / 29.2 %. The app's `grid-template-columns: 26fr 46fr 28fr` gives 333 / 589 / 358 — dividers at x=333 and x=922, i.e. −6 px and +16 px from the mockup.
Ground everywhere is `--bd-bg-base`; there is no lighter panel fill behind columns. Dividers are 1px `--bd-border-default`.

## Left column (inset 20; text x=23)
- Solution row: h 42 (hairline y=42). "Solution" 13px muted at x 23; name 15px semibold at x 80; chevron 12px after.
- Agents block: 4 rows, centres y 60 / 87 / 114 / 142 → pitch 27, block top y 47. Columns: name (sans 13, x 23, w 60) · dot 7px x 88 + word 13px x 100 · version mono 12 muted x 178 · Connect button x 250–318 (w 68, h 24, 6px radius, hairline border, elevated face, 12px label).
- Provider rows: gap 12 after kimi; git centre y 180, github y 206 (pitch 26). No Connect button. github version cell shows `ryanhelms` mono.
- Hairline y 224.
- Projects header: "Projects" 15px semibold, centre y 245. No "+ project" control in the mockup (keep the app's ghost button but it is invisible-weight; see invented list).
- Selected project card: 1px `--bd-accent` outline, radius 6, x 19–321 (w 302), y 260–376 (h 116). Caret x 30; name "Marketing site" 15px semibold x 48 centre y 274; git line mono 12 muted x 48 centre y 292; inner runs box x 38–306, y 302–370 (h 68), 1px `--bd-border-default`, radius 4; run rows mono 12 at x 48, centres y 318 / 338 (pitch 20), age right-aligned to x 298 muted; "+ run" mono 12 muted centre y 357.
- Other projects: "Design system docs" centre y 391 (15 semibold, x 48), git line y 408; "Brand campaign" y 432, line y 450. Chevron x 30. Row pitch 41.
- Hairline y 468.
- Conversation header "Conversation" 15 semibold centre y 487. Turns: `<name mono 13>  <time sans 12 muted>` then text sans 13; pairs at y 510/527, 548/565, 586/603, 624/641 → 38 per turn, 17 between the two lines.
- Composer: textarea x 23–318 (w 295) y 660–725 (h 65), surface fill, hairline, radius 6, placeholder "Message agents…" 13px muted. Send: primary, x 260–318 (w 58) y 737–767 (h 30), 13px.
- Wrap check: "Round 2 looks strong. Ready to iterate." 40 ch × 0.5 × 13 = 260 ≤ 295 ✓. "main · ↑2 ↓0 · 3 changed" 24 ch × 0.6 × 12 = 173 ≤ 250 ✓.

## Centre column
- Stage: x 366–880 (w 514), y 63–495 (h 432) → inset 26 from both column edges, 63 from top. Fill `--bd-bg-surface`, radius 6, no border. The stage image is the mockup's fog — masked in compare; the surface draws a flat surface-colour placeholder.
- Thumb strip: two thumbs 113×80 at y 518–598, x 368 and 489 (gap 8), radius 6; r1-a carries a 1px `--bd-accent` outline, r2-a a hairline. Labels mono 12 centred under each, centre y 613.
- Hairline y 644 from x 366 to 880 (not full width).
- Toolbar: 4 buttons h 30 (y 682–712), w 118 each, x 366 / 505 / 644 / 774 (gap ~21; first flush to stage left, last to stage right). Labels 13px. "Re-render" primary; others elevated with hairline.

## Right column (inset 19; text x=925; content width 330 → right edge 1255)
- "Solution" 15 semibold centre y 26; "connected" green dot + 13px word y 52; path mono 12 muted y 78 (`/Users/ryanhelms/work/design-system`); `design-system @ 9f3c1a7 · main · up to date` mono 12 y 107. Hairline y 134.
- "Git" 15 semibold y 158; `ryanhelms/marketing-site` mono 12 y 184; branch select x 925–1255, y 200–228 (h 28), elevated fill, hairline border, radius 6, `main` mono 12 at x 935, chevron right at x 1240; status amber dot + `3 changed · 2 ahead · 0 behind` mono 12 y 248. Hairline y 268.
- Changed files: rows centre y 291 / 319 / 347 (pitch 28); status letter (M, M, A) mono 12 at x 925; path mono 12 at x 945. Hairline y 366.
- "Commit message" 13px muted label y 386; textarea x 925–1255, y 403–458 (h 55), surface fill, hairline, radius 6, value `direction round 2` mono 12 at x 935 y 419.
- Buttons y 468–496 (h 28): Pull x 925–1018 (w 93), Commit primary x 1036–1140 (w 104), Push x 1162–1255 (w 93). Justify space-between. Hairline y 512.
- "Project" 15 semibold y 535; `website · active` mono 12 y 563. No hairline before Brief.
- "Brief" 15 semibold y 607; brief text mono 12, line pitch 19, first baseline centre y 626, 7 lines to y 748.
- Wrap check: `runs/2026-08-28-home-hero/state.json` 36 ch × 0.6 × 12 = 259 ≤ 310 ✓. Brief longest line "Refresh the home hero to communicate clarity," 45 ch × 0.6 × 12 = 324 ≤ 330 ✓ (the mockup wraps at 45–46 ch, consistent).

## Type
- Sans headers 15px semibold (app h2 is 13px — differs), body 13px, small labels/times 12px. Mono 12px everywhere mono appears (mono 13 only for the conversation speaker name). Body line-height 1.5.
- Dots 7px; status word beside it, gap 8.

## Invented by the model — do not build
- The frosted/lighter fill behind the stage (mockup's fog). Surface uses a flat `--bd-bg-surface` placeholder.
- "Conversation" turns from four different agents in one thread with timestamps — kept as copy because the state's left column *is* the timeline, but the app's real timeline has user/agent/tool rows; copy is illustrative.
- Nothing else invented: the mockup follows the q3 brief closely (notes.md marks it "Build this").

## Gaps the state needs that the mockup omits
- "+ project" ghost control in the Projects header (app has it). Keep, ghost weight.
- "resolve / choose…" controls in the Solution section (app has them). Keep, ghost weight, right-aligned.
