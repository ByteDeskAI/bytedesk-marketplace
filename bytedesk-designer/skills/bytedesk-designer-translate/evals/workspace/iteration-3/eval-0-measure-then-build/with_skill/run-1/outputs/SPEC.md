# SPEC — Designer Studio workbench, state `render-failed` (r3-s5)

Mockup: ~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r3-s5.png (1586×992, scale 1.2391)
Logical size: 1280×800. All numbers below are logical px, measured on translate/grid-render-failed.png.
Layout is shared by every studio state; only the centre stage contents are state-specific.

## Frame
- Ground: --bd-bg-base. Three panels on it, each --bd-bg-subtle with 1px --bd-border-default, radius 6.
- Outer inset 12 all sides; gutter 10 between panels. Panels y 12..784 (h 772).
- LEFT  x 12..332  (w 320)   CENTRE x 342..954 (w 612)   RIGHT x 964..1268 (w 304)
- Fonts: sans = --bd-font-sans (chrome), mono = --bd-font-mono (ids, versions, logs, run names, timeline, tables, prose in inspector lists).
- Colours: primary text --bd-text-primary, secondary --bd-text-secondary, dot/word status --bd-success / --bd-danger. Orange (--bd-accent) ONLY on Re-render, Send, and the selected thumbnail outline.
- Every control: 1px --bd-border-default, radius 6, fill --bd-bg-surface, sans 13. Matte; no shadow, no gradient.

## LEFT column (inner padding 14 left/right)
- Agent rows: 4 rows, pitch 36, first row centre y 40 (block top pad 10). Columns: name sans 13 primary at x 27; dot 8px at x 117 (centre); word "ok" sans 13 at x 128; version mono 12 at x 186; Connect button 70×28 right-aligned to x 321.
- Hairline divider (border-default) at y 165, full inner width.
- "Runs" heading sans 13 primary, centre y 187.
- Run rows: mono 12, pitch 23.5, centres y 215/239/262/285/308; name at x 27 (secondary text ~ primary at 85%); status word right-aligned at x 320, --bd-danger for failed, --bd-success for ok. Selected row (first) gets --bd-bg-surface fill + 1px border, radius 4, spanning x 17..327, h 22.
- "View all…" sans 13 secondary, centre y 332. Divider at y 345.
- Timeline: starts y 355 (first header centre y 364). Mono 10.5, line pitch 18. Each message: header line (sender mono 10.5 semibold primary, timestamp mono 10.5 secondary 12px to its right) then body lines (mono 10.5 primary). Gap between messages 10 (header-to-header of a 2-line message = 64).
  Wrap check: "Starting render r1-a with prompt and context." = 45 chars × 0.6 × 10.5 = 283 ≤ 292 inner width ✓ (at 11px it is 297 and wraps — do not use 11).
- Divider at y 646. Composer box x 20..323, y 657..771 (303×114): --bd-bg-surface, border, radius 6, placeholder "Message codex…" mono 12 secondary at padding 12/10. Send button 82×30 at box inner bottom-right (3px inset): --bd-accent fill, sans 13 primary text, no border.

## CENTRE column (inner padding 16 left/right)
- Stage: y 12..574, empty --bd-bg-subtle (same as panel). Contents centred on x 648:
  - Status: 10px --bd-danger dot centre (606,179); word "exhausted" sans 15 --bd-danger at x 621, same baseline.
  - Attempts panel: x 458..841 (383×87), y 208..295, fill --bd-bg-subtle, 1px border, radius 6. Three mono-12 rows, centres y 228/250/272 (pitch 22, top pad 9). Column x: ▸ glyph (secondary, 8px) at 474 only on row 1; name at 491; "exit N" at 601; time at 684; "produced no" at 737. Text primary.
  - Sentence "Codex produced nothing. Nothing was written." mono 12 primary, centred, centre y 338.
  - Retry button 77×29, x 611..688, y 367..396, standard control.
- Hairline at y 574 spanning inner width. Thumbnail strip y 574..696: one card x 353..449, y 583..685 (96×102), 1px --bd-accent border (selected), radius 6, empty --bd-bg-subtle interior, hairline at card y 659 then label "r1-a" mono 11 secondary centred in the 26px band beneath.
- Hairline at y 696. Toolbar: four buttons 132×40, y 711..751, x 358/504/650/796 (gap 14), sans 14 labels. Re-render = --bd-accent fill, primary text, no border; others standard controls.

## RIGHT column (inner padding 12)
- Three stacked sections, hairline dividers at y 212 and y 420, spanning inner width.
- Brief: heading "Brief" sans 16 primary centre y 36; prose sans 12 primary, line pitch 22, first line centre y 65. Wrap check: 45 chars × 0.5 × 12 = 270 ≤ 280 ✓ (13px = 292 wraps).
- Art direction: heading centre y 240; five bullet rows mono 11 primary, pitch 25, first centre y 271; "•" at x 981, text at x 989.
- Critique: heading centre y 448; six lines mono 11 primary, pitch 23.4, first centre y 479, x 976.

## Invented by the mockup — do not build
- Underlines on "direct" and "300s" in the attempts table (link styling artefact).
- The brief prompt's "small Connect button" is real (Agents contract), keep. No title bar in this render — none to drop.
- No hollow thumbnail slots beyond r1-a (only one thumbnail exists in this state).
- Runs list: the brief's Brief-tab runs list is elsewhere; the five rows here are kept as copy since the state shows them.
