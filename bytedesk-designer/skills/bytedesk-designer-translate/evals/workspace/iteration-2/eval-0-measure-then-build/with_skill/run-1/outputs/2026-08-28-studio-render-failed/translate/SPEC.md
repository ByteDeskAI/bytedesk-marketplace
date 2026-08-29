# SPEC — Designer Studio workbench, state: render failed / attempts exhausted (r3-s5)

Mockup: ~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r3-s5.png (1586×992, scale 1.2391)
Logical size: 1280×800. All numbers below are logical px read off translate/grid-render-failed.png.

## Frame
- Window ground = --bd-bg-base. Three panels on it, each --bd-bg-surface, 1px --bd-border-default hairline, radius 6px.
- Outer inset 12 on all sides. Panels: left x12 w320 · gap 12 · centre x344 w608 · gap 12 · right x964 w304. Panel y12 h776.
- Ratio 320 : 608 : 304 (25 / 47.5 / 23.75 %). Matte; no shadows, no gradients, no glow.

## Left column (x12–332)
- Agents block: top pad 8; four rows pitch 36 (row centres y≈40, 76, 112, 148); bottom hairline at y171.
  Row grid (from panel left): name x16 (sans 14px, primary); dot x105 (8px circle --bd-success) + word x117 ("ok", sans 13px secondary);
  version x174 (mono 13px primary); Connect button right-aligned, right edge at x−12, 72×28, --bd-bg-elevated fill, hairline, radius 6, sans 13px.
- Runs block y171–347: heading "Runs" sans 14px primary at baseline y≈192 (pad 12 top); five rows pitch 24 starting y206, row height 20;
  run id mono 13px at x16, status word right-aligned at x−12 (mono 13px; failed = --bd-danger, ok = --bd-success);
  selected row (first) has --bd-bg-elevated fill spanning x8–x−8, radius 4. "View all…" sans 13px secondary at y≈332. Hairline at y347.
- Timeline y347–648: five entries; entry head line = speaker mono 12px bold primary + timestamp mono 12px secondary, 8 gap;
  body mono 10.5px primary (RE-MEASURED after r3: 45 chars span 281px = 6.24px/char; Plex Mono advance is 0.6em → 10.5px; 11px wraps at 290 wide), line pitch 18; entry gap 10, no offset between head and body (RE-MEASURED after r4: head-to-head pitch is 65px for a two-line entry = 18 + 36 + 11; entry heads at y364, 429, 495, 542, 608). First entry head at y≈364, fifth entry "Render failed." at y≈627. Hairline at y648.
- Composer y648–784: textarea x10–x−10, y658–773 (h115), --bd-bg-elevated fill? no — --bd-bg-surface with hairline border, radius 6;
  placeholder "Message codex..." mono 13px secondary at 8,10. Send button inside the textarea's bottom-right: 82×32, x238–320, y737–768,
  --bd-accent fill, --bd-text-on-brand label sans 14px, radius 4, hairline in accent.

## Centre column (x344–952)
- Stage y12–571 (h559), --bd-bg-surface (same as panel; it is the panel). Contents vertically centred (block spans y179–397, centre 288 ≈ stage centre 292):
  - status line: 10px dot --bd-danger + "exhausted" sans 16px --bd-danger, centred, baseline y≈184.
  - attempts table: x458–841 (w383, h91), y206–297, hairline border, radius 4, padding 10 14. Three rows pitch 22, mono 13px primary.
    Column x (absolute): caret ▸ 475 (secondary), attempt name 492, "exit N" 601, seconds 684, "produced no" 738.
    Row 1 only: attempt name and seconds underlined (mockup detail; keep as text-decoration underline).
  - sentence "Codex produced nothing. Nothing was written." mono 13.5px primary centred, baseline y≈343.
  - Retry button 76×32 centred (x611–687), y366–397, --bd-bg-elevated, hairline, radius 6, sans 14px primary.
  Hairline at y571.
- Strip y571–698: one thumbnail at x353, y583, 96×103: hairline in --bd-accent (2px), radius 4, empty interior --bd-bg-surface,
  hairline separator at y658 then label "r1-a" mono 12px centred in the 28px label band. Hairline at y698.
- Toolbar y698–784: four buttons h40, y711–751, widths 132, gap 14, starting x358: "Re-render" (--bd-accent fill, on-brand text),
  "New variant", "Ask agent", "Blind read" (--bd-bg-elevated, hairline). Sans 15px.

## Right column (x964–1268), inspector: three stacked sections separated by hairlines at y214 and y421
- Section padding 12 left/right (text x976), 16 top. Heading sans 16px primary: "Brief" baseline y≈41, "Art direction" y≈245, "Critique" y≈453.
- Brief body: sans 14px primary, line pitch 22, starts y≈65, wraps at panel width (5 lines).
- Art direction: bullet list, "•" secondary, mono 13px primary, pitch 25, starts y≈271 (5 items), bullet x976, text x988.
- Critique: mono 13px primary, pitch 23, starts y≈479 (6 lines).

## Invented by the mockup — do not build
- Nothing structural this time (no title bar, no icons). Kept as drawn: the hollow r1-a thumbnail — in this state r1-a failed to render,
  so the app has no PNG for it; an outlined empty slot at the same luminance is the honest placeholder.
- The underline on row 1's "direct"/"300s" is a generation artefact but at 1px it costs nothing; keep it.
- The app's toolbar copy is "Re-render → r2-a" / "New variant → r1-b"; the approved mockup says "Re-render" / "New variant". Build the mockup copy.

## Masks
None — no stage image in this state.
