# DESIGN.md — ByteDesk Capture

Dark theme is default. Do not hard-code one-off palettes outside tokens.

## Tokens (v1)

| Token | Hex | Use |
|-------|-----|-----|
| `bg.app` | `#121216` | App background |
| `bg.panel` | `#18181c` | Panels |
| `bg.elevated` | `#1f1f24` | Elevated surfaces |
| `text.primary` | `#e4e4e7` | Body |
| `text.secondary` | `#a1a1aa` | Secondary |
| `accent` | `#0a84ff` | Primary actions (≤5% footprint) |
| `danger` | `#ff3b30` | Destructive / record |
| `warning` | `#ffd60a` | Highlighter default |
| `success` | `#30d158` | Success |

## Typography

- UI: system sans
- Mono only for paths, numeric readouts, hotkey labels

## Motion

- Function-only 120–360ms ease-out
- No marketing-tier loops

## Density

- Tray agent and overlays stay compact
- Annotate tool rail ~220px

## Tray popover (locked: A+B hybrid)

**Decision (owner):** combine direction **A** (classic menu density + hotkeys) with **B** (tight last-capture links + open-at-login). Not the old tall button-stack window (#1 rejected).

| Property | Spec |
|----------|------|
| Shape | Status-item / tray **popover**, ~280–300px wide, not a main app frame |
| Row height | ~28px; hairline dividers `#27272a` |
| Structure | Header → Capture group → Record group → Tools group → Last capture → Footer |
| Capture | Area, Window, Fullscreen, Scrolling, All-in-one + mono hotkeys right-aligned |
| Record | Record video (danger dot), Capture GIF |
| Tools | OCR, Annotate, History, Pin last |
| Last capture | 56×40 thumb + “Still · just now” + truncated mono path + text links **Copy · Annotate · Pin** |
| Footer | Open at login switch · Preferences · Quit |
| Accent | `#0a84ff` only on hover/selected row (≤5%); not on every button |
| Icons | Monoline only; no emoji-like glyphs |
| Anti-patterns | Large primary button stacks, marketing cards, glass blur chrome, purple/neon |

Implementation target: tray popover panel (egui) until gpui tray lands.

Reference mockup: session `images/9.jpg` (A+B hybrid).

## Polish (v1.1)

| Surface | Polish |
|---------|--------|
| Tray panel | 28px rows, mono hotkeys, accent hover bar, empty state |
| Area picker | Dim/cutout selection, size badge, HUD chips, loupe coords |
| Overlay | Toast card, action chips, eased auto-close bar, copy toast |
| Annotate | 2-col tool grid, color/stroke, live rubber-band, copy CTA |
| History | Thumbs + chips + empty states |
| Settings | Section helpers, hotkey table, conflict banner, sticky save |
| Pin | Thin chrome, edge-to-edge image, soft shadow |
| Global | Esc closes, DESIGN tokens only, success/error toasts |

## Polish (v1.2) — 40-item depth pass

| Area | Items |
|------|--------|
| Tray | Monoline icons, hotkey pills, skeleton shimmer, recent strip, open anim, focus-auto-hide |
| Area | Aspect lock, thirds grid, multi-monitor strip, retina badge, magnet snap, Esc flash |
| Overlay | Glyph chips, drag-out path reveal, C/A/P keys, stack strip, corner memory |
| Annotate | Tool icons, color+eyedropper, pencil pressure, text fonts, resize handles, layers, zoom/pan, checkerboard, `?` legend |
| History | Grid/list, search, multi-select bulk, hover scrub label, date headers |
| Settings | Row conflict border, search, reset section, overlay preview, Accessibility section |
| Pin / Rec | Click-through lock, rotate/flip, mic level meter |
| Global | Reduced motion, high contrast, large type (`Settings.ui`) |

## Polish (v1.3) — second 40-item depth pass

| Area | Items |
|------|--------|
| Tray | Icon pulse on capture, ↑↓/Enter nav, collapsible sections, drag last path, quiet-mode flag, panel position memory |
| Area | Space freeze, arrow nudge, loupe RGB, size presets, dim slider, optional shutter sound |
| Overlay | Swipe dismiss, OCR chip, Annotate+, share hash-QR, countdown ring |
| Annotate | Tool letter shortcuts, smart guides, Ctrl+D duplicate, style copy, inline text edit, blur/pixel sliders, `` ` `` before/after, export sheet, minimap |
| History | Favorites, tag edit, large list, compare two, storage footer + prune |
| Settings | Hotkeys import/export, dirty nav dots, a11y live preview, Test hotkey, capture sound / dim / pin shadow |
| Pin / Rec | Multi-tab pins, shadow slider, pause/resume HUD, click/key badges |
| Global | Command palette (`Ctrl+K` / `palette` CLI) |
