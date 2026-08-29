# Git panel vs mockup r5-q3 — implementation gate (without skill)

Frame: 1586×992 (the mockup's size). All coordinates are page pixels in that frame.
Mockup: `mockup-r5-q3.png` (copy of `~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r5-q3.png`).
Authority: `~/Documents/GitHub/ByteDeskAI/design-system/tokens/css/bytedesk.css` — the app's vendored copy
(`app/.context/design-system/tokens/css/bytedesk.css`) lags it by one token (`--bd-product-agent-mail`); nothing the git panel uses.

## Blocker you should know about

`http://127.0.0.1:4174` renders **nothing** in a plain browser — only the `#101316` body. `App.tsx` calls
`ipc.homeDir()/detectProviders()/gitProviders()` in its mount effect; `@tauri-apps/api` `invoke` throws
synchronously without `window.__TAURI_INTERNALS__`, the effect throws, React unmounts the tree, `.shell` never
appears (agent-browser `wait_for('.shell')` times out). `GitPanel` additionally renders `section.git` only after
`ipc.gitStatus()` resolves. So the git panel is not screenshot-able from the dev URL at all.

Workaround used here: `git-panel-app-as-is.html` is the exact `GitPanel.tsx` DOM (with the mockup's data), placed
in the app's `.shell > .col.right > .inspector` grid and styled by the app's **verbatim** `global.css` + tokens
(`app-css/`). Every measurement of "the app" below comes from that render. It is what the app produces, not an
approximation of it — the only thing missing is the Tauri data.

## Files

| file | what |
|---|---|
| `git-panel-match.html` | the surface that matches the mockup (tokens only, measured geometry) |
| `match.png`, `match-git-crop.png` | headless-Chrome render at 1586×992 and its git-region crop |
| `git-panel-app-as-is.html`, `app-as-is.png`, `app-as-is-git-crop.png` | the app's GitPanel with the app's real CSS |
| `mockup-git-crop.png` | mockup git region (x 1122–1582, y 166–635) |
| `side-by-side-git.png` | mockup ｜ match ｜ app |
| `diff-full.png`, `diff-git-match.png`, `diff-git-app-as-is.png`, `heat-full.png` | ImageMagick `compare` outputs |
| `match-metrics.json`, `app-metrics.json` | `getBoundingClientRect()` dumps `[x, y, w, h]` |
| `app-css/` | copy of `app/src/styles/global.css` + tokens (import path rewritten only) |

Renders: `google-chrome --headless=new --window-size=1586,992 --force-device-scale-factor=1` (agent-browser cannot
set a viewport; it was used for the visual acceptance pass of both pages).

## Scores

The mockup is a noisy raster (AI render, ±6 RGB grain, non-flat backgrounds), so pixel counts need a fuzz.
Git region = 460×470 = 216,200 px.

| comparison | fuzz 12% mismatched px | fuzz 20% |
|---|---|---|
| mockup vs **match** (git region) | 15,236 (7.0%) | 10,816 (5.0%) |
| mockup vs **app as-is** (git region) | 35,065 (16.2%) | 25,806 (11.9%) |
| mockup vs match (full frame) | 191,075 (12.1%) — left/centre columns are structural only | 119,399 (7.6%) |

Geometry anchors (mockup measured by luminance scan; match/app by DOM rect):

| element | mockup `x,y,w,h` | match | app as-is | app Δ (px) |
|---|---|---|---|---|
| right column | x 1122, w 460 | 1122, 461 | **1141, 444** | column 16 narrower, border 19 right |
| content gutter | 24 left / 28 right | 24 / 28 | **12 / 12** | −12 / −16 |
| git section | y 166 → rule 635 (469 tall) | 165, 471 | **206, 250** | starts 40 lower, 219 shorter |
| heading "Git" | cap 190–201 (≈17px semibold) | 17px | **13px** "Git — Marketing site" | −4px font, extra suffix |
| remote line | 1150,223 mono 14px, 20px line | 1146,218,20 | **1153,242,17** (11px mono) | −3px font, y +24 |
| branch control | 1146,248,408,35 bordered select, chevron | 1146,248,408,35 | **1153,264,417,18** plain text + sha | −17 tall, no box/chevron |
| status line | dot 11px @1147,302; mono 14px | 297,20 dot 11 | **288,21 dot 7**, sans, pulsing | dot −4, wrong family |
| rule under status | y 333 | 333 | **none** | missing |
| changes list | rows at cap 355/390/425 (35px pitch), 14px mono, 34px status column | 333,122 | **315,52** (16.5px pitch, 11px mono, inline status) | −69 tall, pitch −18.5/row |
| rule under list | y 454 | 455 | **none** | missing |
| "Commit message" label | 1148,475 cap, 15px secondary | 471,22 | **none** (placeholder in input) | missing (−29 incl. margin) |
| commit field | 1146,499,408,68 textarea, mono 14, bg ≈#0F1418 | 500,68 | **1153,373,417,35** input, sans 14, bg surface | −33 tall, wrong element/family/bg |
| actions row | y 580, h 36 | 581,36 | **414,31** | −5 tall, y −166 |
| Pull / Commit / Push | 117 / 128 / 114 wide, gaps 22 / 30 | same | **≈50 / 71 / ≈52**, gap 6 | Commit −57 wide, x 1205 vs 1284 (−79) |
| Commit colours | bg `#EC4501` ≈ `--bd-brand-orange`; text `#F7C9B6` ≈ `--bd-text-on-brand` | same tokens | bg ok; text **`--bd-accent-fg`** oklch(0.96 .015 256) blue-white | wrong fg token |
| Pull/Push | transparent, 1px `border-dimmer` | same | **`--bd-bg-elevated`** fill, `border-default` | wrong bg/border tokens |
| section rule colour | ≈`#2E3034` = `--bd-border-dimmer` | same | `--bd-border-default` `#3A3E42` | +10 lum |
| column / textarea bg | `#0E1316` ≈ `--bd-bg-base` | base | base | ok |

Net: the app's git block is 250px tall where the mockup's is 469; every control is the app's generic 13/11px
"dense inspector" pattern, the mockup is a 14px-mono, 35px-row, full-width-control panel.

## Recommendations (all in `app/src/styles/global.css` unless noted; nothing was edited)

1. **Make the dev URL render the shell** (`app/src/App.tsx`, `ipc.ts`): guard `invoke` with
   `"__TAURI_INTERNALS__" in window` (or wrap the mount effect in try/catch) so the static shell renders
   without Tauri. Until then no screenshot gate can run against `:4174`.
2. **Column**: `.shell { grid-template-columns: 26fr 46fr 28fr }` → give the inspector the token width
   `minmax(var(--bd-size-shell-inspector), 29fr)` (360px min) or a fixed `460px`; `.inspector section { padding: 18px 24px 19px 24px; border-bottom-color: var(--bd-border-dimmer) }`.
3. **Git section** (scope to `.git`, replace the last block of the file):
   ```css
   .git h2 { font-size: 17px; line-height: 24px; margin-bottom: 10px; }
   .git .mono, .git .changes { font-size: 14px; line-height: 20px; }      /* .small currently forces 11px */
   .git .branch { height: 35px; margin-top: 10px; padding: 0 14px; display: flex; align-items: center; justify-content: space-between;
                  background: var(--bd-bg-surface); border: 1px solid var(--bd-border-dimmer); border-radius: var(--bd-radius-sm); }
   .git .status { margin-top: 14px; font-family: var(--bd-font-mono); gap: 10px; }
   .git .status .dot { width: 11px; height: 11px; animation: none; }
   .git .changes { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--bd-border-dimmer); }
   .git .changes li { display: grid; grid-template-columns: 34px 1fr; padding-bottom: 15px; }
   .git .commit { border-top: 1px solid var(--bd-border-dimmer); padding-top: 15px; }
   .git .commit label { font-size: 15px; line-height: 22px; color: var(--bd-text-secondary); }
   .git textarea { height: 68px; margin-top: 7px; padding: 12px 14px; font: 14px/20px var(--bd-font-mono); background: var(--bd-bg-subtle); border-color: var(--bd-border-dimmer); resize: none; }
   .git .actions { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 22px; margin-top: 13px; }
   .git .actions button { height: 36px; font-size: 15px; background: transparent; border-color: var(--bd-border-dimmer); }
   button.primary { color: var(--bd-text-on-brand); }   /* global: accent-fg is the *blue* accent's fg */
   ```
   `GitPanel.tsx` changes implied: render the branch as a `<select>`/button with a chevron (drop the inline
   `@ sha`), add the `Commit message` `<label>` + `<textarea>`, drop the `— {label}` suffix from the heading,
   keep the `busy` dot static (the mockup's warning dot does not pulse).
4. **Global token drift** worth fixing once: `--studio-border` → `--bd-border-dimmer` for rules (the app uses
   `border-default` everywhere; the mockup's rules are one step dimmer), and `button.primary` fg → `--bd-text-on-brand`.
5. Re-sync the vendored tokens (`design-system-sync`) — one token behind the authority.

## Method notes

- Mockup geometry from ImageMagick luminance scans (`convert … txt:-`), thresholds 22/35/120 to separate rules,
  control edges and glyph rows from the grain. Font sizes inferred from cap heights (12px cap → 17px Plex Sans)
  and mono advance (24 chars = 200px → 14px Plex Mono, 8.4px advance). IBM Plex Sans/Mono are installed locally,
  so the renders use the real faces.
- Both HTML files embed a `getBoundingClientRect` dump (`#metrics`) so the numbers above are reproducible with
  `google-chrome --headless=new --dump-dom`.
- `agent-browser` verified both pages visually; the mockup-match page reads as the mockup at a glance
  (`side-by-side-git.png`).
