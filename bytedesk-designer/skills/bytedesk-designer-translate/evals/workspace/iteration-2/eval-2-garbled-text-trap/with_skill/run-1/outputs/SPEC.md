# SPEC — Designer Studio, workbench layout, state "new-project" (type picker dialog)

Mockup: ~/Pictures/claude-design/runs/2026-08-28-designer-studio-mockups/images/r4-p4.png (1586×992, scale 1.2391)
Logical size: 1280×800. All numbers below are logical px, read off translate/grid-new-project.png and
pixel-scanned hairlines (translate/notes.md has the scan rows/cols used).

## Columns (hairline dividers, 1px --bd-border-default)
| region | x | width |
|---|---|---|
| left column | 0–313 | 313 (24.5%) |
| centre column | 313–988 | 675 (52.7%) |
| right column (inspector) | 988–1280 | 292 (22.8%) |
Ground --bd-bg-base everywhere; cards --bd-bg-surface with 1px --bd-border-default, radius 6px.

## Left column (8px inset; cards x 8–305, 297 wide)
- Solution row: y 0–41, "Solution" secondary 14px at x 14, name "Acme Digital Suite" primary medium 15px at x 68, chevron at x 176. Hairline at y 41 full column width.
- Agents card: y 50–216. Header "Agents" 14px medium at y 60, hairline under header at y 78. Four rows, 34px pitch, hairline between: baselines y 94 / 128 / 162 / 196. Columns: name x 18 (sans 13px), dot ø7 + status word x 96 (13px), version mono 12px x 166, "Connect" button x 230–292 (62×24, elevated bg, hairline border, 12px).
- Projects card: y 224–317. Header "Projects" at y 241 with a "+" at x 287. Body: "No projects yet" secondary 13px at y 276; "Create your first project to get started." secondary 13px at y 298.
- Conversation card: y 326–670. Header "Conversation with claude" 14px at y 341. Timeline rows: time mono 11px at x 18, speaker 12px at x 52, status dot+word right-aligned at x 260–280; body text mono 12px at x 18, 18px line pitch. Row tops y 366, 432, 481, 583, 630. Scroll bar 4px at x 295, y 366–586.
- Composer card: y 680–787, textarea placeholder "Message claude…" at x 24 y 690 (13px secondary); "Send" primary button 52×26 at x 236–288, y 733–759, bg --bd-accent, radius 6.

## Centre column
- Stage card: x 325–976, y 16–616 (651×600), --bd-bg-base ground with a 1px --bd-border-dimmer hairline; content is the illustration (masked in compare; use a flat --bd-bg-subtle placeholder, no image).
- Thumbnail strip: two cards 122×74 at y 637–711; r1-a x 336–458; r2-a x 469–597 (selected: 1.5px --bd-accent outline). Labels mono 12px at y 723 under each, x 336 / 469.
- Toolbar: y 758–784 (26 tall), 12px text, radius 6, hairline border. "Re-render" x 328–395 (accent outline, accent text, transparent fill); "New variant" x 405–479; "Ask agent" x 490–553; "Blind read" x 564–630. Gap 10.

## Right column — inspector (label x 1003, value x 1090; hairline separators full width)
Hairlines at y 41, 107, 304, 371, 478, 611. Section title 14px medium at 12px below each hairline; rows 13px, 21px pitch; values mono 12px.
Content per the app's project inspector (r4-p5), not the mockup's image-file inspector:
- 0–41: "Inspector"
- 41–107: "Solution" · dot(success)+"connected" · mono "/solutions/acme-digital-suite" · mono "@ 9845b41"
- 107–304: "Project" · "No project selected" secondary · "Brief prompts" (4 unchecked boxes: Lead with clarity / Convey calm confidence / Highlight core value / Guide to next step) · "Deliverables": mono rows surfaces/*.html, identity/, direction/images/, review/findings.json each with a grey (tertiary) dot at x 1262.
- 304–371: "Stages" strip, six mono 11px names evenly across x 1003–1262: discovery direction identity surface review publish, tertiary dots below.
- 371–478: "Brief" — 1px hairline box x 1003–1262, y 410–470, placeholder "No brief yet" secondary mono.
- 478–611: "Art direction" — same box y 517–600, placeholder "—".
- 611–800: "Project settings" — rows Name / Type / Created / Last updated with "—" values at x 1090, y 655 / 676 / 697 / 718.

## Dialog (the subject)
- Backdrop: full workbench dimmed by --bd-overlay-backdrop.
- Card: x 363–917, y 110–632 (554×522), --bd-bg-surface, 1px --bd-border-default, radius 6, no shadow. Inner padding 16 (content x 379–900).
- "New project" 17px medium at y 134 (cap top ~128).
- "Name" label 13px secondary at y 166; input x 379–900, y 180–207 (521×27), --bd-bg-base fill, hairline border, value "Marketing site" 13px primary, 10px inset.
- Family headings 13px secondary: row 1 "Web" x 379 / "Brand" x 685, y 233; row 2 "Marketing" x 379 / "Product" x 685, y 345; row 3 "Content" x 379 / "Custom" x 632, y 457.
- Type cards 73 tall, radius 6, --bd-bg-elevated fill, 1px hairline border, 8px inner padding; title 13px medium at card y+18, description 11.5px secondary two lines at 14px pitch from card y+37.
  - Row 1 y 249–322: Website 379–473 (94) selected → 1.5px --bd-accent border; Web app 480–570; Dashboard 577–666; Logo / identity 685–785; Brand guide 792–899.
  - Row 2 y 362–434: Campaign 379–473; Presentation 480–570; One-pager 577–666; Mobile app 685–785; Desktop app 792–899.
  - Row 3 y 474–547: Illustration set 379–479; Icon set 486–587; Custom "Define your own" x 632–900, dashed 1px --bd-border-default, transparent fill, label centred 13px secondary.
- Footnote mono 12px secondary "3 types added by this solution" at x 379, y 570.
- Footer: "Cancel" 13px primary text button, x 745–779, y 589–616; "Create project" primary button x 800–900, y 589–616 (100×27), --bd-accent fill, --bd-text-on-brand text 13px medium, radius 6.

## Invented by the mockup — do not build
- Right-column asset inspector (Selection r2-a.png, Details ID/Type/Dimensions/Size/Created/Agent/Status, Tags, Notes, History). The product's inspector shows the selected project (r4-p5); with no project yet it shows the empty project section above.
- Document icons beside r1-a.png / r2-a.png in the transcript — keep as plain mono file rows.
- The fog illustration itself (masked; placeholder ground only).
