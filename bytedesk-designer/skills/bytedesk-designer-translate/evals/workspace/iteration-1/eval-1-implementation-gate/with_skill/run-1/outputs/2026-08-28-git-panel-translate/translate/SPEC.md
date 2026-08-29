# SPEC — git-panel layout (mockup r5-q3.png, 1586×992 → logical 1280×801, scale 1.2391)

All numbers logical px, read off translate/grid-git-panel.png and a hairline probe (column/row luminance peaks).

## Frame
- Window 1280×800. Ground = --bd-bg-base. Body overflow hidden.
- Three columns split by 1px hairlines (--bd-border-default) at x=339 and x=905:
  left 0–339 (339px, 26.5%), centre 340–905 (565px, 44%), right 906–1280 (374px, 29.3%).
- Left column text inset 22px; right column text inset 20px; centre inset 28px (stage x 368–881).

## Left column
- Solution row: y 0–42 (42 tall), hairline under at y=42. "Solution" secondary 14px, name primary semibold 15px, chevron ›. Baseline ~y=26.
- Agents block: rows at y=60, 87, 115, 142 (pitch 27–28); 4 cols: name (mono 13px), dot 8px + "ok" (13px), version mono 13px right-ish at x≈176, "Connect" button 68×26 at x 250–318, radius 6, elevated bg, hairline border.
- Provider rows git y=179, github y=205 (same pitch, no button; github value "ryanhelms" mono at x≈176). Hairline under block at y=225.
- Projects block: heading "Projects" semibold 14px at y=245. Selected project card outlined 1px --bd-accent, radius 6, x 18–321 (303 wide), y 260–376 (116 tall); inside: chevron ⌄ + "Marketing site" semibold 14px at y=274, mono line "main · ↑2 ↓0 · 3 changed" secondary 12px at y=292; nested runs box (hairline, radius 4) x 39–310, y 305–370 with two run rows (mono 12px, right-aligned age "2h ago"/"1d ago" secondary 11px) at y=318, 338 and "+ run" at y=357.
- Collapsed projects: "Design system docs" y=391 + mono line y=407; "Brand campaign" y=432 + mono y=449. Hairline under block y=470.
- Conversation: heading "Conversation" semibold 14px y=487. Four messages: agent name mono 13px + time secondary 12px on one line, sentence on next (13px); pitch 38px starting y=510.
- Composer textarea x 23–319, y 658–724 (66 tall), surface bg, hairline border, radius 6, placeholder "Message agents…". Send button 58×30 at x 261–319, y 737–767, --bd-accent fill, --bd-accent-fg text, radius 6.

## Centre column
- Stage x 368–881 (513 wide), y 63–495 (432 tall): PLACEHOLDER only — flat --bd-bg-surface block, radius 6 (the mockup's fog image is not a surface).
- Thumb strip: two thumbs 116×80 at x 367–483 and 488–603, y 519–599; radius 6; r1-a selected = 1px --bd-accent outline, r2-a hairline. Labels mono 13px centred under at y=611.
- Hairline at y=645 (thumb strip / toolbar divider), spans x 368–881.
- Toolbar buttons y 682–714 (32 tall), radius 6, 14px text: Re-render x 368–484 (117, accent fill), New variant 504–624 (120), Ask agent 643–753 (110), Blind read 773–882 (110). Plain ones: elevated bg + hairline.

## Right column (inspector)
- Section insets 20px left/right; headings semibold 14px.
- Solution section y 0–134: heading y=26; dot 8px green + "connected" 13px y=52; mono path 13px y=78; mono "design-system @ 9f3c1a7 · main · up to date" y=107. Hairline y=134.
- Git section y 134–513: heading "Git" y=158; mono remote "ryanhelms/marketing-site" 13px y=184;
  branch select x 925–1255 (330 wide) y 202–228 (26 tall), elevated bg, hairline, radius 6, mono "main" + chevron ⌄ right;
  status row y=249: amber dot 8px + "3 changed · 2 ahead · 0 behind" 13px; hairline y=270;
  file rows mono 13px at y=291, 319, 347 (pitch 28): 2ch status letter (M/M/A, secondary) then path; hairline y=366;
  "Commit message" label secondary 13px y=387; textarea x 925–1255, y 402–458 (56 tall), surface bg, hairline, radius 6, mono 14px value "direction round 2";
  button row y 468–496 (28 tall), radius 6: Pull x 925–1018 (93), Commit 1036–1139 (103, accent fill), Push 1162–1255 (93). Gap between = 18px (space-between across 330).
  Hairline y=513.
- Project section: heading y=537; mono "website · active" 13px y=565. (No divider drawn between Project and Brief in the mockup.)
- Brief section: heading y=608; body 13px, line pitch 19px, lines from y=628: four-line paragraph then three single lines (Audience/Primary CTA/Secondary CTA).

## Type
- Chrome: --bd-font-sans 13px body, 14px headings semibold; mono: --bd-font-mono 13px (12px in nested runs). Cap heights measured 9–10px ⇒ 13–14px.
- Dots 8px round. Radii 6 everywhere (4 on nested runs box). No shadows, no gradients.

## Invented by the mockup — DO NOT BUILD
- Rounded window frame / outer border with 3px inset and rounded corners.
- The fog/amber-line stage image and the thumbnail images (placeholders at the same rects instead).
- The film grain.
- The "Connect" button on agents that are already "ok" is questionable but is in the brief — build it.
