# SPEC — Designer Studio workbench, "new project" dialog state

Mockup: r4-p4.png, 1586×992 → logical 1280×800 (scale 1.2391). All numbers below are logical px,
read off translate/grid-new-project-dialog.png. Tokens: --bd-* (surfaces/tokens/design.css, dark default).
Product scope attribute in this authority is `data-bd-product`; no designer-studio profile exists, so the
family default accent (brand orange) applies — which is what the mockup shows.

## Columns (three, hairline dividers)
- Left column: x 0–313 (w 313). Divider at x 313.
- Centre column: x 313–988 (w 675).
- Right column (inspector): x 988–1280 (w 292). Divider at x 988.
- Ground: --bd-bg-base. Panels: --bd-bg-surface with 1px --bd-border-default, radius 6px (--bd-radius-md).

## Left column
- Solution row: y 0–40, hairline below. Text baseline row centred; x inset 15. "Solution" secondary 13px,
  name "Acme Digital Suite" primary 15px medium, small chevron (CSS, 8px) after it.
- Panels inset x 8–303 (w 295). Vertical gaps between panels 8.
- Agents panel: y 43–216 (h 173). Header "Agents" row h 34 (13px primary, inset 12), hairline below.
  4 rows, pitch 34: name x 18 (13px primary); dot 6px at x 100 + word (11px secondary) at x 110;
  version mono 11px secondary at x 165; "Connect" button right-aligned, 63×22, --bd-bg-elevated,
  1px --bd-border-default, 11px primary text, right edge at x 292.
  Rows: claude / ok green / v1.12.3; codex / busy amber / v0.9.7; grok / ok green / v1.4.2; kimi / failed red / v2.1.0.
- Projects panel: y 224–316 (h 92). Header "Projects" h 34 with a "+" glyph at right (x 288).
  Two lines: "No projects yet" 13px primary at y 276; "Create your first project to get started." 12px secondary at y 297.
- Conversation panel: y 324–669 (h 345). Header "Conversation with claude" h 34, hairline below.
  Messages: meta row = time mono 11px secondary at x 18, author 12px secondary at x 54, status (dot + word 11px) right at x 280;
  body mono 11.5px primary at x 18, line-height 15. Meta rows at y 367, 432, 481, 581, 630.
  Attachment rows (r1-a.png, r2-a.png) mono 11.5px indented x 33 with a 10×12 CSS "file" rectangle glyph before, at y 526, 551.
  Thin 3px scrollbar track at x 296, thumb y 365–585, --bd-border-default.
- Composer: y 677–781 (h 104), --bd-bg-surface, border, radius 6. Placeholder "Message claude..." 13px secondary at x 18, y 692.
  "Send" button 52×27 orange fill (--bd-brand-orange) white/on-brand text 13px medium, at x 236–288, y 731–758, radius 4.

## Centre column
- Stage panel: x 326–977, y 15–614 (651×599), --bd-bg-base, 1px --bd-border-dimmer, radius 6. Content is an image in the
  mockup (fog) — surface uses the flat panel only, no illustration.
- Thumbnails: r1-a at x 337–457, y 638–708 (120×70), --bd-bg-subtle, 1px --bd-border-dimmer;
  r2-a at x 469–596, y 638–709 (127×71), 2px --bd-brand-orange outline. Labels mono 11px secondary at y 723 under each, x aligned with card left.
- Toolbar: y 759–784 (h 25). Re-render x 328–395 (w 67): transparent fill, 1px --bd-brand-orange border, orange text.
  New variant x 404–479; Ask agent x 489–553; Blind read x 563–630: --bd-bg-surface, 1px --bd-border-default, 12px primary text. Radius 4. Gap 9.

## Right column (inspector)
- Header "Inspector" 13px primary at x 1003, y 22; hairline at y 40.
- Section dividers (hairline, full column width) at y 107, 305, 371, 479, 612.
- Section titles 12px secondary at x 1003: Selection y 62, Details y 129, Tags y 325, Notes y 390, History y 497, Project settings y 629.
- Selection value "r2-a.png" mono 12px primary at y 86.
- Details rows pitch 21 starting y 155: label 12px primary x 1003, value mono 12px secondary x 1090:
  ID img_7f2b9c1d; Type image/png; Dimensions 1920 × 1080; Size 1.42 MB; Created May 20, 2025 10:23; Agent claude; Status (green dot) ok.
- Tags: "+ Add tag" 12px secondary at y 348.
- Notes: textarea x 1003–1264, y 408–472 (261×64), --bd-bg-surface, border, placeholder "Add a note..." 12px tertiary.
- History: two entries, mono-free — line1 mono 11px secondary (May 20, 2025 10:23 / May 20, 2025 10:24), line2 12px secondary
  (Created by claude / Selected). At y 523/540 and 570/586.
- Project settings rows pitch 21 from y 655: Name, Type, Created, Last updated; value "—" at x 1090.

## Modal
- Card: x 363–918, y 111–632 (555×521). --bd-bg-surface, 1px --bd-border-default, radius 6, --bd-shadow-elevated allowed.
  NO dimming scrim over the workbench (the mockup's chrome is at full brightness).
- Inner inset 17. Title "New project" 16px medium primary, baseline region y 128–141.
- "Name" label 12px secondary at y 165. Input x 380–901, y 180–207 (521×27), --bd-bg-elevated... use --bd-bg-base fill,
  1px --bd-border-default, radius 4, value "Marketing site" 13px primary, padding-left 8.
- Type grid: two column-groups. Left group starts x 380; right group starts x 684.
  Group headings 12px secondary: row1 at y 234 (Web / Brand), row2 y 345 (Marketing / Product), row3 y 457 (Content / Custom).
  Cards: h 73, 5px gaps, top edges at y 249, 361, 473. Card fill --bd-bg-elevated, 1px --bd-border-default, radius 4,
  padding 8; title 12px semibold primary; description 10.5px secondary, line-height 14, 2 lines.
  Row1 Web: Website 94w (x 380–474, 2px orange outline), Web app 94w (x 479–573), Dashboard 90w (x 578–668).
       Brand: Logo / identity 102w (x 684–786), Brand guide 106w (x 795–901).
  Row2 Marketing: Campaign, Presentation, One-pager at the same x as row1 Web cards. Product: Mobile app, Desktop app same as Brand.
  Row3 Content: Illustration set 101w (x 380–481), Icon set 101w (x 487–588). Custom: one card x 632–901 (269w), h 71,
       1px DASHED --bd-border-default, no fill, "Define your own" 13px secondary centred.
  Card copy: Website "Marketing sites and brochure pages"; Web app "Interactive web applications"; Dashboard "Data and metrics interfaces";
  Logo / identity "Logos and visual identities"; Brand guide "Guidelines and brand systems"; Campaign "Multi-channel campaigns";
  Presentation "Slide decks and presentations"; One-pager "Single-page marketing assets"; Mobile app "iOS and Android applications";
  Desktop app "Mac, Windows, and Linux apps"; Illustration set "Custom illustrations and scenes"; Icon set "Icon libraries and collections".
- Footnote "3 types added by this solution" mono 11px secondary at x 380, y 570.
- Footer: "Create project" 99×26 orange fill, on-brand text 13px medium, x 802–901, y 590–616, radius 4.
  "Cancel" text-only 13px primary, right edge at x 779, same vertical centre.

## Invented by the mockup — do not build
- The stage's fog/amber-line illustration and the thumbnails' images (flat panels instead).
- Fine film grain over everything.
- Any dimming of the workbench (not visible in the mockup).

## Correction after round 2 (measured by luminance sampling, mockup vs render)
- Modal card fill is --bd-bg-subtle (mockup lum 26 ≈ #171A1D), NOT --bd-bg-surface (32).
- Stage panel fill is --bd-bg-subtle (26), not --bd-bg-base.
- Type cards fill is --bd-bg-surface (mockup 28.5; the nearest raised step over the modal), not --bd-bg-elevated (40).
- Name input fill is --bd-bg-subtle (26), not --bd-bg-base (19).
- Type-card titles are medium weight (title region lum 41 vs 80 rendered at semibold).
