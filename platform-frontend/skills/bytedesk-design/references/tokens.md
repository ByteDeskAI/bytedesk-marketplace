# ByteDesk Design Tokens Reference

All tokens defined in `src/ByteDesk.Web/src/app/globals.css`. Use `var(--token-name)` in components.

## Table of Contents
1. [Colors — Backgrounds](#backgrounds)
2. [Colors — Text](#text)
3. [Colors — Accents & Status](#accents)
4. [Colors — Borders](#borders)
5. [Colors — Surface Tints](#surface-tints)
6. [Typography](#typography)
7. [Spacing](#spacing)
8. [Shadows](#shadows)
9. [Motion](#motion)
10. [Radius](#radius)
11. [Z-Index](#z-index)
12. [Icons & Layout](#icons-layout)
13. [Semantic Utility Classes](#utility-classes)

---

## Backgrounds

5-level ramp from deepest to shallowest. Think of it as a depth stack.

| Token | Value | Use |
|---|---|---|
| `--color-bg-base` | #0F1017 | Outermost shell, page background |
| `--color-bg-subtle` | #1A1C25 | Sidebar, secondary panels, nav rails |
| `--color-bg-surface` | #23252F | Cards, forms, primary content areas |
| `--color-bg-elevated` | #2A2C37 | Modals, dropdowns, popovers |
| `--color-bg-overlay` | #343742 | Top-level overlays, context menus |

**Decision guide:** Surface for most content. Elevated for anything that floats. Subtle for chrome/nav. Never skip a level — a modal (elevated) should never sit on base (too deep a jump).

### Interactive overlay states

| Token | Value | Use |
|---|---|---|
| `--color-bg-nav-active` | rgba(255,255,255,0.06) | Active nav pill background |
| `--color-bg-hover` | rgba(255,255,255,0.04) | Generic hover over any surface |

---

## Text

All maintain WCAG AA 4.5:1 contrast against `--color-bg-surface`.

| Token | Value | Contrast on Surface | Use |
|---|---|---|---|
| `--color-text-primary` | #E6E8ED | ~9.2:1 | Main content, headings, values |
| `--color-text-secondary` | #BFC4CA | ~6.5:1 | Supporting labels, descriptions |
| `--color-text-tertiary` | #A2A8B2 | ~4.8:1 | Metadata, timestamps, hints |
| `--color-text-disabled` | #6B7280 | ~3.5:1 | Disabled controls (not interactive) |
| `--color-text-on-orange` | #FFE2D8 | — | Text on orange CTA backgrounds only |

---

## Accents & Status

| Token | Value | Strict usage rule |
|---|---|---|
| `--color-accent-blue` | #0079F2 | ALL interactive elements — buttons, links, focus, selection |
| `--color-accent-orange` | #EC4E02 | BRAND/UPGRADE CTAs only — never general interactive |
| `--color-accent-orange-muted` | #D96D00 | Orange text/icons on dark surfaces |
| `--color-accent-green` | #009118 | Success, running, healthy |
| `--color-accent-red` | #E52222 | Danger, failed, critical error |
| `--color-accent-amber` | oklch(0.76 0.16 85) | Warnings, pending states |
| `--color-accent-purple` | oklch(0.65 0.18 300) | AI features only |
| `--color-accent-cyan` | oklch(0.72 0.12 210) | Neutral highlight, informational |

### Status semantic aliases

| Token | Maps to | Use |
|---|---|---|
| `--color-status-running` | green | Active job/service |
| `--color-status-completed` | darker green | Finished successfully |
| `--color-status-failed` | red | Error/failure |
| `--color-status-pending` | amber | Queued/waiting |
| `--color-status-cancelled` | #6B7280 | Cancelled/skipped |

---

## Borders

5-level hierarchy. Use `border-default` unless you have a specific reason to go dimmer/stronger.

| Token | Value | Use |
|---|---|---|
| `--color-border-dimmest` | #252732 | Barely visible separators, subtle section breaks |
| `--color-border-dimmer` | #31343F | Secondary borders, nested elements |
| `--color-border-default` | #3A3D48 | Standard card/input borders |
| `--color-border-stronger` | #444752 | Hover states, active inputs |
| `--color-border-strongest` | #4D505C | Focus indicators, high-emphasis separators |
| `--color-border-hover` | #444752 | Alias — use for border-color on :hover |

---

## Surface Tints

Transparent tinted backgrounds for callouts, banners, and status areas.

| Token | Value | Use |
|---|---|---|
| `--color-bg-error-subtle` | oklch(0.62 0.21 26 / 0.06) | Error callout background |
| `--color-bg-info-subtle` | oklch(0.63 0.14 254 / 0.08) | Info/active/running callout |
| `--color-bg-info-faint` | oklch(0.68 0.18 250 / 0.04) | Very subtle inline callouts |
| `--color-bg-ai-subtle` | oklch(0.68 0.18 250 / 0.07) | AI feature callouts |

---

## Typography

### Fonts (EXCLUSIVE — no other fonts permitted)
- `font-sans` → IBM Plex Sans — all UI text
- `font-mono` → IBM Plex Mono — code, data values, labels, tables, IDs

### Size scale

| Token | Value | Semantic class | Use |
|---|---|---|---|
| `--text-2xs` | 10px | `text-2xs` | Badges, tiny labels |
| `--text-xs` | 11px | `text-xs` / `.text-caption` | Captions, metadata, timestamps |
| `--text-sm` | 12px | `text-sm` / `.text-body-sm` | Secondary text |
| `--text-base` | 14px | `text-base` / `.text-body` | Primary content (default) |
| `--text-lg` | 16px | `text-lg` / `.text-h3` | Subheadings |
| `--text-xl` | 20px | `text-xl` / `.text-h2` | Section titles |
| `--text-2xl` | 28px | `text-2xl` / `.text-h1` | Page hero titles |
| `--text-3xl` | 36px | `text-3xl` | Large display values |
| `--text-display` | 48px | `text-display` | Giant scores, hero numbers |

### Semantic typography classes (use these, not raw sizes)

| Class | Size | Weight | Line-height | Use |
|---|---|---|---|---|
| `.text-h1` | 28px | 600 | 1.2 | Page heroes |
| `.text-h2` | 20px | 600 | 1.25 | Section titles |
| `.text-h3` | 16px | 600 | 1.3 | Card/panel headings |
| `.text-h4` | 14px | 600 | 1.35 | Sub-headings |
| `.text-h5` | 12px | 600 | 1.4 | Minor headings |
| `.text-body` | 14px | 400 | 1.5 | Primary content |
| `.text-body-sm` | 12px | 400 | 1.5 | Secondary content |
| `.text-caption` | 11px | 400 | 1.4 | Metadata, timestamps |
| `.text-label` | 11px | 700 | 1 | Form labels (mono, uppercase) |

### Mono utility classes

| Class | Description |
|---|---|
| `.mc-label` | Mono, 11px, 700, uppercase, 0.1em tracking, tertiary color |
| `.mc-section-label` | Mono, 11px, 700, uppercase, 0.1em tracking, disabled color |
| `.mc-value` | Mono with tabular-nums, primary color |

---

## Spacing

Density-aware: all `--space-*` tokens multiply by `var(--density)` (default 1.0).

| Token | Value at density 1 | Common Tailwind equivalent |
|---|---|---|
| `--space-px` | 1px (not density-scaled) | |
| `--space-0-5` | 2px (not density-scaled) | |
| `--space-1` | 4px | `p-1`, `gap-1` |
| `--space-2` | 8px | `p-2`, `gap-2` |
| `--space-3` | 12px | `p-3`, `gap-3` |
| `--space-4` | 16px | `p-4`, `gap-4` |
| `--space-5` | 20px | `p-5`, `gap-5` |
| `--space-6` | 24px | `p-6`, `gap-6` |
| `--space-8` | 32px | `p-8`, `gap-8` |

---

## Shadows

### Depth shadows (standard elevation)

| Token | Use |
|---|---|
| `--shadow-sm` | Subtle card lift, `depth-surface` class |
| `--shadow-md` | Standard card, `depth-card` class |
| `--shadow-lg` | Modals, elevated panels, `depth-elevated` class |
| `--shadow-xl` | Top-level overlays, mega-modals |
| `--shadow-inset` | Form inputs, recessed elements |

### Colored glows (use sparingly — AI features, special status)

| Token | Use |
|---|---|
| `--shadow-glow-blue` | Active/selected state on blue elements |
| `--shadow-glow-green` | Running/success status for high-emphasis indicators |
| `--shadow-glow-purple` | AI feature callouts |

### Depth utility classes (apply to container elements)

| Class | Effect |
|---|---|
| `.depth-surface` | sm shadow + subtle border |
| `.depth-card` | md shadow + gradient top-light + border |
| `.depth-elevated` | lg shadow + gradient top-light + border |
| `.depth-inset` | inset shadow only (for recessed areas) |
| `.depth-divider` | gradient horizontal divider |

---

## Motion

### Duration tokens

| Token | Value | Use |
|---|---|---|
| `--duration-fast` | 120ms | Micro-interactions, icon swaps, badge changes |
| `--duration-normal` | 200ms | State changes, button feedback, hover transitions |
| `--duration-slow` | 300ms | Panels sliding in, modal appearance |
| `--duration-enter` | 250ms | Enter animations |
| `--duration-exit` | 200ms | Exit animations (slightly faster = snappier feel) |
| `--duration-stagger` | 50ms | List item stagger delay (multiply by `--index` CSS var) |

### Easing tokens

| Token | Curve | Use |
|---|---|---|
| `--ease-out` | cubic-bezier(0.4, 0, 0.2, 1) | Standard state changes |
| `--ease-in-out` | cubic-bezier(0.4, 0, 0.2, 1) | Balanced transitions |
| `--ease-spring` | cubic-bezier(0.34, 1.56, 0.64, 1) | Playful entrances, success states |
| `--ease-bounce` | cubic-bezier(0.68, -0.55, 0.27, 1.55) | Very playful — use rarely |

### Animation utility classes

| Class | Effect |
|---|---|
| `.mc-fade-up` | Enter: fade in + translate 6px up |
| `.mc-fade-up-stagger` | Same but staggered — pair with `style={{ "--index": N }}` |
| `.mc-tab-enter` | Tab panel entrance animation |
| `.mc-shake` | Horizontal shake (0.4s) — for validation errors |
| `.mc-live-dot` | Pulsing dot (2s loop) — for active/running indicators |
| `.mc-toast-enter` / `.mc-toast-exit` | Toast notification enter/exit |
| `.mc-skeleton` | Shimmer loading animation |

---

## Radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 4px | Badges, small chips, tight elements |
| `--radius-md` | 6px | Default — inputs, buttons, most elements |
| `--radius-lg` | 8px | Cards, containers |
| `--radius-2xl` | 12px | Mid-size panels |
| `--radius-xl` | 16px | Dialogs, drawers |
| `--radius-full` | 9999px | Pills, avatar circles |

---

## Z-Index

| Token | Value | Use |
|---|---|---|
| `--z-base` | 0 | Default stacking context |
| `--z-dropdown` | 40 | Dropdowns, select menus |
| `--z-sticky` | 45 | Sticky table headers, sticky nav |
| `--z-modal` | 50 | Modals, dialogs, drawers |
| `--z-tooltip` | 60 | Tooltips |
| `--z-toast` | 70 | Toast notifications |
| `--z-max` | 100 | Emergency top-of-stack |

---

## Icons & Layout

### Icon sizes
| Token | Value | Use |
|---|---|---|
| `--icon-xs` | 12px | Tiny inline icons |
| `--icon-sm` | 14px | Small button icons |
| `--icon-md` | 16px | Default icon size |
| `--icon-lg` | 20px | Prominent icons, section icons |
| `--icon-xl` | 24px | Large icons, empty state icons |

**Icon library:** Lucide React only. No other icon libraries.

### Layout constants
| Token | Value | Use |
|---|---|---|
| `--app-header-height` | 40px | Workspace chrome height |
| `--sidebar-width` | 200px | Expanded sidebar |
| `--sidebar-width-collapsed` | 48px | Collapsed icon-only rail |

---

## Focus & Interactive

| Token | Use |
|---|---|
| `--focus-ring` | Applied automatically via `:focus-visible` — 2px base + 4px blue ring |
| `--focus-ring-inset` | For form fields — inset blue outline |

No need to apply manually — global CSS handles it.

---

## Semantic Utility Classes (globals.css)

These combine multiple tokens into common patterns. Use them instead of re-implementing:

| Class | Description |
|---|---|
| `.mc-surface` | Card gradient + default border + sm shadow |
| `.mc-elevated` | Modal/dropdown gradient + lg shadow |
| `.mc-elevated-bordered` | Elevated + explicit border |
| `.mc-input` | Form field: inset shadow + focus-visible border ring |
| `.mc-btn-primary` | Blue filled button style |
| `.mc-btn-secondary` | Subtle surface button style |
| `.mc-btn-brand` | Orange filled button (upgrade CTAs) |
| `.mc-btn-danger` | Red filled button |
| `.mc-row-hover` | Interactive row: hover background + cursor pointer |
| `.depth-card` | Card depth: md shadow + gradient + border |
| `.depth-elevated` | Elevated depth: lg shadow + gradient + border |