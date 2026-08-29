# Git panel (r5-q3) — surface, measurements, and app drift

Mockup: `~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r5-q3.png` (1586x992, a 1280x800 frame
rendered at 1.239x; all mockup numbers below are scaled to the 1280x800 app frame, factor 0.807).
Authority: `~/Documents/GitHub/ByteDeskAI/design-system` — tokens `tokens/css/bytedesk.css`; the app vendors them at
`app/.context/design-system` (`.source-sha` de48261). There is no `profiles/designer-studio` yet (the mockup run notes say so);
the mockup was briefed straight from the family tokens, so the token file is the only authority layer applied here.

## Files

| File | What |
|---|---|
| `git-panel.html` + `tokens.css` | The surface: 1280x800 three-column workbench in the r5-q3 state, built only on `--bd-*` tokens (tokens.css is a verbatim copy of the vendored authority file). |
| `surface-1280x800.png` | Headless render of the surface. |
| `mockup-r5-q3-1280x800.png` | The mockup resampled to the app frame, for overlay. |
| `app-git-panel.html` + `app-global.css` | The exact DOM `Inspector.tsx`/`GitPanel.tsx`/`ProjectsBlock.tsx` produce in this state, with the mockup's data substituted for IPC results, styled by the unmodified `app/src/styles/global.css` (import re-pointed only). This is the closest honest stand-in for "the app in this state" (see reachability below). |
| `app-replica-1280x800.png` | Render of that replica. |
| `app-shell-1280x800.png` | What the URL actually reaches (built from the current sources, opened without a Tauri backend). |
| `overlay-surface-on-mockup.png`, `diff-surface-vs-mockup.png`, `side-by-side-mockup-surface-app.png` | Visual comparisons (mockup / surface / app replica). |
| `measurements-*.json` | Bounding boxes from the renders, keyed by `data-m`. |

## What the URL could reach

`http://127.0.0.1:4174` serves the Vite dev build. Headless Chromium in this sandbox has no route to localhost (a python
`http.server` on 127.0.0.1 fails the same way; `file://` works), so the app was built with `vite build` into scratch
and opened from `file://`. It renders the shell only: `Solution none`, `git not installed`, `Projects: Open a solution…`,
inspector `Design authority / Brief / Art direction / Critique`. **The git panel is unreachable from the URL**:
`Inspector.tsx:77` mounts `GitPanel` only when `s.solution` is set, and a solution only arrives through Tauri IPC.
The agent-browser MCP session navigated but returned an empty snapshot and an unreadable screenshot. Every "app" number
below therefore comes from the replica (app markup + app stylesheet), not from a live Tauri window.

## Scores

| Axis | Surface vs mockup | App (replica) vs mockup |
|---|---|---|
| Structure (sections, order, controls present) | 10/10 | 6/10 — no branch select, no hairlines between git groups, no "Commit message" label, ghost buttons (`resolve`, `choose…`, `+ project`, `Save`) and `doctor output`/`root` rows the mockup does not have |
| Geometry (positions within ±10 px) | 9/10 — 31 of 36 measured boxes within 10 px; worst: Conversation heading +36 px, active project box +15 px tall | 3/10 — git section starts 69 px low and is 128 px too short; commit field 22 px short; buttons 46–54 px narrow |
| Type | 9/10 — Plex Sans 14 / Plex Mono 12 match the mockup's optical size | 5/10 — five sizes in one panel (11/12/13/14 px); headings 13 px vs mockup 14; file list at 11 px mono |
| Colour and material | 10/10 — ground/surface/elevated/border/accent are the token values the mockup was briefed from | 8/10 — same tokens; but the git status dot is amber whenever `ahead>0` even with no changes, and the changed-files status letter is muted rather than primary |
| Register (one lit element, matte chrome, dot + word status) | 10/10 | 7/10 — extra accent-coloured `Save` button in Brief adds a second lit control in the inspector |
| RMSE, surface vs resampled mockup | 0.138 (dominated by the generated fog image and text antialiasing; layout lines coincide in the overlay) | — |

## Where the app differs from the mockup, in pixels (1280x800 frame)

Columns: mockup dividers at x=339 and x=906 → 339 / 567 / 374. App grid `26fr 46fr 28fr` → 333 / 589 / 358.
**Left −6, centre +22, right −16.** Inspector content left edge: mockup x=926; app x=935 (**+9**, section padding 12 vs 19).

Right column, top edge of each element (y) and size:

| Element | Mockup | App replica | Delta | Surface |
|---|---|---|---|---|
| Solution section | 0–134 | 0–203 | **+69 tall** (doctor row, `@ sha` row, root row, ghost buttons) | 0–129 |
| Git heading | y 158 | y 213 | **+55** | y 145 |
| Remote line | y 184, 12 px mono | y 239, 11 px | +55, −1 px type | y 172 |
| Branch row | select box 200–228, h 28, full width | plain text row, h 18, no control | **missing control, −10 h** | 200–228 |
| Status row | y 247 | y 285 | +38 | y 230 |
| Changed files | rows at y 291/319/347, pitch 28, 12 px mono | rows at 312/329/346, pitch 17, 11 px | **pitch −11, type −1** | pitch 25 |
| Hairlines above/below file list | y 269 and y 366 | none | **missing** | y 265, y 357 |
| "Commit message" label | y 387 | none (placeholder inside input) | **missing** | y 364 |
| Commit field | 402–459, h 57, multi-line | 370–405, h 35, single-line input | **−22 h** | 391–448 |
| Pull / Commit / Push | y 468–497, h 29; w 94 / 102 / 93, gaps 18 / 23 | y 411–442, h 31; w 46 / 71 / 53, gaps 6 / 6 | **−48 / −31 / −40 wide; y −57** | h 30, w 100 each |
| Git section total | 134–512 (378) | 203–453 (250) | **−128** | 129–505 |
| Project section | 512–587, one mono line | 453–545, name at 15 px + mono line | +17 tall | 505–583 |
| Brief heading | y 597 | y 560 | −37; app adds an accent `Save` | y 599 |

Left column:

| Element | Mockup | App replica | Delta | Surface |
|---|---|---|---|---|
| Solution row height | 42 | 40 | −2 | 42 |
| Agent row pitch | 27 | 37 | **+10** (button 31 px tall inside a 3 px-padded row) | 27 |
| Agents block | 42–161 | 40–205 | **+44 tall** | 42–163 |
| Projects heading | y 233 | y 290 | +57 | y 234 |
| Active project box | x 18–323, y 260–376 (h 116) | x 10–323, y 319–467 (h 148) | **+32 tall**; app adds a type word and a dot+word status the mockup lacks | 261–391 (h 130) |
| Runs list | inset box x 39–313, hairline, surface fill | no box, x 11 | **box missing, −28 x** | 54–306 |
| Conversation | heading + timestamped mono turns | `pane-head` bar + bubble cards | different genre | matches |
| Composer / Send | 659–726; Send 261–319 x 737–767 | 715–792; Send 269–323 x 761–792 | +56 / +24 | 694–762; Send 253–319 |

Centre column:

| Element | Mockup | App replica | Delta | Surface |
|---|---|---|---|---|
| Stage | x 366–882, y 63–494 | x 346–910, y 12–625 | fills the column; mockup inset 27 px / top 63 | 364–882, 63–494 |
| Thumbnails | 115x79, labels below, y 519 | 96x64 inside a 102x90 button, y 648 | −19x−15, +129 y | 115x79, y 518 |
| Toolbar | hairline y 644, buttons y 683–713 spread full width, w ≈115 | hairline 748, buttons 759–790, hugging text | +104 y; widths −29..−31 | 643 / 682 |

## Recommendations for `app/src/styles/global.css` (not applied — app is read-only here)

1. **Columns**: `.shell { grid-template-columns: 339fr 567fr 374fr; }` (mockup 26.5 / 44.3 / 29.2 %).
2. **Inspector rhythm**: `.inspector section { padding: var(--bd-space-6) var(--bd-space-7); gap: var(--bd-space-3); }`
   and `h2 { font-size: 14px; }`. Drop the `resolve` / `choose…` ghost buttons and the `doctor output` / `root` rows from
   the Solution section when a solution is open (they belong to the no-solution state); that alone recovers 69 px.
3. **Git panel** (`GitPanel.tsx` + css): render the branch as a 28 px select (`--bd-bg-elevated`, hairline border, radius
   `--bd-radius-md`); hairlines above and below `.git .changes`; `.git .changes { gap: var(--bd-space-3); font-size: 12px; }`
   with the M/A letter in a 24 px column at primary colour; a visible "Commit message" label; a 57 px `textarea` instead of
   the input; `.git .actions { gap: var(--bd-space-6); } .git .actions button { flex: 1; height: 30px; }`.
   Status dot: amber only when `changes.length > 0`, green when clean-and-ahead.
4. **Type**: one sans size (14) and one mono size (12) in the inspector; retire `.small` inside `.git` and `.project-section`.
5. **Agents**: `.agents .agent-row { height: 27px; padding: 0; }` and a 24 px `Connect` button; providers show `ryanhelms`
   in the version column, not a value in every row.
6. **Projects**: active box `padding: 4px 12px`; runs as an inset box `margin-left: 21px; border: 1px solid
   var(--bd-border-default); background: var(--bd-bg-surface); border-radius: var(--bd-radius-sm)`; row height 19 px; drop the
   type word and the trailing dot+word from the project row (the mono git line already carries the state).
7. **Canvas**: stage inset `margin: 63px 24px 0` with a fixed 431 px height at 800 tall (or `aspect-ratio: 516/431`),
   thumbs 115x79 with the label outside the frame, toolbar buttons `flex: 1` with `gap: var(--bd-space-7)`.
8. **Register**: keep Commit / Re-render / Send as the only accent fills; make Brief `Save` a plain button.

## Method notes

- Mockup geometry was read from luminance profiles (column/row means) and 25 px-gridded crops at 2x; positions are ±2 px in
  mockup space (±1.6 px at 1280).
- Both HTML files carry `data-m` attributes on comparable elements; `measurements-surface.json` and
  `measurements-app.json` are the `getBoundingClientRect` dumps used for the tables.
- IBM Plex Sans / Mono were confirmed loaded (`document.fonts.check`) in both renders, so type metrics are real.
