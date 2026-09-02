Tool: codex exec (codex-cli 0.152.0), text mode with `-i` image attachment — blind critic
Date: 2026-09-01
Requested by: Ryan Helms (via the rewrite's lead session)
Authority: ByteDeskAI/design-system @ f652565 — profiles/task-management/DESIGN.md, tokens/css/bytedesk.css
Profile: authority — /home/ryan/Documents/GitHub/ByteDeskAI/design-system/profiles/task-management/DESIGN.md
Status: review of the served application (http://127.0.0.1:49568, dist built from the working tree) — findings, not approval

# Review of the live app — reconciliation

## Where this sits in the run

The run folder already holds `review/` for the nine surface mockups. A stage overwrites only
its own subtree, so a second review would have destroyed the first; this one lives in
`review-app/` as its own stage entry in `state.json`. Same authority, same profile, same
critic prompt, different subject.

Independence: the 34 blind reads are independent. The reconciliation below was written in a
fork of the session that produced the app — read the quoted blind reads as the evidence and
the judgements as the half that carries bias.

Screenshots via Playwright CLI 1.58 headless (the agent-browser MCP entrypoint was
unavailable, `ENOENT …/dist/local/bdab`). 88 captured; 48 viewed and hashed into
`state.json.stages.review-app.viewed`; the contact sheet and findings use only those 48.

## Mechanical checks

| Check | Result |
|---|---|
| Colour literals in `dashboard/src` (excluding `styles/tokens.css`, `index.html` theme-color) | none |
| Hex values in the served CSS bundle not present in the vendored token file | none (55 unique, all token values) |
| Vendored `.context/design-system/tokens/css/bytedesk.css` vs authority HEAD | byte-identical, `.source-sha` f652565 |
| `[data-bd-product=task-management]` accent scope in the served CSS | present |
| `<html data-bd-product>` on the served page | `task-management` |
| Colour-only status anywhere in 48 views | none — every status is dot + word (blind reads list the dots *and* the words) |
| Artifacts promoted unviewed | none (findings, notes, contact sheet only) |

## Where the app diverges from the promoted surfaces, and whether it is better

| Surface | App | Better or worse |
|---|---|---|
| **board** — one `tm find` query bar with removable chips as the only filter | query bar in the command bar **plus** a row of six selects (epic/assignee/actor/priority/type/label) plus saved views | worse: two filter systems for one query language; the selects duplicate `field:value`. Keep the query bar + chips, fold the selects into a "filters" disclosure as the phone already does |
| board — cards clamp titles at one line | three-line clamp, priority as glyph + word | better (applies the surface review) |
| board — no empty-column placeholder | dashed "—" cell per empty column per lane | worse (note) |
| **task** — display-size title | inline-edit heading at body-plus size, Task/History tabs, why chain, history | better (applies the review); the focus ring on open is new (note) |
| task — Done / Park / Block with an inline reason field and the refusal quoted verbatim | same grammar (Start/Park…/Block… with inline reason) | parity |
| **sessions** — display headings, giant "WIP 2 / 3", tagline | base-size H1, WIP meter with `wipLimit`, harness + TTL facts | better; the disabled sweep button is worse (illegible) and the phone overflow is new |
| **health** — one screen: Doctor · Export · Notifications · Override tabs, per-finding Fix | split: /doctor (fix-all only), /reports (export), /settings (ntfy test, override) | different, defensible; per-finding Fix is lost (`/api/doctor` has no per-finding route — backend) |
| **settings** — 480 px centred canvas, left section nav, "Current claim" card | full-width 1100 px measure, no section nav, no claim card | canvas and claim card: better (applies the review); losing the section nav: worse |
| **backlog** — title column starved to 0 px (fixed in round 2) | title has a minimum width; ids Plex Mono, never wrap | better at 1440; the 390 stacking is worse than the mockup's compact rows |
| **graph / timeline** — display headings | base-size H1s | better; taglines remain |
| all surfaces — `data-bd-product` scope, tokens only | same, verified in the served bundle | parity |

Net: the app applied every should-fix from the surface review (display headings, taglines
on sessions/epic, 480 px settings canvas, claim card, coloured priority, wrapping ids,
one-line clamp) except the taglines on the ops screens, which it made universal instead.

## The ten changes that would raise design quality most

1. Fold the six filter selects on `/board` and `/backlog` into the `tm find` query bar: one filter language, chips for what is set, a "filters" disclosure for the pickers. The command bar already owns the query.
2. Fix light-theme chip surfaces (`blocked by the browser` renders dark navy in light) — audit every `Chip` tone against `--tm-status-*-bg` in both themes.
3. Replace the six-tile KPI grid on `/reports` with one measure strip in Plex Mono; the profile bans hero metric grids and the brief defines the product against the KPI template.
4. Cut the ops-screen taglines to one line or move them into the empty states that already carry the same sentence (graph, sessions, sprints repeat it twice).
5. Phone board: open on the first non-empty status, drop the "—" placeholders; phone backlog: compact task cards, not nine labelled rows per task.
6. Fix the `/sessions` overflow at 390 (selects wider than the viewport) and make disabled danger buttons legible (ghost + disabled ink).
7. Capability cards: sentence-case titles, full list measure, and the derived score in the inspector header (it shows "–" while the card shows 18/27).
8. Standup at ≥1200: use the canvas — finished/doing left, stuck/also-touched right — instead of a 640 px card and 700 px of nothing.
9. Settings: bring back the section list (anchors) in the free right column so Policy/Workflow/ntfy are one click away; keep the full-width measure.
10. Remove the dashed placeholder cells from empty board columns and the redundant "PROGRESS" eyebrow above every epic bar; the count and the number already say it.

## Not findings, but worth knowing

- `/board` has no `h1`; `tests/browser/routes.mjs` asserts one per route (W8's report).
- The command-bar sprint lozenge from the mockup (`SP-003 · 12/20 pts`) is absent only because no sprint exists in this store; verify it appears once one does.
- `/api/doctor` exposes no per-finding fix, so the mockup's per-row "Fix" cannot be built without a backend route.
- The blind read on `graph-1440-dark` classes the empty state as "a chart with no readable data"; it is copy, not a chart, but it is the only screen whose entire canvas is an empty state at 1440.
