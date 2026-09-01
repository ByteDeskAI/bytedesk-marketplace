Tool: codex exec (codex-cli 0.152.0), text mode — one invocation per surface; Claude rendered, viewed, re-briefed
Date: 2026-09-01
Requested by: Ryan Helms (marketplace dashboard rewrite)
Authority: ByteDeskAI/design-system @ f652565 — tokens/css/bytedesk.css vendored at surfaces/tokens (.source-sha), profiles/task-management/DESIGN.md
Profile: authority — /home/ryan/Documents/GitHub/ByteDeskAI/design-system/profiles/task-management/DESIGN.md
Status: exploration — not approved, not production source
Rendering: Playwright CLI 1.58 headless screenshots (agent-browser MCP unavailable this session: ENOENT dist/local/bdab). Every promoted surface was screenshotted at 1440/1024/390 in dark and light and the 1440-dark, 1440-light and 390-dark renders were opened in context before promotion.

Mechanical checks per surface (all promoted files): no hex/rgb/hsl literal; every var(--bd-…) resolves in the vendored stylesheet; data-bd-product="task-management" on <html>; the illustrative marker is in the page; no external resource; no script. Accent: the profile says inherits (gateway blue) and the scope exists in tokens/css — the family accent is the intended result.

## board — round 1, promoted
Renders. Six columns, digits in the headings, the claimed card TM-052 is the only lit card (accent edge + glow), status chips are dot + word, priority is glyph + word, queued/refused/blocked/parked states present, light parity holds, phone shows one column with a segmented control and a bottom tab bar. Squint: the lit card wins.
Should-fix for the implementation: card titles are clamped to one line with an ellipsis except the wrapped one — a board card should show 2–3 lines before clamping (the spec asked for the long title to wrap; the others were truncated). The accent-filled "live" chip in the command bar competes with the claimed card; render it as an outlined chip.

## task — round 1, promoted
Renders. Sticky identity header (id · status · holder · epic · title), Done with the CLI refusal verbatim beneath it, Park with an inline reason field (no prompt), sections separated by hairlines, why-chain, evidence, worktree, append-only comments, history, live work stream. Phone: inspector is the whole screen with a back button and Details · Why · Evidence · Stream tabs. Squint: the refusal and the title lead, as intended.
Should-fix: the inspector title is set at display size and wraps to two lines at 360px; use --bd-text-h2. Column headings on the board behind lost their <kbd> digits.

## sessions — round 1, promoted with findings
Renders. Claims table with harness/actor/task/worktree/branch/age/expiry/state, expired row with Sweep, worktrees with force checkbox, subagents with clamped "said", parallel batches with the exact `tm worktree new` command in mono, and the Sweep confirmation dialog open with a consequence sentence.
Named reflexes hit: an ornamental tagline under the H1 ("Resume from claim, blocker, then proof.") and a display-size "WIP 2 / 3" that reads as a hero metric. Both are banned by the surface rules — the implementation uses a compact meter row and no tagline.
Phone (390): the open <dialog> collapses — the status chip becomes a giant pill and the buttons stretch into tall columns (flex children given height). A mockup-only layout bug; the implementation's Modal primitive must be tested at 390.

## graph — round 1, promoted
Renders. Layered SVG DAG with status dot + word inside each node, the claimed node TM-052 outlined in the accent, danger edges along the blocked chain, a dashed subtask edge, the TM-060 ↔ TM-061 cycle labelled, a dashed "TM-404 (missing)" node; the docked Why panel shows startable: no, the chain with the reason at each hop, "Start here: TM-050" and roots in mono. Phone: an edge-list table that stacks. Squint: the accent-outlined node and the red chain lead.
Should-fix: the "Resume from record" heading is invented voice (the spec asked for the why chain only) and its command is wrong — `tm show TM-050`, not `tm task show`. Node titles truncate at one line; fine for a graph.

## epic — round 1, promoted
Renders. Epics list with progress bars and `done/total` in mono, EP-006 active + plan chips, EP-007 with a decision-map chip, fog count and the empty-children line quoting the exact command; inspector with body, plan chip and a mono preview, children, decisions. Light parity holds.
Named reflexes hit: a tagline under the H1 ("Open an epic. Resume from its record.") and display-size titles in both the canvas and the inspector — the implementation uses --bd-text-h2 for page titles and --bd-text-h3 for the inspector title, no tagline.

## health — round 1 rejected, round 2 requested (one axis: canvas width)
Round 1 renders the right content: summary line, Fix-all with an inline consequence panel gated by "I understand", errors/warnings with level chips (dot + word), codes in mono, verbatim messages, `fixable` vs "not auto-fixable — a judgement", Export panel with a mono preview, and a good phone layout. Defect at 1440: the canvas is squeezed into a ~480px centred column and the Export grid overflows the viewport, forcing a horizontal body scroll — a hard rule of the spec. Re-briefed with the screenshot attached: widen the canvas, wrap the Export grid, no horizontal scroll.

## backlog — round 1 rejected, round 2 promoted (one axis: Title column width)
Round 1: `table-layout: fixed` with widths on every column but Title starved it to zero, so titles wrapped one character per line and the page ran to 12,379px at 1440. Re-briefed with the viewport screenshot attached; round 2 changed only the `<col>` widths and a `min-width` on the title cell (diff verified: nothing else moved). Round 2 renders: ranked rows with sparse ranks in mono, selected row, bulk bar for 3 checked rows, sprint sub-header with `12/20 pts committed · 2 unsized`, blockers list, the "Unranked" empty state quoting the exact command; light parity holds; phone stacks each row into label/value pairs.
Should-fix: the Id column is too narrow and wraps `TM-` / `049` onto two lines; priority is coloured (danger red on "high") where the profile says word + glyph only.

## timeline — round 1, promoted
Renders. Filter row (kind/actor/session/collapse-noise/date), day headings, rows with mono time and id, event sentences in the catalog's own wording, status chips inline, mono actor·session at the right, the collapsed-noise line with a Show control, the foreign-entity row dimmed with a `foreign` chip, "Sat 30 Aug — nothing moved" with a one-line next action. Light parity holds; phone stacks time/id above the sentence.
Named reflex hit: display-size "Timeline" H1. Mockup bug: the command-bar search shows a ghost "Search" label overlapping the placeholder.

## settings — round 1, promoted with findings
Renders. Sub-navigation, read-only Identity with lock glyphs, Policy form with a `changed` chip on wipLimit, inline validation on claimTtlMinutes with the refusal in CLI wording, sticky "1 unsaved change · Save · Reset", Notifications with Send test + result line in mono, browser permission + categories, Keyboard sheet grouped, Skills catalog with copyable `/task-management:*` commands. Phone: the sub-navigation becomes a tab strip.
Findings: the canvas is a ~480px centred column at 1440 (cramped, no overflow — not re-rolled; the implementation fills the canvas up to ~1100px); a "Current claim" card was added to the sub-navigation that the spec never asked for (the right-rail reflex, on the left); the settings H1 is display-size.

## health — round 2 promoted
Round 2 changed only the canvas width rules (9 differing lines): content now fills the canvas to ~1100px, the Export grid wraps, no horizontal scroll at 1440/1024/390 (verified: PNG widths equal the viewports). Remaining note: the finding message column wraps narrowly beside the actions; the implementation lets the message take the remaining width.
