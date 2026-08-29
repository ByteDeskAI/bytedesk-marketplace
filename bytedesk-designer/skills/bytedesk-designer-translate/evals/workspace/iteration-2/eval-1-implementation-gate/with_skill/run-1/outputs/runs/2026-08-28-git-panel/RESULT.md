# git-panel — translate result

Run folder: `runs/2026-08-28-git-panel/` (this directory). Deliverable: `surfaces/git-panel.html`,
which loads `surfaces/tokens/app-global.css` — a byte copy of `app/src/styles/global.css` with
only the `@import` path rewritten — so every remaining difference between surface and app is a
markup or rule difference the app can adopt. No hex, no rgb() in the surface (grep-verified).
Mockup: `r5-q3.png` (Codex image_gen, 1586×992 → 1280×800 logical, scale 1.2391).
Authority: design-system @ 9845b41; the app's vendored tokens are at de482617 (2 lines behind: an
`agent-mail` product accent nobody here uses).

## Per-round scores (surface ↔ mockup, masks on stage 366,63,516,437 and thumbs 368,519,235,78)

| round | pixelDiff | layoutScore | top hotspot (logical rect) | lumDiff | what it was |
|---|---|---|---|---|---|
| r1 | 0.0868 | 0.9875 | 40,80 40×40 (agent rows) | 0.142 | app sheet's `.agents .agent-row` grid beat the surface's rule; Connect buttons wrapped under the names |
| r2 | 0.0840 | 0.9902 | 400–600,560 (thumbnail row) | 0.209 | illustration cell — skipped per loop rules; first chrome hotspot 40,240 lumDiff **0.032** |

Stopped after round 2: top chrome hotspot < 0.04 and layoutScore moved 0.0027 (< 0.005). Residual is
the model's text grain versus real glyphs (speckle inside blocks in `translate/diff/git-panel-r2/diff.png`,
no edges) and the faint border the mockup gives the unselected thumbnail. pixelDiff against the PNG
is reported for completeness only; it is not a gate and cannot reach zero against a generated image.

Round 2 changed exactly six rules (verified by diff), all of them "the app sheet wins on specificity":
`.agents .agent-row` grid/gap/padding, `.solution-row` fill/padding/border, `.strip` + `.thumb`
margin/padding/border/min-height, `.row-line` space-between, `.stage` margin, `.toolbar` padding/gap/border.
Those six are also the first six things the app must change — see below.

## Implementation gate — INCONCLUSIVE

`http://127.0.0.1:4174` is the Vite dev build with no Tauri backend. Every `invoke()` in
`app/src/ipc.ts` rejects, so the store's `solution` stays `null`: no Projects list, no agent rows,
no `GitPanel`, no Project section, empty Brief. The screenshot (`translate/shots/git-panel-app.png`)
is the empty shell — "Open a solution to see its projects", "no agent", "Design authority: none".
A pixelDiff against it measures absent content, not drift. Measured anyway so the number exists:
**0.1073 at threshold 16**, hotspots all on the thumbnail row (11,13 / 10,13 / 13,13 / 14,13 =
x 400–600, y 520–560) where the app renders nothing. Do not read that as a drift figure.

To run the gate for real: open the Tauri window with the same solution (`design-system`), the
Marketing site project selected and expanded, run `2026-08-28-home-hero` open, and shoot that
window's Vite URL (or the WebView) at 1280×800; then
`node scripts/compare.mjs translate/shots/git-panel-r2.png <app.png> translate/diff/git-panel-app --threshold 16`.
Fonts: neither the app nor the token sheet loads IBM Plex; both resolve it from the system
(present on this machine as IBM Plex Sans Var / Plex Mono). On a machine without it every line box
shifts on both sides equally — but the app should bundle the faces the sheet names.

## Where the app differs from the mockup, in pixels

Measured by luminance-edge scan of the app shell screenshot vs the measured surface (both 1280×800).
Rows marked *shell* were measurable in the empty state; rows marked *rule* come from reading
`global.css` against the spec, because the element does not render without a backend.

| # | region | app today | spec (measured) | delta | how |
|---|---|---|---|---|---|
| 1 | column dividers (*shell*) | x = 333 and 922 (`26fr 46fr 28fr`) | x = 340 and 905 | left +7, right −17; centre 589→564 | `.shell { grid-template-columns: 340px 1fr 374px }` |
| 2 | Solution row (*shell*) | hairline y = 39; surface fill; 8px 10px padding | hairline y = 43; no fill; text at x 24 | +4 tall, fill removed, inset +14 | `.solution-row { height:43px; padding:0 24px; background:transparent; gap:0 }` |
| 3 | left-column inset (*shell*) | text starts x = 10 (`.block` padding 8px 10px) | x = 24 | +14 | `.block { padding: 6px 22px 6px 24px }` |
| 4 | agent rows (*rule*) | grid `6ch 1fr 7ch auto`, gap 8, row pitch 27 (pitch already right) | columns at x 24 / 86 / 98 / 176 / 249, pitch 27; Connect 70×20, 12px label | button 26→20 tall, columns fixed | `.agents .agent-row { grid-template-columns:62px 12px 78px 73px 70px; gap:0; height:27px; padding:0 }` `.agents .agent-row button { width:70px; height:20px; padding:0; font-size:12px }` |
| 5 | agents / providers blocks (*rule*) | one block | agents y 44–162 (hairline 162), providers y 163–223 (hairline 223) | providers split off | give the two provider rows their own `.block` |
| 6 | Projects heading + active card (*rule*) | heading at block top; card `padding-bottom:4px`, runs inset 22 | heading centre y 244; card x 20–322 (302×116), name x 48, branch line mono 12px, runs inset 48, run pitch 20, collapsed row pitch 41 | card −2 x, runs +26 | `.projects .project.active { margin:0 -4px; padding:6px 0 8px; height:116px }` `.projects .runs { padding-left:44px }` `.projects .project-row { padding:2px 4px 0 8px }` |
| 7 | Conversation head (*shell*) | `.pane-head` 36px surface bar with border at y 183–220 | plain semibold heading "Conversation" centre y 487 on the ground, block hairline at y 468 | bar removed | `.agent-pane .pane-head { background:transparent; border:0; min-height:0; padding:12px 24px 0 }` |
| 8 | messages (*rule*) | `.msg` bubbles: surface fill, 1px border, 8px 10px padding, gap 8 | no bubbles: mono name + muted 12px time on one line, 13px body below, group pitch 38, x 24 | fills/borders removed | `.msg.agent, .msg.user { background:transparent; border:0; padding:0 }` `.timeline { padding:6px 24px; gap:8px }` |
| 9 | composer (*shell*) | surface bar with top border at y 706, textarea x 10–263 beside Send | textarea x 24–318 (294×68) at y 658; Send 58×32 at x 260–318, y 736 below it | Send moves under; bar removed | `.composer { flex-direction:column; align-items:flex-end; gap:10px; background:transparent; border:0; padding:0 22px 32px 24px }` `.composer textarea { width:294px; height:68px }` `.composer .primary { width:58px; height:32px }` |
| 10 | stage (*rule*) | `margin:12px 12px 0`, flex-filled | rect x 366–882, y 63–500 (516×437) | left +13, top +51, width −49 | `.stage { margin:63px 23px 0 25px; flex:0 0 437px }` |
| 11 | thumbnail strip (*rule*) | `.strip` border-top, margin-top 12, padding 10px 12px, min-height 100; `.thumb img` 96×64 radius 3, 2px padding | thumbs 115×78 radius 6 at y 519, x 368 and 490 (gap 7), labels mono 13px centre y 611; no hairline above; hairline BELOW at y 645 | thumb +19×+14, ~21 px higher | `.strip { border:0; margin:19px 0 0; padding:0 27px; min-height:0; gap:7px }` `.thumb { padding:0 } .thumb img { width:115px; height:78px; border-radius:6px }` `.thumb.active { outline:1px solid var(--studio-accent); outline-offset:-1px }` |
| 12 | toolbar (*shell*) | buttons at y 760–788 (bottom-anchored), padding 10px 12px, gap 8; Re-render starts x 346 | buttons y 682–713 (h 31), x 364–882, gap 21, widths 119/118/109/107 | 78 px higher, +18 x | `.toolbar { border:0; padding:36px 23px 0; gap:21px } .toolbar button { flex:1; height:31px; padding:0 }` — hairline stays, at y 645 |
| 13 | inspector inset (*shell*) | section padding 10px 12px → text x 934 | text x 926, right edge 1254 | −8 (with the divider moved: 906+20) | `.inspector section { padding:12px 26px 12px 20px }` |
| 14 | Solution section (*shell*) | hairline y = 129; extra rows (resolve/choose…, root, doctor output) | hairline y = 135; heading y 24, status y 52, path y 78, `design-system @ …` y 106 | +6 tall; extra rows are app-only, not in mockup | keep the extra controls if wanted, but the four measured rows come first; `.inspector section { gap:8px }` |
| 15 | Git status rows (*rule*) | `.row-line` `space-between` (branch left, `@ sha` right); `.status` dot row | branch is a 328×28 select-styled control (mono "main", chevron right) at y 200; status row y 248 with amber dot | control replaces text row | style the branch row as a bordered 28px control: `.git .row-line { height:28px; padding:0 10px; border:1px solid var(--studio-border); border-radius:var(--studio-radius); background:var(--studio-surface) }` |
| 16 | changed files (*rule*) | `.changes` gap 1px, 12px mono → ~19px pitch | 13px mono, pitch 28, letter at x 926, path at x 946; hairlines above (y 269) and below (y 367) | +9 per row | `.git .changes { gap:9px; font-size:13px; padding:10px 0; border-top:1px solid var(--studio-border); border-bottom:1px solid var(--studio-border) }` `.git .changes .muted { display:inline-block; width:20px }` |
| 17 | commit message (*rule*) | single `input`, ~30px | muted label "Commit message" (y 387) + 328×55 field (y 403–458) | +25 tall, label added | `.git input { height:55px }` (or a 2-row textarea) plus a `.muted.small` label above |
| 18 | Pull / Commit / Push (*rule*) | auto-width buttons, gap 6 | 92 / 104 / 92 wide, 30 tall, gaps 18–22, spanning x 926–1254 | full width | `.git .actions { gap:18px } .git .actions button { flex:1; height:30px }` |
| 19 | Project section (*rule*) | name 15px semibold + mono type · status · created + brief prompts / deliverables / stages lists | heading "Project" y 536, one mono line "website · active" y 565; no hairline before Brief | app shows more than the mockup | app-only content; keep, but the heading/line come first and section height is 96 |
| 20 | dots (*rule*) | `.dot.busy` pulses | static | animation | optional: `.dot.busy { animation:none }` (mockup is a still; a pulse is a legitimate app choice) |

Column-width change (#1) alone moves every right-column x by −17 and every centre x by +7; apply it
first, re-shoot, then the rest. Items 4, 9, 11, 12 are the visible hotspots the r1 diff named; the
others come from the spec.

## Honest limits
- The mockup's stage fog and thumbnail images were masked and stand in as flat `--studio-surface` /
  `--studio-elevated` blocks. The rects are measured; the content is not the surface's business.
- The mockup invents a 3px window frame and a faint box around the run rows; neither is built.
- Text positions are ±2 px: the mockup's glyphs are model-drawn, so baselines were taken from
  row centres, not from letterforms.
- Nothing under `app/` or the authority was touched; the surface's six round-2 overrides exist only
  because it shares the app's sheet — they are the diff between the two, spelled out.
