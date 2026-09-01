# Grading round 3 (final) — verdict: **PASS** (all criteria ≥ 4, zero P0)

Board: http://127.0.0.1:49568 (rebuilt after the round-2 fixes). Evidence: `grading/shots3/` (44 screenshots: 22 routes × 1440/390 dark, 12 viewed), `probe4.mjs` (overflow scan, 17 routes at 390 + inspector control sizes), `probe5.mjs` (settings sections, unlabelled controls, command-bar geometry), `probe6.mjs` (small inputs, avatar/live/bell/search at 390, sessions selects, help wrapping, settings clipping, epic eyebrow, `?`/Escape/`c`/Escape), `probe7.mjs` (AC label heights, settings identity overflow, help About grid), `probe8.mjs` (inspector horizontal overflow at 1440), `suite-2.log`, `browser-tests-7.log`. No store writes this round; TM-057 untouched.

## Scores

| # | Criterion | R2 → R3 | Why |
|---|---|---|---|
| 1 | Functional coverage | 5 → **5** | Unchanged: every inventory row has a UI location (goal import, templates, ntfy per-kind, touches, History tabs all present — probe5/probe6). |
| 2 | Design-system | 4 → **4** | `design-system-check` healthy (f652565), `design:check` 0, status dot + word everywhere, epic "progress" eyebrow gone (probe6: no `progress` heading in the inspector), reports = one mono measure strip, standup fills the canvas. Residual: `/help` skill commands are now clipped mid-token by the `invokable` chip instead of wrapping (help-1440-dark.png: `/task-management:boar`, `…:enha`); the theme toggle still renders on phone (`className` is not forwarded by `Button`, so `.tm-commandbar__theme{display:none}` never matches — board-390-dark.png shows the sun icon); epic inspector head row overflows (see P1-1). |
| 3 | Accessibility | 4 → **4** | 0 unlabelled buttons/inputs (probe5), 42/42 columns named, `h1` on every route, `:focus-visible` on cards, `?` sheet and create modal both close on Escape (probe6), avatar/menu on-screen at 390 (right=382), AC rows are 44/54 px labels wrapping 24 px checkboxes (probe7 — the label is the target). Residual: the epic inspector's close ✕ is off-panel at 390 (Escape and the rail still work) — P1-1. |
| 4 | Responsiveness | 3 → **4** | **Regression fixed**: `scrollWidth === 390` on all 17 routes (probe4), command bar 366/390 (chip 62 + search 113 + end 191; live is a 7 px dot with `aria-label`), sessions selects 144–318 / 185–382, phone board opens on `todo`, compact phone backlog, inspector full-screen. Not 5: the epic inspector content is wider than its panel at both 1440 (drawer w=360, sw=405, 55 elements past the edge — probe8) and 390 (epics_EP-006-390-dark.png: ✕ and children status chips clipped), and two long mono values are clipped at 390 (settings identity path w=638; help About dl w=638 — probe7). |
| 5 | Keyboard + palette | 5 → **5** | `browser-tests-7.log` keyboard 19/19 on this build; probe6: `?` → sheet, Escape closes, `c` → modal, Escape closes. |
| 6 | Performance | 5 → **5** | app 18.1 kB gz / vendor 50.5 kB gz (hash unchanged), css 9.6 kB gz; SSE per-entity path unchanged. |
| 7 | Tests | 3 → **5** | `suite-2.log`: unit 1012/1012 + 11 contract suites green. `browser-tests-7.log` (this build, port-randomised scripts): keyboard 19/19, drawer 6/6, routes 160/160 (`/sprints/:id` skipped — no sprint in the store). |

## Disposition of round-2 items

| Item | Status | Evidence |
|---|---|---|
| P1-1 command bar overflows at 390 on every route | **FIXED** | probe4: sw=390 on all 17 routes; probe5: bar 390, kids 62+113+191; probe6: avatar right=382, bell h=44, search w=113 h=44, live dot 7×7 with aria-label |
| P2-2 two 24 px inspector inputs | **FIXED** (by target) | probe6/7: the two are AC checkboxes inside `label.tm-check`; labels are 54 px and 44 px (`min-height: 44px`) |
| P2-3 `/help` command wraps mid-token | **PARTIAL** | probe6: `white-space: nowrap`, 1 line — but the card row clips the command under the chip (help-1440-dark.png). Fix: put the chip on its own line or `flex-wrap` the card head so the command keeps its full measure |
| P2-4 epic inspector "PROGRESS" eyebrow | **FIXED** | probe6 headings: title, why this epic, plan, children · 9, decisions · 0; epics_EP-006-1440-dark.png bottom shows `8/9` + bars with no eyebrow |
| P2-5 fresh browser run | **FIXED** | browser-tests-7.log all green |
| P2-6 two search fields on /board | note only, unchanged |

## New findings

### P1
1. **Epic inspector head row overflows the panel at every width.** `EpicInspector.tsx` head = chips (id, open, active) + "Import goals…" + "Close epic" + ✕ in one non-wrapping `.tm-row`; at 1440 the drawer is 360 px with `scrollWidth` 405 (probe8: `header.tm-inspector__head right=1486`), at 390 the ✕ is off-panel and every children row's status chip is clipped (epics_EP-006-390-dark.png, epics_EP-006-1440-dark.png "Close epi", "on the"). Introduced by the round-1 "Import goals…" action. Fix (one rule): `.tm-inspector__head .tm-row { flex-wrap: wrap; min-width: 0 }` in `styles/ui.css` (or move the two actions into the existing `…` actions menu the task inspector uses). Task, decision and capability inspectors do not overflow (probe8: sw = w).

### P2
2. Theme toggle still shows on phone: `Button` does not forward `className`, so `tm-commandbar__theme` never lands in the DOM (board-390-dark.png). Fix: spread `className` in `components/ui/Button.tsx`, or hide via `.tm-commandbar__end .tm-btn[aria-label^="theme"]`.
3. `/help` skill card head clips the command under the chip (P2-3 partial, above).
4. Long mono values clip at 390: `/settings` identity store path (`white-space: nowrap`, w=638) and `/help` About `dl` (dt/dd w=638). Fix: `overflow-wrap: anywhere` on `.tm-id` values in those two grids, or `grid-template-columns: minmax(0,1fr)`.
5. Board columns beside the wide task inspector at 1440 are ~100 px and break titles mid-word (tasks_TM-052-1440-dark.png "Integration, dist rebuild,…"). Cosmetic; a `min-width` per column with horizontal scroll-snap (the 720–1199 rule) would read better than six squeezed columns.

## Verdict
**PASS** — all seven criteria ≥ 4, zero P0. Recommended before shipping: P1-1 (one CSS rule) and P2-2 (one prop spread).
