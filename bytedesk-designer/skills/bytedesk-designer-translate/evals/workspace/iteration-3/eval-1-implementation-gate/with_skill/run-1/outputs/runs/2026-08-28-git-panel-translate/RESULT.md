# git-panel — translate result

Run folder: `runs/2026-08-28-git-panel-translate/` (design root = the outputs dir given). Surface: `surfaces/git-panel.html` (loads `surfaces/tokens/app.css`, a byte copy of `app/src/styles/global.css` importing the app's vendored `bytedesk.css`; no hex anywhere in the surface). Measurements: `translate/SPEC.md`.

## Scores per round (surface ↔ mockup, masks on the stage and both thumbs)
| round | layoutScore | pixelDiff (informational) | top real hotspot | change |
|---|---|---|---|---|
| r1 | 0.9900 | 0.0868 | cell 1,12 (40,480,40,40) lumDiff 0.057 | build from SPEC |
| r2 | 0.9911 | 0.0848 | cell 1,12 lumDiff 0.053 | brief mono 12→11px; pane-head fill+hairline removed |
Stopped at r2: score moved 0.0011 (< 0.005); the rest is the model's glyphs vs IBM Plex. Cells 10–14,14 in the reports are mask-edge artefacts (2 unmasked rows under the thumbs), not work.

## Implementation gate — INCONCLUSIVE
`http://127.0.0.1:4174` in plain Chromium renders the shell only ("Solution none", "Open a solution to see its projects", no Git section): every Tauri ipc call rejects, so the git-panel state is unreachable. `translate/diff/git-panel-app/report.json`: pixelDiff **0.1077**, layoutScore 0.9628 — this number measures absent content, not drift, and must not be read as the gate. To close the gate, shoot the Tauri window (or add a browser fixture that seeds the store with a solution + project) in the same state, then rerun `compare.mjs translate/shots/git-panel-r2.png <app.png> translate/diff/git-panel-app --threshold 16`.
Hotspot rects from that inconclusive diff (all content presence, listed for completeness): (400,680,40,40) 0.292 · (440,680,40,40) 0.272 · (280,80,40,40) 0.131 · (280,760,40,40) 0.114 · (360,760,40,40) 0.136 · (400,760,40,40) 0.125 · (680,680,40,40) 0.119 · (800,680,40,40) 0.118.

## Where the app differs from the mockup, in pixels (state-independent; measured off the shell shot and `global.css`)
| region | mockup / surface | app | delta |
|---|---|---|---|
| column dividers | x 339 and 906 (339 / 567 / 374) | x 333 and 922 (`26fr 46fr 28fr` → 333 / 589 / 358) | left −6, centre +22, right −16 |
| section headers (h2) | 15px semibold | 13px | −2px |
| body text | 13px | 14px (`body`) | +1px |
| solution row | h 42 | h 40 (padding 8 + line 24) | −2 |
| agent Connect button | 68×24 | auto×~26 (padding 4 10) | size unfixed |
| selected project card | 302×116 at x 19, inner runs box bordered 268×68 | width = column − 20, no inner border | — |
| stage | 514×432 at (366,63), radius 6, surface fill, no border | `margin 12px 12px 0`, flex-fills to the strip: 565×~636 at (346,12), ground fill | inset 26 vs 12; top 63 vs 12 |
| thumbnails | 113×80, gap 8, accent outline on active, label below at 613 | 96×64 (`.thumb img`), gap 8 | −17 × −16 |
| toolbar | y 682–712, buttons 118×30, hairline at 644 spanning the stage width only | flush to column bottom y 760–788, buttons auto×28, hairline full width | −78 in y |
| composer | textarea 295×65 at (23,660); Send 58×30 on its own row right-aligned at (260,737) | textarea 253×74 at (10,716), Send 56×30 beside it at (268,761) | layout differs |
| right inset | text x 925 (inset 19) | text x 935 (`section padding 10px 12px` after divider at 922) | +10 |
| right Solution section | h 134 | h 130 | −4 |
| git file rows | pitch 28, hairlines above/below the list | `gap 1px` ≈ pitch 19, no hairlines | −9 per row |
| branch control | 330×28 elevated, chevron right | plain mono text row | missing control |
| commit message | textarea 330×55 | `<input>` ~30 tall | −25 |
| Pull / Commit / Push | 93 / 104 / 93 × 28, space-between | auto width, 6px gap, left-packed | — |
| conversation header | no fill, no hairline below | `.pane-head` surface fill + 1px border-bottom | remove |
| brief text | mono 11px / 19px lines | textarea 14px sans | — |

## Recommended CSS changes (do not edit app/ — this is the diff to apply in `app/src/styles/global.css`)
The `<style>` block in `surfaces/git-panel.html` is the full list, every rule targets an existing app selector and carries a comment naming the measurement. The ones that move the most pixels:
```css
.shell { grid-template-columns: 339px 567px 374px; }        /* or 26.5fr 44.3fr 29.2fr */
h2 { font-size: 15px; line-height: 20px; }
body { font-size: 13px; }
.stage { margin: 63px 26px 0; border-radius: 6px; background: var(--studio-surface); flex: 0 0 432px; }
.strip { margin-top: 23px; padding: 0 28px; border-top: 0; }
.thumb img { width: 113px; height: 80px; border-radius: 6px; }
.toolbar { margin: 0 26px; padding: 37px 0 0; justify-content: space-between; }
.toolbar button { width: 118px; height: 30px; padding: 0; }
.agent-pane .pane-head { background: transparent; border-bottom: 0; }
.composer { flex-direction: column; align-items: flex-end; gap: 12px; padding: 7px 20px 32px 23px; border-top: 0; background: transparent; }
.composer textarea { width: 295px; height: 65px; }
.composer button.primary { width: 58px; height: 30px; padding: 0; }
.inspector section { padding-left: 18px; padding-right: 25px; }
.git .changes { gap: 0; padding: 8px 0 9px; border-top: 1px solid var(--studio-border); border-bottom: 1px solid var(--studio-border); }
.git .changes li { display: grid; grid-template-columns: 20px 1fr; height: 28px; align-items: center; }
.git .actions { justify-content: space-between; gap: 0; }
.git .actions button { width: 93px; height: 28px; padding: 0; }
.git .actions button.primary { width: 104px; }
.agents .agent-row button.ghost-primary { width: 68px; height: 24px; padding: 0; font-size: 12px; }
```
Markup gaps (not CSS): the branch row should be a 330×28 select-styled control; the commit message should be a 55px textarea; the selected project's runs need the bordered inner box; the brief in the mockup is mono 11px text — the app's textarea editor is a functional choice, keep it but set `font: 11px/19px var(--bd-font-mono)`.

## Provenance
Codex 0.146.0, both rounds attempt 1 direct (`translate/git-panel-r*.attempts.json`). Authority doctor CONNECTED @ 9845b41; the authority's `bytedesk.css` differs from the app's vendored copy only by `--bd-product-agent-mail` (app vendored at de48261) — resync when convenient. No git commands run by me (authority-doctor.sh reads the sha itself). Nothing outside the outputs directory was modified.
