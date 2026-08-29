# git-panel — translate result

Mockup r5-q3.png → `surfaces/git-panel.html` (loads `surfaces/tokens/design.css`, authority @ SHA in `surfaces/.source-sha`; zero hex/rgb, `[data-product="designer-studio"]`). Measurements in `translate/SPEC.md`; prompts, shots, diffs and per-round notes under `translate/`.

## Per-round scores (surface ↔ mockup)

| round | layoutScore | layoutScore, stage masked | top hotspot | action |
|---|---|---|---|---|
| r1 | 0.9797 | 0.9922 | 17,6 (fog image) / masked: 7,3 lum 0.113 (agent rows 13px low) | patch 6 row tops |
| r2 | 0.9799 | 0.9924 | Brief paragraph (mono in mockup vs sans) — text speckle | **stop** (Δ 0.0002 < 0.005) |

`pixelDiff` vs the PNG is ~0.098 and is not a gate number (generated text, grain, fog).

## Implementation gate (surface r2 ↔ http://127.0.0.1:4174, threshold 16)

**pixelDiff 0.1112 — FAIL (gate 0.01).** Caveat that matters: in a plain browser the Vite shell has no Tauri backend, so it renders *no solution, no projects, no agents, no run, and no Git section at all*. Most of that 11% is absent content. Re-run the gate inside the Tauri window (its Vite URL) with a solution open and `Marketing site` selected before treating the number as the app's drift.

Hotspot rects (logical px) from `translate/diff/git-panel-app/report.json`:

| cell | rect (x,y,w,h) | lumDiff | what it is |
|---|---|---|---|
| 10,17 | 400,680,40,40 | 0.314 | Re-render button: surface y 682–714, app toolbar sits at y 760–788 (pinned to column bottom) |
| 11,17 | 440,680,40,40 | 0.295 | same |
| 7,2 | 280,80,40,40 | 0.149 | Connect buttons (x 250–318, y 47–155): app has no agents mounted |
| 17,17 | 680,680,40,40 | 0.135 | Ask agent button row |
| 20,17 | 800,680,40,40 | 0.132 | Blind read |
| 14,17 | 560,680,40,40 | 0.132 | New variant |
| 13,17 | 520,680,40,40 | 0.120 | New variant |
| 7,19 | 280,760,40,40 | 0.114 | Send button: surface 261–319 × 737–767, app 269–323 × 761–791 |

## Where the app differs from the mockup, in pixels

Measured with a hairline probe on the app screenshot vs the mockup (both at 1280 logical). These hold regardless of the empty-shell caveat because they are chrome, not content.

| region | mockup / surface | app (`global.css`) | Δ |
|---|---|---|---|
| column dividers | x = 339 and 905 (339 / 565 / 374) | x = 333 and 922 (333 / 589 / 358) via `26fr 46fr 28fr` | left −6, centre +24, right −16 |
| Solution row height | 42 | 39 | −3 |
| left column text inset | 22 | 10 (`.block` padding 8px 10px) | −12 |
| right column text inset | 20 (x = 925) | 13 (x = 935; `.inspector section` padding 10px 12px + divider) | −7 |
| section heading size | 14px semibold | `h2` 13px | −1 |
| body text | 13px | `body` 14px | +1 |
| mono text | 13px | `.mono` 12px | −1 |
| Connect button | 68×26 | `button` 4px 10px + 14px/1.5 ≈ 61×31 | +5 tall |
| Git branch select | 330×26 at y 202–228 | not built as a control (plain `.row-line` text) | missing |
| Git changed-file rows | pitch 28, mono 13 | `.changes` gap 1px, `.small` 12px ≈ pitch 18 | −10 per row |
| Commit message field | 330×56 textarea, mono 14 | `<input>` ≈ 33 tall, sans | −23 tall |
| Pull / Commit / Push | 93 / 103 / 93 wide, 28 tall, spread across 330 | auto-width, ≈31 tall, 6px gap | not spread |
| stage | 513×432 at (368, 63), radius 6 | flex 1, margin 12 → 565 wide, no radius | +52 wide |
| thumbnails | 116×80, label below, selected = 1px accent outline | `.thumb img` 96×64 | −20 × −16 |
| toolbar buttons | 32 tall, widths 117/120/110/110, y 682–714 | ≈31 tall, auto width, pinned at y 760–788 | +78 down |
| Send button | 58×30 at y 737 | 54×30 at y 761 | +24 down |
| composer | 296×66 at y 658 | 254×80 at y 713 | +55 down, −42 wide |

## Recommended CSS changes (app/src/styles/global.css — not applied; app/ is read-only for this run)

```css
/* columns: match the mockup's hairlines at x=339 and x=905 */
.shell { grid-template-columns: 339px 1fr 375px; }

/* insets */
.block { padding: 10px 22px; }
.inspector section { padding: 12px 20px; }

/* type */
h2 { font-size: 14px; }
body { font-size: 13px; }
pre, code, .mono { font-size: 13px; }

/* controls */
button { padding: 3px 10px; line-height: 20px; }            /* → 28px tall, 32 with .toolbar button padding 5px */
.toolbar button { padding: 5px 16px; min-width: 110px; }
button.primary { color: var(--bd-accent-fg); }

/* git section (GitPanel.tsx) */
.git .changes { gap: 9px; }                                  /* 28px pitch */
.git .changes li { display: grid; grid-template-columns: 2ch 1fr; gap: 10px; }
.git input { min-height: 56px; font-family: var(--bd-font-mono); font-size: 14px; }   /* or render a <textarea rows=2> */
.git .actions { display: flex; justify-content: space-between; }
.git .actions button { flex: 0 0 93px; }
.git .actions button.primary { flex-basis: 103px; }
/* branch row → a select-styled control, 26px tall, mono, chevron right */
.git .row-line { height: 26px; padding: 0 10px; border: 1px solid var(--studio-border); border-radius: var(--studio-radius); background: var(--studio-elevated); }

/* canvas */
.stage { margin: 12px 28px 0; border-radius: var(--studio-radius); }
.thumb img { width: 116px; height: 80px; border-radius: var(--studio-radius); }
.thumb.active img { outline: 1px solid var(--studio-accent); }
```

Not recommended: changing the toolbar's bottom-pinned position or the stage's flex sizing to hit y=682 — that is a run-state layout (the mockup's stage was drawn 432px tall at an arbitrary aspect) rather than a rule. Everything else above is a rule the mockup fixes and the surface proves.

Token drift note: the app's vendored `app/.context/design-system/tokens/css/bytedesk.css` is one commit behind the authority (missing `--bd-product-agent-mail`); irrelevant to this screen, worth a `design-system-sync`.
