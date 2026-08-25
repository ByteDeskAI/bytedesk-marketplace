---
name: ByteDesk ADE
description: Dense, dark-first agent development workbench — terminal grid first, precision-instrument chrome
colors:
  paper: "oklch(17% 0.008 250)"
  paper-2: "oklch(21% 0.010 250)"
  paper-3: "oklch(25% 0.012 250)"
  band: "oklch(13% 0.006 250)"
  ink: "oklch(93% 0 0)"
  ink-2: "oklch(65% 0 0)"
  ink-3: "oklch(50% 0 0)"
  rule: "oklch(28% 0.008 250)"
  accent: "oklch(65% 0.15 250)"
  accent-strong: "oklch(72% 0.14 250)"
  accent-wash: "oklch(30% 0.045 250)"
  accent-ink: "oklch(16% 0.010 250)"
  focus: "oklch(65% 0.15 250)"
  success: "oklch(70% 0.13 160)"
  warning: "oklch(78% 0.13 85)"
  danger: "oklch(65% 0.19 25)"
  # sRGB bridges from packages/theme/tokens.json (OKLCH→sRGB); prefer these over ad-hoc CSS hex
  paper-hex: "#0d1013"
  paper-2-hex: "#15191d"
  paper-3-hex: "#1d2227"
  band-hex: "#060709"
  ink-hex: "#e8e8e8"
  ink-2-hex: "#8f8f8f"
  ink-3-hex: "#636363"
  rule-hex: "#26292d"
  accent-hex: "#3a93e6"
  accent-strong-hex: "#5aa8f0"
  accent-wash-hex: "#2a3f55"
  accent-ink-hex: "#0c1014"
  success-hex: "#4db88a"
  warning-hex: "#d4a84b"
  danger-hex: "#e06b5c"
typography:
  display:
    fontFamily: "Inter Tight, Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  mono:
    fontFamily: "JetBrains Mono, SF Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "4px"
  md: "6px"
  input: "8px"
  card: "12px"
  pill: "999px"
spacing:
  "2xs": "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.input}"
    padding: "4px 8px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.input}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "4px 8px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.input}"
  input-default:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "6px 8px"
  dialog-surface:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 18px"
  activity-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.input}"
    size: "32px"
  activity-button-pressed:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent-strong}"
    rounded: "{rounded.input}"
    size: "32px"
---

# Design System: ByteDesk ADE

**Status:** Owner-approved foundation (interview rounds 1–5, 2026-07-17), reformatted 2026-07-20 for Impeccable / DESIGN.md tooling. Prior narrative copy preserved in `DESIGN.md.bak.*` and git history.

**Canonical color values:** OKLCH tokens in frontmatter (`paper`, `accent`, …). `*-hex` entries are **sRGB bridges** for Stitch / web shells (e.g. `ui-tauri`); they approximate OKLCH and must not invent a second brand. When tokens change, change OKLCH first, then re-derive hex.

**Product shells:** Mainline composition is **gpui** (`ade-app`). **Tauri 2 + Vite** (`ui-tauri`, branch `feat/tauri-v2-migration`) is a **review shell** that must obey this file; it is not the product default until owner Accept (see `docs/DECISIONS.md` D4/D5/D30).

## 1. Overview

**Creative North Star: "The Precision Instrument"**

ByteDesk ADE is a dense, dark-first **Agent Development Environment**: a workbench that feels like a calibrated tool, not a marketing site and not a pastel SaaS dashboard. The emotional contract is quiet confidence under load — many agents, many terminals, keyboard-first flow, no spectacle. Warmth never comes from UI tokens; if it appears at all, it is marketing illustration only.

The macrostructure is **Workbench**: activity rail, workspace rail, optional side panel, **auto-tiling terminal grid as the main area**, status bar. Editors and chat are secondary tiles in the same grid, never the centerpiece. Visual language is monochrome Inter with a single cyan-blue accent held to a tiny footprint. Depth is **tonal layering** (paper / paper-2 / band), not glass, aurora, or decorative shadow stacks.

**Explicitly rejected:** side-stripe accent borders, gradient text, glassmorphism-as-default, emoji activity chrome, browser `prompt()` for secrets, monospaced UI labels, invented hero metrics, marketing “premium motion” (magnetic CTAs, tilt, spotlight) inside the app shell.

**Key Characteristics:**

- Dark-first (>85% assumed IDE use); light theme is Workforce-canonical and secondary
- Terminal-grid-first; VS Code furniture frames a cmux-like session model
- Accent ≤5% of any screen; rarity is the brand
- Mono face only in code, terminal, diff, and numeric readouts
- Function-only motion (120–360ms ease-out); reduced-motion demotes ambient loops to static dots
- High-stakes actions (merge, discard, delete, secrets) use branded dialogs with confirmations

## 2. Colors

A cool-neutral dark ramp on hue **250** with one restrained cyan-blue accent and semantic status colors that never carry meaning alone.

### Primary

- **Instrument Cyan** (`oklch(65% 0.15 250)` / `#3a93e6`): CTAs, focus rings, active selection, voice listening, links. Hover is **Accent Strong** (`oklch(72% 0.14 250)`). Selected surfaces use **Accent Wash** (`oklch(30% 0.045 250)`). Text on filled accent is **Accent Ink** (`oklch(16% 0.010 250)`).

### Neutral

- **Paper** (`oklch(17% 0.008 250)` / `#0d1013`): app chrome background
- **Paper 2** (`oklch(21% 0.010 250)` / `#15191d`): raised / hover
- **Paper 3** (`oklch(25% 0.012 250)` / `#1d2227`): active / denser fill
- **Band** (`oklch(13% 0.006 250)` / `#060709`): deepest well (terminal grid, rails, status)
- **Ink / Ink 2 / Ink 3** (`oklch(93%/65%/50% 0 0)` / `#e8e8e8` / `#8f8f8f` / `#636363`): primary, secondary, disabled text
- **Rule** (`oklch(28% 0.008 250)` / `#26292d`): hairlines only

### Semantic (paired with icon or label)

- **Success** `oklch(70% 0.13 160)` / `#4db88a`
- **Warning** `oklch(78% 0.13 85)` / `#d4a84b`
- **Danger** `oklch(65% 0.19 25)` / `#e06b5c`
- **Info** tracks accent

### Editor syntax (restrained; six roles max)

- Text / type: ink
- Comment: ink-3 (italic allowed in editor only)
- Keyword: accent
- String: warm `oklch(75% 0.11 70)`
- Number: cool `oklch(72% 0.12 175)`

### Named Rules

**The Five-Percent Accent Rule.** Accent may appear on primary actions, current selection, focus, and sanctioned ambient indicators only. Colored workspace **names** are forbidden; workspace identity color lives on the rail bar / monogram only.

**The No Lone Status Color Rule.** Success, warning, and danger never communicate alone — always pair with icon or text.

**The Terminal Theme Rule.** PTY paint follows Ghostty / user theme; ADE’s default Ghostty theme tracks this cyan family, but user themes win.

## 3. Typography

**Display Font:** Inter Tight (fallback Inter, system-ui)
**Body Font:** Inter (system-ui)
**Label Font:** Inter 600, small caps tracking
**Mono Font:** JetBrains Mono / SF Mono / ui-monospace — **scoped exception only**

**Character:** One grotesk family for all chrome. Hierarchy is weight and tracking, not a second display face. Dense IDE measure; no marketing clamp() heroes.

### Hierarchy

- **Display / Title** (600–700, ~13px chrome headers, tight tracking ~-0.02em): panel headers, dialog titles
- **Body** (400, 13px UI base): lists, forms, panel content
- **Label** (600, 11px, letter-spacing 0.06–0.11em, often uppercase): rail headers (`WORKSPACES`), status bar, activity tooltips
- **Mono body** (400, 13px): terminal, editor, diff, tabular numeric readouts only

### Named Rules

**The Mono Scope Rule.** Mono is allowed only in: code editor, terminal, code blocks, diff viewers, tabular numeric readouts. UI labels stay Inter.

**The No Mono Labels Rule.** Do not monospaced-button or monospaced-nav the chrome.

## 4. Elevation

Depth is **tonal**, not cast-shadow. Surfaces step paper → paper-2 → paper-3 → band. Hairline **rule** borders define regions. Dialogs may use a soft ambient shadow (`0 16px 48px` dark scrim) as structural elevation for modal focus; resting chrome stays flat.

### Shadow Vocabulary

- **Modal lift** (`box-shadow: 0 12px–16px 40px–48px rgba(0,0,0,0.45–0.5)`): command palette and dialogs only
- **Focus ring** (`box-shadow: 0 0 0 1px accent`): keyboard focus-visible — not decoration
- **No resting card shadows** on workbench panels

### Named Rules

**The Flat-By-Default Rule.** Panels and tiles do not float. Only modal/palette layers leave the plane.

**The No Glass Rule.** No backdrop-blur chrome in the app shell.

## 5. Components

### Buttons

- **Shape:** 6–8px radius (`rounded.md` / `input`)
- **Primary:** accent fill, accent-ink text; hover → accent-strong
- **Secondary:** transparent / hairline rule; use for persistent actions like “+ Term” so accent is not always-on
- **Danger primary:** danger fill for irreversible confirms (merge, discard, delete)
- **Focus:** 1px accent ring via `:focus-visible`

### Activity rail

- **Style:** 44px band column; 32px icon buttons; monochrome outline SVG (not emoji)
- **Pressed / open panel:** accent-wash background, accent-strong glyph
- **A11y:** `aria-label` + `aria-pressed` required

### Workspace rail

- **Row:** color bar (3px) + monogram avatar + **ink** name (not chroma-tinted) + tile count
- **Active:** accent-wash row background
- **Actions:** context menu / dialog (rename, home, color, reorder, delete)

### Side panels

- **Header:** band, 11px uppercase tracking label
- **Body:** 12px body, dense lists; progressive disclosure for providers/diff admin

### Dialogs / confirmations

- **Shape:** 12px card radius; paper-2 surface; backdrop dim
- **Use for:** settings, secrets, paths, Accept & merge, discard, delete
- **Never:** `window.prompt` / bare `confirm` for product-critical flows
- **High-stakes:** danger primary + explicit consequence copy (branch, file count, irreversibility)

### Inputs / fields

- **Style:** paper fill, rule border, 8px radius
- **Focus:** accent ring
- **Secrets:** `type=password` in branded modal

### Command palette

- **Style:** centered elevated paper-2 panel; listbox semantics
- **Keys:** ↑↓ highlight, Enter run, Esc dismiss

### Terminal / editor tiles

- **Grid:** absolute tiles on band well; focused tile uses accent border
- **Mono** in body; chrome labels remain sans
- **Diff lines:** success/danger washes + text (not color alone)

### Status bar

- **Voice:** human-readable (`Workspace · layout · N tiles · waiting`) — not debug counters
- **Notice:** accent or warn/err semantic classes

### Navigation (app shell only)

- Left activity rail only; no marketing top nav in-product
- Keyboard: Ctrl/Cmd+P palette, Ctrl/Cmd+, settings, Esc closes overlay/panel

## 6. Do's and Don'ts

### Do

- Theme every surface through tokens (OKLCH SoT; hex only as derived bridge)
- Keep accent rare and intentional
- Prefer keyboard paths and visible focus
- Confirm irreversible git / vault actions
- Pair status color with label or icon
- Use mono only in code/terminal/diff/numeric contexts
- Respect reduced-motion for voice waveform and waiting pulse

### Don't

- Use emoji as the activity icon system
- Tint workspace **names** with workspace color
- Ship Accept & merge without confirmation
- Capture API keys via browser `prompt()`
- Introduce glass, gradient text, or left accent stripes
- Put mono on chrome labels or primary buttons
- Treat the Tauri webview shell as product default without owner Accept
- Invent secondary accent families for “visual interest”

### Shell mapping (implementation)

| Surface | Primary implementation |
|---------|------------------------|
| Mainline app | `crates/ade-app` (gpui) + `crates/ade-theme` |
| Review shell | `ui-tauri/` (tokens in `src/styles.css` must track this file) |
| DTCG export | `packages/theme/tokens.json` (mirror; planned full sync) |

### Authority

1. Explicit owner instruction
2. `AGENTS.md`
3. **This file** and `docs/DECISIONS.md`
4. Numbered records under `docs/`

When tokens change: **this file first**, then mirror exports and `ui-tauri` hex bridges.
