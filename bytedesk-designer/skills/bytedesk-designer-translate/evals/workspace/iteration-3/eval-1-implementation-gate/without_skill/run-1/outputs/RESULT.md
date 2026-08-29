# Git panel vs mockup r5-q3 — result

Mockup: `~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r5-q3.png` (1586×992).
Authority: `~/Documents/GitHub/ByteDeskAI/design-system` (tokens `tokens/css/bytedesk.css`).
App stylesheet: `app/src/styles/global.css` (read-only; nothing under `app/` or the authority was modified).
Component: `app/src/panes/GitPanel.tsx`, mounted in `app/src/panes/Inspector.tsx` right column.

## What the URL could reach (honest state)

`http://127.0.0.1:4174` is the Vite dev build with no Tauri backend. It renders the shell only:
no solution, no project, so `GitPanel` never mounts (`s.solution` is null; `.git` section absent —
see `app-computed.json`, `"git": false`). The right column shows "Design authority / Brief / Art
direction / Critique" instead. So the git panel could NOT be measured live from the URL.

What I did instead:
1. Screenshotted the shell at the mockup's viewport (`app-shell-1586x992.png`) and dumped the
   computed styles the git panel inherits (`.inspector section`, `h2`, `.mono`, `button`, `.dot`, tokens).
2. Rebuilt the git panel DOM exactly as `GitPanel.tsx` emits it, styled with a verbatim copy of
   `global.css` + the authority tokens → `surface-as-is.png` (what the app would show with the
   mockup's data). That is the honest "current app" rendering of this panel.
3. Applied a recommended override stylesheet → `surface-patched.png` (the surface that matches).

Tooling note: agent-browser navigated to the URL but its screenshot came back undecodable, so
screenshots were captured with Playwright (local chromium) as the fallback.

## Scores

Geometry score = fraction of the 12 measured metrics below within 4px / 1px font of the mockup.

| Rendering | Geometry within tolerance | Mean abs pixel diff vs mockup crop (x 1122–1586) |
|---|---|---|
| App shell (URL, git panel unreachable) | n/a | 13.2/255 (8.1% px >40) |
| Surface as-is (app CSS, GitPanel DOM) | 0 / 12 | 14.0/255 (8.7%) |
| Surface patched (recommended CSS) | 9 / 12 | 13.5/255 (8.8%) |

Pixel diff is dominated by the mockup's longer Brief body text and the mockup's off-token colours
(see "Authority wins"), so it barely moves; the geometry table is the meaningful score.

## Differences in pixels (mockup → app as-is → patched), right column origin x=1122

| Element | Mockup | App as-is | Δ as-is | Patched | Δ patched |
|---|---|---|---|---|---|
| Right column width | 460px (29.0%) | 444px (28fr) | −16px | 464 (fixed for render) | +4 |
| Section padding-left (text start) | 24px | 12px | −12px | 24px | 0 |
| "Git" heading font (cap height 13px ⇒ ~18px semibold) | 18px | 13px | −5px | 18px | 0 |
| Heading y (top of glyphs) | 190 | 130 | −60 | 188 | −2 |
| Mono text size (pitch 8.74px ⇒ 14.5px Plex Mono) | 14.5px | 12px | −2.5px | 14.5px | 0 |
| Remote line y | 223 | 155 | −68 | 221 | −2 |
| Branch control (select box) | 1146–1555 × 248–282, 410×35, 1px `#272B2D`, fill `#1A2022` | plain text row 18px tall, no box | −17px height, no border | 415×35 box | +5w |
| Status dot | 11px, amber, at x1147 | 7px | −4px | 11px | 0 |
| Status line y | 302 | 203 | −99 | 300 | −2 |
| Changed-file row pitch | 35px, marker col 28px | 19px, marker inline | −16px | 35px | 0 |
| Files list top y | 354 | 230 | −124 | 353 | −1 |
| Sub-dividers inside Git (y=333, 454, 636) | 3 hairlines | none (single section) | missing | present | +1..+24 |
| Commit label | 14.5px muted, y 475 | placeholder inside input | n/a | label, y 481 | +6 |
| Commit field | textarea 410×69, y 499–567, fill `#191E21` | input 1-line ~31px | −38px | 415×69 | +24 y |
| Pull / Commit / Push | 117 / 128 / 115 × 37, gaps 22 / 29, y 579–615 | 46 / 71 / 53 × 31, gap 6, wrapped left | −71/−57/−62 w, −6 h | 117/128/115 × 37 | +23 y |
| Button label size | ~15px | 14px | −1 | 15px | 0 |

Residuals after patch (3/12 outside tolerance): commit label / textarea / buttons sit ~23px lower
than the mockup because the mockup's file-list sub-section is 120px tall (3×35 + 15) while the patch
uses 3×35 + 20px sub-padding. Set `.git .sub { padding-top: 12px }` to land within 4px.

## Authority wins (mockup deviates from tokens — do NOT copy these from the PNG)

- Mockup Commit fill `#E21E00`; token `--bd-accent` = `--bd-brand-orange` oklch(0.6375 0.205 38.67) (#EC4E02). Keep token.
- Mockup text is pure `#FFFFFF`; token `--bd-text-primary` `#E6E8EB`. Keep token.
- Mockup control border `#272B2D` ≈ `--bd-border-dimmest` (#272A2C); section dividers `#353A3A` ≈ `--bd-border-dimmer/default`. Use tokens.
- Mockup control heights 35/37px sit between `--bd-size-control-default` 32px and touch 44px; recommend 32px (`--bd-size-control-default`) if the team prefers token-exact over mockup-exact — the patch uses the mockup values.
- Vendored tokens `app/.context/design-system/tokens/css/bytedesk.css` (.source-sha de48261) lag the authority by one entry (`--bd-product-agent-mail`); harmless for this panel, but `design-system-sync` is due.

## Recommendations (edits for `app/src/styles/global.css`, not applied)

See `surface/git-panel.patch.css` — 15 rules, all token-referenced. Summary:
1. `.inspector section { padding: 20px 24px; gap: 12px }`
2. `.inspector h2 { font-size: 18px }`; `.inspector .mono { font-size: 14.5px }`; `.dot { 11px }`
3. Render branch as a boxed select-style control (35px, `--bd-border-dimmest`, `--studio-surface`).
4. Change list: `grid 28px 1fr`, 35px rows, marker in `--studio-text`.
5. Commit: visible "Commit message" label + 69px textarea; buttons 37px tall in a 3-column grid
   with space-between (117/128/115).
6. Split the Git section into three hairline-separated sub-blocks (status / files / commit).

`GitPanel.tsx` changes implied (markup only): wrap files and commit blocks in `.sub`, swap
`<input>` for `<textarea>`, add the label, render branch in a `.branch` box, drop the inline
"— label" and `@ sha` from the heading line (mockup shows neither).

## Files
- `app-shell-1586x992.png`, `app-computed.json` — live URL capture + computed styles
- `mockup-right-column-crop.png` — reference crop
- `surface/git-panel.html`, `surface/git-panel.patch.css`, `surface/app-global.copy.css`, `surface/bytedesk.tokens.css`
- `surface-as-is.png`, `surface-patched.png`, `side-by-side_mockup_asis_patched.png`, `diff-*.png`
