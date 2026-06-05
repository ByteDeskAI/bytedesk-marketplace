# Atlassian Design System — Complete Reference for Claude

This file is the authoritative design specification for the `project-management` plugin dashboard. Every component, token, and pattern choice in `dashboard/src/` must conform to the Atlassian Design System (ADS) documented here. Do not visit the website unless you need to confirm something not covered here — this file should be sufficient for all dashboard work.

**Site:** https://atlassian.design  
**Tokens package:** `@atlaskit/tokens` — call `setGlobalTheme({ colorMode: 'dark' })` once at app root to inject all `--ds-*` CSS custom properties.

---

## CRITICAL: Plugin Isolation Rules

> **This plugin (`project-management/`) is fully self-contained. It must NEVER reference, import from, depend on, or call into any sibling directory in this repository that is not `project-management/` itself.**

### The Rule

When working inside `project-management/`, treat every other top-level directory in this repo as if it does not exist. This includes — but is not limited to — every other plugin, tool, script, or shared library that lives alongside this directory. The boundary is absolute.

**Allowed:**
- Anything inside `project-management/` (lib, dashboard, skills, hooks, monitors, tests)
- Standard Python stdlib and pip packages listed in the plugin's own requirements
- npm packages listed in `project-management/dashboard/package.json`
- The Claude Code plugin manifest contract (`CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`)

**Forbidden:**
- Importing or `sys.path`-inserting from any sibling directory
- Shell commands that invoke binaries owned by another plugin
- Referencing environment variables, file paths, or APIs introduced by another plugin
- Copying or adapting code from another plugin's `lib/`, `bin/`, `hooks/`, or `skills/` — even if the pattern looks useful
- Calling another plugin's MCP server tools or HTTP endpoints from dashboard code or backend code

### CRITICAL: Never Use Atlassian/Jira MCP Tools for Project Management

> **This plugin IS the project management layer. Never delegate PM work to Atlassian's cloud services.**

When a Claude Code session is spawned from the dashboard (e.g., to implement a ticket or run a planning session), it may have access to the Atlassian MCP server (`mcp__atlassian__*` tools). **These tools must never be used for creating, updating, or querying issues, docs, or sprints.**

The `mcp__atlassian__*` tools connect to a user's Atlassian cloud account (Jira, Confluence). This plugin stores all project data locally in SQLite (`.pm/pm.db`). Using the Atlassian MCP would:
- Create issues in the wrong system (a cloud Jira project, not the local `.pm/` database)
- Require Atlassian credentials the user may not have configured
- Bypass the pm_* MCP tools that update the dashboard in real time
- Confuse users who are using this plugin specifically to avoid Atlassian cloud dependencies

**Always use the pm_* MCP tools instead:**

| Instead of | Use |
|-----------|-----|
| `mcp__atlassian__createJiraIssue` | `pm_issue_create` |
| `mcp__atlassian__editJiraIssue` | `pm_issue_update` |
| `mcp__atlassian__getJiraIssue` | `pm_issue_get` |
| `mcp__atlassian__searchJiraIssuesUsingJql` | `pm_issue_list` |
| `mcp__atlassian__createConfluencePage` | `pm_doc_create` |
| `mcp__atlassian__updateConfluencePage` | `pm_doc_update` |
| `mcp__atlassian__getConfluencePage` | `pm_doc_get` |
| `mcp__atlassian__search` | `pm_search` |

If you are in a session started from the PM dashboard and you find yourself reaching for an `mcp__atlassian__*` tool to create or manage a ticket/doc — **stop**. Use `pm_issue_create`, `pm_doc_create`, etc. instead. The `.pm/pm.db` file in the working directory is the local project database; the pm_* tools read and write it directly.

### Why This Matters

Claude Code sessions have visibility into the entire repository. When working on a feature, it is tempting to reach for a pattern, binary, or API from a neighboring plugin because it is visible in the file tree. **That is always wrong.** Every plugin in this marketplace is an independently installable unit. A user who installs only `project-management` has none of the other plugins present. Any cross-plugin dependency would silently break their installation.

If you find yourself looking at another directory for inspiration, patterns, or utilities while working on `project-management/` — stop. The solution must live entirely within `project-management/`. If something genuinely needs to be shared, it belongs in a new shared library, not in a cross-plugin import.

### What This Plugin Owns

The complete surface area of this plugin — everything it is allowed to touch:

```
project-management/
  bin/           ← launchers (pm-mcp, pm-dashboard)
  dashboard/     ← React SPA (Vite + @atlaskit); all frontend code
  hooks/         ← PostToolUse bash hooks for this plugin only
  lib/           ← Python MCP server, SQLite/Postgres backends, dashboard server
  monitors/      ← pm-dashboard lifecycle monitor
  skills/        ← /pm:* Claude Code skills
  tests/         ← unit, contract, and dashboard smoke tests
  CHANGELOG.md
  CLAUDE.md      ← this file
  README.md
  .claude-plugin/plugin.json
  .mcp.json
```

Nothing outside this tree is within scope.

---

## 1. Design System Overview & Philosophy

The Atlassian Design System is a unified design language for Atlassian products (Jira, Confluence, Bitbucket, etc.). Its purpose: ensure visual and behavioral consistency across all surfaces. For this plugin, it provides:

- **Design tokens** — semantic CSS custom properties that resolve to correct values for light/dark themes
- **React components** — pre-built, accessible, theme-aware UI building blocks
- **Foundations** — rules for color, spacing, typography, motion, etc.

### Component Status Labels

Every `@atlaskit` component has one of these statuses. Never ignore them.

| Status | Meaning | Use in production? |
|--------|---------|-------------------|
| (no label) | Stable | Yes |
| **Beta** | Early access, may change API | Yes, but expect updates |
| **Caution** | Known issues, nearing deprecation | Avoid for new features |
| **Early Access** | Very new, limited availability | Evaluate carefully |
| **(Deprecated)** | No longer supported | Never — use listed alternative |

---

## 2. Design Token System

All visual values in the dashboard must use design tokens, not hardcoded CSS values. Tokens are CSS custom properties prefixed `--ds-`.

### How Tokens Work

```tsx
import { setGlobalTheme } from '@atlaskit/tokens';
// Applied once in main.tsx — injects all --ds-* into :root
setGlobalTheme({ colorMode: 'dark' });
```

In CSS/inline styles: use `var(--ds-[token-name])`.

### Token Naming Convention

```
color.[property].[role].[emphasis].[state]
  Examples:
    color.background.danger.bold.hovered
    color.text.subtlest
    color.border.selected

space.[multiplier]
  Examples:
    space.100   → 8px
    space.200   → 16px
    space.300   → 24px

font.[category].[size]
  Examples:
    font.heading.large
    font.body
    font.code

border.width                → 1px
border.width.selected       → 2px
border.width.focused        → 2px

radius.[size]               → element border-radius
radius.focus.[size]         → focus ring radius (element radius + 2px)

elevation.surface.[level]   → background color for elevation
elevation.shadow.[level]    → box-shadow for elevation

motion.[context].[action]   → animation shorthand
```

**Reference:** https://atlassian.design/tokens/all-tokens

### Key --ds-* Variable Reference (CSS property names after setGlobalTheme)

```css
/* Surfaces / Backgrounds */
--ds-surface               /* Main page background */
--ds-surface-raised        /* Cards, elevated content */
--ds-surface-sunken        /* Kanban columns, content wells */
--ds-surface-overlay       /* Modals, dropdowns, drawers */
--ds-background-neutral    /* Subtle background on surfaces (transparent) */
--ds-background-neutral-hovered
--ds-background-neutral-bold          /* Strong neutral fill */
--ds-background-brand-bold            /* Primary action fill (Jira blue) */
--ds-background-brand-bold-hovered
--ds-background-brand-bold-pressed
--ds-background-selected              /* Selected state background */
--ds-background-input                 /* Input field background */
--ds-background-danger-bold           /* Red fill for errors/danger */
--ds-background-warning-bold          /* Amber fill for warnings */
--ds-background-success-bold          /* Green fill for success */
--ds-background-discovery-bold        /* Purple fill for new features */
--ds-background-information-bold      /* Blue fill for information */
--ds-background-danger                /* Subtle danger tint */
--ds-background-warning               /* Subtle warning tint */
--ds-background-success               /* Subtle success tint */
--ds-background-discovery             /* Subtle discovery tint */
--ds-background-information           /* Subtle information tint */

/* Text */
--ds-text                  /* Primary text */
--ds-text-subtle           /* Secondary / muted text */
--ds-text-subtlest         /* Tertiary / placeholder text */
--ds-text-disabled         /* Disabled state text */
--ds-text-inverse          /* Text on bold/colored backgrounds */
--ds-text-selected         /* Selected item text */
--ds-text-brand            /* Brand-colored text */
--ds-text-danger           /* Error text */
--ds-text-warning          /* Warning text */
--ds-text-success          /* Success text */
--ds-text-discovery        /* Discovery/feature text */
--ds-text-information      /* Informational text */
--ds-link                  /* Hyperlink color */
--ds-link-pressed          /* Pressed hyperlink */

/* Borders */
--ds-border                /* Standard border */
--ds-border-bold           /* Stronger border emphasis */
--ds-border-selected       /* Selected element border (2px) */
--ds-border-focused        /* Focus ring border (2px) */
--ds-border-input          /* Input field border */
--ds-border-disabled       /* Disabled element border */
--ds-border-danger         /* Error state border */
--ds-border-warning        /* Warning state border */
--ds-border-success        /* Success state border */
--ds-border-discovery      /* Discovery state border */
--ds-border-information    /* Information state border */

/* Icons */
--ds-icon                  /* Default icon color */
--ds-icon-subtle           /* Muted icon */
--ds-icon-inverse          /* Icon on colored backgrounds */
--ds-icon-disabled         /* Disabled icon */
--ds-icon-danger           /* Error icon */
--ds-icon-warning          /* Warning icon */
--ds-icon-success          /* Success icon */
--ds-icon-discovery        /* Discovery icon */
--ds-icon-information      /* Information icon */
--ds-icon-selected         /* Selected state icon */
--ds-icon-brand            /* Brand-colored icon */

/* Shadows */
--ds-shadow-raised         /* Box shadow for raised elevation */
--ds-shadow-overlay        /* Box shadow for overlay elevation */
--ds-shadow-overflow       /* Scroll boundary indicator */
```

---

## 3. Color Foundation

**Reference:** https://atlassian.design/foundations/color

### Color Roles (Semantic Meanings)

| Role | Meaning | Example use |
|------|---------|-------------|
| `neutral` | Default UI chrome, secondary content | Text, borders, backgrounds |
| `brand` | Atlassian identity, primary actions | Primary buttons, selected state |
| `information` | In-progress, informational | Progress indicators, info messages |
| `success` | Favorable outcomes, done states | "Done" badge, success messages |
| `warning` | Caution, potential errors | Warning banners, amber highlights |
| `danger` | Serious errors, destructive actions | Error messages, delete confirmations |
| `discovery` | New features, onboarding | Feature highlights, beta badges |
| `accent` | Meaning-agnostic decoration | Color coding, labels, charts |
| `inverse` | Elements on bold backgrounds | Text on primary buttons |
| `input` | Form field states | Input backgrounds, borders |

### Emphasis Levels

Each role has multiple emphasis levels. Use the least emphatic option that communicates the meaning:

```
subtlest → subtle → default → bold
```

Examples:
- `color.background.danger` (subtle tint) vs `color.background.danger.bold` (strong red fill)
- `color.text.subtle` (muted) vs `color.text` (full contrast)

### Interaction States

Append state to token names:

```
color.background.brand.bold          → default
color.background.brand.bold.hovered  → hover state
color.background.brand.bold.pressed  → pressed/active state
```

All states: `hovered`, `pressed`, `selected`, `focused`, `disabled`

### Theming

Same token name resolves to different hex values in light vs dark mode. **Never write conditional theme logic** — just use the token and `setGlobalTheme` handles it.

### Accent Color Palette

When you need color without semantic meaning (e.g., labels, category coding):

```
color.background.accent.[hue].[emphasis]
color.text.accent.[hue]
color.border.accent.[hue]
```

Available hues: `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `magenta`, `lime`

---

## 4. Typography Foundation

**Reference:** https://atlassian.design/foundations/typography

### Font Families

| Family | Use case | Note |
|--------|---------|------|
| **Atlassian Sans** | All product UI text | Default app font |
| **Atlassian Mono** | Code, technical content | Monospace |
| **Charlie Sans** | Marketing/brand only | **NEVER use in product UI** |

### Heading Token Scale

| Token | Size | Line Height | Weight |
|-------|------|-------------|--------|
| `font.heading.xxlarge` | 32px | 36px | Bold (700) |
| `font.heading.xlarge` | 28px | 32px | Bold (700) |
| `font.heading.large` | 24px | 28px | Bold (700) |
| `font.heading.medium` | 20px | 24px | Bold (700) |
| `font.heading.small` | 16px | 20px | Bold (700) |
| `font.heading.xsmall` | 14px | 20px | Bold (700) |
| `font.heading.xxsmall` | 12px | 16px | Bold (700) |

### Body Token Scale

| Token | Size | Line Height | Paragraph Spacing | Weight options |
|-------|------|-------------|-------------------|----------------|
| `font.body.large` | 16px | 24px | 16px | Regular / Medium / Bold |
| `font.body` | 14px | 20px | 12px | Regular / Medium / Bold |
| `font.body.small` | 12px | 16px | 8px | Regular / Medium / Bold |

### Metric Tokens (Bold numerals for data display)

| Token | Size | Line Height |
|-------|------|-------------|
| `font.metric.large` | 28px | 32px |
| `font.metric.medium` | 24px | 28px |
| `font.metric.small` | 16px | 20px |

### Code Token

| Token | Size | Line Height |
|-------|------|-------------|
| `font.code` | 12px | 20px |

### Rules

- All sizes are in `rem` (relative to 16px default root)
- **Do not hardcode font sizes** — use the token scale
- The `Heading` component (Beta) and `Text` component (Beta) apply these tokens automatically
- Body text default: `font.body` (14px)
- Never use Charlie Sans in app UI — it is marketing-only

---

## 5. Spacing Foundation

**Reference:** https://atlassian.design/foundations/spacing

### Base Unit

**8px** is the base unit (`space.100`). All spacing should be multiples of 4px at minimum, ideally multiples of 8px.

### Complete Token Scale

| Token | Pixels | Token | Pixels |
|-------|--------|-------|--------|
| `space.0` | 0px | `space.400` | 32px |
| `space.025` | 2px | `space.500` | 40px |
| `space.050` | 4px | `space.600` | 48px |
| `space.075` | 6px | `space.800` | 64px |
| `space.100` | 8px | `space.1000` | 80px |
| `space.150` | 12px | `space.negative.025` | -2px |
| `space.200` | 16px | `space.negative.050` | -4px |
| `space.250` | 20px | `space.negative.075` | -6px |
| `space.300` | 24px | `space.negative.100` | -8px |

### Usage Ranges

| Range | Tokens | Use for |
|-------|--------|---------|
| Small (0–8px) | `space.0` – `space.100` | Icon/text gaps, badge padding, button groups, input padding |
| Medium (12–24px) | `space.150` – `space.300` | Button padding, avatar-to-content, card gaps, form field spacing |
| Large (32–80px) | `space.400` – `space.1000` | Page layout margins, section headers, large content alignment |

### Layout Principles

1. **Group by similarity** — consistent spacing signals semantic relationships
2. **Group by proximity** — closer = more related; use spacing to show hierarchy
3. **Create hierarchy** — vary whitespace to establish visual rank
4. **Visual rhythm** — alternating elements and space create scanning patterns
5. **Optical adjustment** — minor tweaks for true visual balance (not always mathematically equal)

---

## 6. Iconography Foundation

**Reference:** https://atlassian.design/foundations/iconography  
**Component docs:** https://atlassian.design/components/icon

### Visual Style

- **Stroke width:** 1.5px
- **Corners:** Rounded outer corners, sharp interior angles
- **End caps:** Squared (not rounded)
- Profile: straight-on or full 90° — no diagonal 3D perspective

### Size Options

| Size | Dimensions | When to use |
|------|-----------|-------------|
| Medium | 16×16px | **Default** — most use cases |
| Small | 12×12px | Chevrons, validation indicators, compact elements, secondary actions |

### Import Pattern

```tsx
import BoardIcon from '@atlaskit/icon/glyph/board';
import ListIcon from '@atlaskit/icon/glyph/list';
import DocumentsIcon from '@atlaskit/icon/glyph/documents';
import RecentIcon from '@atlaskit/icon/glyph/recent';
import ChevronRightIcon from '@atlaskit/icon/glyph/chevron-right';
import ChevronDownIcon from '@atlaskit/icon/glyph/chevron-down';

// Usage:
<BoardIcon label="Board" size="medium" />
<ListIcon label="" size="small" />  // label="" for decorative icons
```

### Design Rules

1. **Universal understanding** — use recognized symbols; avoid culture-specific metaphors
2. **Simplicity** — quick recognition over detail
3. **Visual harmony** — consistent size/style across the set
4. **Intentional use** — supplement with text labels wherever possible; never rely on icon alone for meaning
5. **Color** — use `--ds-icon` or `--ds-text` tokens; check contrast

### Available Icon Glyphs (selected)

```
board, list, documents, recent, activity, chevron-right, chevron-down,
chevron-up, chevron-left, add, edit, trash, check, cross, search,
settings, notification, home, folder, page, code, comment, attachment,
label, flag, star, user, team, lock, unlock, link, external-link,
arrow-up, arrow-down, warning, error, info, success, filter, sort
```

Full list: browse `node_modules/@atlaskit/icon/glyph/`

---

## 7. Border Foundation

**Reference:** https://atlassian.design/foundations/border

### Border Width Tokens

| Token | Value | Use case |
|-------|-------|----------|
| `border.width` | 1px | Standard component borders, dividers |
| `border.width.selected` | 2px | Selected elements (active tabs, chosen items) |
| `border.width.focused` | 2px | Focus ring on interactive elements |

### Required Pairings

**Always** pair width tokens with their corresponding color token:

| Width token | Color token | Purpose |
|-------------|-------------|---------|
| `border.width.selected` | `color.border.selected` | Selected state |
| `border.width.focused` | `color.border.focused` | Keyboard focus ring |

### Border Radius Scale

| Token | Value | Use case |
|-------|-------|----------|
| `radius.xsmall` | 2px | Badges, checkboxes, avatar labels, kbd shortcuts |
| `radius.small` | 4px | Lozenges, tooltips, tags, compact buttons |
| `radius.medium` | 6px | Buttons, inputs, selects, navigation items |
| `radius.large` | 8px | Cards, dropdowns, floating UI |
| `radius.xlarge` | 12px | Modals, tables, Kanban columns |
| `radius.xxlarge` | 16px | Large panels, video players |
| `radius.full` | 999px | Avatars, pills, user-related circular UI |

### Focus Ring System

The focus ring is applied 2px outside the element:

| Element radius | Focus ring radius |
|----------------|------------------|
| `radius.xsmall` (2px) | `radius.focus.xsmall` (4px) |
| `radius.small` (4px) | `radius.focus.small` (6px) |
| `radius.medium` (6px) | `radius.focus.medium` (8px) |
| `radius.large` (8px) | `radius.focus.large` (10px) |
| `radius.xlarge` (12px) | `radius.focus.xlarge` (14px) |
| `radius.xxlarge` (16px) | `radius.focus.xxlarge` (18px) |

**Code:** Focus rings are automatically applied by the `Focusable` primitive and all interactive components. You rarely need to implement them manually.

### Accessibility

- Accent border colors must meet **3:1 contrast** against subtle backgrounds
- Use `color.border.focused` for focus rings (never omit or custom-color focus indicators)

---

## 8. Elevation & Shadow Foundation

**Reference:** https://atlassian.design/foundations/elevation

### Four Elevation Levels

| Level | Surface Token | Shadow Token | Use case |
|-------|--------------|--------------|----------|
| **Sunken** | `elevation.surface.sunken` | none | Kanban columns, content wells, backgrounds below default |
| **Default** | `elevation.surface` | none | Main page surface, flat cards |
| **Raised** | `elevation.surface.raised` | `elevation.shadow.raised` | Movable cards (drag-and-drop), list items |
| **Overlay** | `elevation.surface.overlay` | `elevation.shadow.overlay` | Modals, dropdowns, drawers, tooltips, floating toolbars |

### Rules

1. **Always pair** matching surface + shadow tokens (raised surface must have raised shadow)
2. Sunken elevation only appears on top of **default** surfaces — never sunken-inside-sunken
3. `elevation.surface.sunken` is **opaque** (solid color); `color.background.neutral` is **transparent** (overlay) — they look similar but behave differently in stacking contexts
4. Avoid stacking too many raised/overlay elements — creates visual noise

### Dark Mode Behavior

Shadows are less visible in dark mode. The design system compensates:
- **Raised** surfaces become slightly lighter than default
- **Overlay** surfaces become lighter still
- Shadows still applied for consistency even if subtle

### Interaction States for Surfaces

**Background-change approach** (preferred):
```css
elevation.surface.[level].hovered
elevation.surface.[level].pressed
```

**Elevation-change approach** (use sparingly — creates animation):
- Hover → overlay elevation
- Press → raised elevation
- Dragged → always overlay; return to original on drop

### Z-Index Reference

| Z-index | Component | Level |
|---------|-----------|-------|
| 200 | Atlassian Navigation | Default |
| 300 | Inline Dialog | Overlay |
| 400 | Popup | Overlay |
| 510 | Modal Dialog | Overlay |
| 600 | Flag | Overlay |
| 700 | Spotlight | Overlay |
| 800 | Tooltip | Overlay |

---

## 9. Motion Foundation

**Reference:** https://atlassian.design/foundations/motion

### Core Principles

1. **Human** — organic, subtle, rhythmic. Motion feels natural, not mechanical
2. **Clarity** — every animation clarifies the interface; never decorative
3. **Accessible** — always honors `prefers-reduced-motion` (animations become instant)
4. **Performant** — reinforces speed; motion should feel fast and responsive

### Duration Ranges

| Category | Range | Use case |
|----------|-------|----------|
| Micro-interactions | 50–150ms | Hover states, pressed states, focus rings |
| Transitions | 150–400ms | Panel opens, modal appears, spatial navigation |

**Rules:**
- Small elements → under 150ms
- Large elements → allow more time (up to 400ms)
- High-frequency interactions → near-instant (50–100ms)
- Exit transitions → always faster than entrance

### Easing Curves

| Name | Value | Best for |
|------|-------|----------|
| Ease-out bold | `cubic-bezier(0, 0.4, 0, 1)` | **Entering** — Panel opens, Flag appears |
| Ease-in-out bold | `cubic-bezier(0.4, 0, 0, 1)` | Scaling, repositioning, spatial changes |
| Ease-in practical | `cubic-bezier(0.6, 0, 0.8, 0.6)` | **Exiting** — Panel closes, element disappears |
| Ease-out practical | `cubic-bezier(0.4, 1, 0.6, 1)` | Popup appears, hover fade-in |

### Motion Properties

- **Fade** — opacity change (most common; safe for all contexts)
- **Scale** — size growth/shrink (use for appearing/disappearing elements)
- **Slide** — X/Y axis movement (use for panels, drawers, spatial navigation)
- **Color** — background/border transition on hover/press

### Rules

- Start motion **immediately** on interaction — zero delay
- Multiple simultaneous animations split attention — **lead with one focal point**
- Reserve expressive/complex motion for low-frequency brand moments (celebrations, first-time experiences)
- With `prefers-reduced-motion`: skip all transitions; state changes become instant

---

## 10. Accessibility Foundation

**Reference:** https://atlassian.design/foundations/accessibility

### Contrast Requirements

| Content type | Minimum contrast ratio | Standard |
|-------------|----------------------|---------|
| Body text | **4.5:1** | WCAG 1.4.3 AA |
| Large text (18pt+ / 14pt+ bold) | **3:1** | WCAG 1.4.3 AA |
| Graphics & interactive components | **3:1** | WCAG 1.4.11 |

All `--ds-*` token combinations are pre-validated for these requirements in their intended pairings.

### Semantic HTML Requirements

Always use meaningful HTML elements:
```html
<header>, <nav>, <main>, <footer>, <article>, <section>, <aside>
<h1>–<h6>  (use heading hierarchy, never skip levels)
<button>   (for actions), <a>  (for navigation)
<ul>/<ol>  (for lists), <table> (for tabular data)
```

### Keyboard Navigation

- All interactive elements must be reachable via Tab
- Action elements must respond to Enter/Space
- Menu items: Arrow keys for navigation
- Modals: Trap focus inside; Escape closes
- Focus visible at all times — never `outline: none` without alternative

### Disability Categories to Design For

| Category | Requirements |
|----------|-------------|
| Visual | Screen reader support, sufficient contrast, zoom support (up to 400%) |
| Motor | Keyboard-only operation, no time limits, drag alternatives |
| Cognitive | Plain language (reading age 12–14), chunked content, no jargon |
| Auditory | Captions for video, transcripts for audio |

### Reduced Motion

All ADS motion tokens respect `prefers-reduced-motion`. When building custom animations:

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
}
```

---

## 11. Illustrations Foundation

**Reference:** https://atlassian.design/foundations/illustrations

### Three Types

| Type | Purpose | When |
|------|---------|------|
| **Spot** | Single concept — empty/error states, celebrations | Empty boards, success confirmations |
| **Low-fidelity UI** | Onboarding, feature tours, workflow explanation | First-run experiences |
| **Ambient Pattern** | Background texture, brand personality | Large decorative sections |

### Rules

- **Never** use real screenshots inside UI (confusing screen-within-screen effect)
- Low-fi UI: basic shapes, sharp corners, mostly gray — never detailed
- Avoid purely decorative illustrations that add no information
- Spot illustrations: colorful for celebrations, neutral for common tasks

---

## 12. Component Inventory

**Reference:** https://atlassian.design/components/overview

Status: blank = Stable, **Beta**, ⚠ Caution, *(Deprecated)*

### Forms & Input

| Component | Package | Key variants | Notes |
|-----------|---------|-------------|-------|
| Button | `@atlaskit/button` | Primary, Default, Subtle, Warning, Danger, Discovery, Link; Split Button | Most-used action component |
| Calendar | `@atlaskit/calendar` | | Date display/selection |
| Checkbox | `@atlaskit/checkbox` | Checkbox, CheckboxSelect | Use `isChecked`, `onChange`, `label` |
| Comment | `@atlaskit/comment` | CommentAuthor, CommentTime, CommentAction | Thread-style comments |
| DateTime Picker | `@atlaskit/datetime-picker` | DatePicker, TimePicker, DateTimePicker | |
| Dropdown Menu | `@atlaskit/dropdown-menu` | DropdownItem, DropdownItemGroup, DropdownItemCheckbox, DropdownItemRadio | ⚠ Caution |
| Focus Ring | `@atlaskit/focus-ring` | | Apply to custom interactive elements |
| Form | `@atlaskit/form` | Field, FormFooter, FormHeader, FormSection, FormError | ⚠ Caution |
| Radio | `@atlaskit/radio` | Radio, RadioGroup | Use `RadioGroup` with options array |
| Range | `@atlaskit/range` | | Slider input |
| Select | `@atlaskit/select` | Async, AsyncCreatable, Checkbox, Country, Creatable, Popup, Radio | Many variants |
| Text Area | `@atlaskit/textarea` | | Multi-line input |
| Textfield | `@atlaskit/textfield` | | Single-line input |
| Toggle | `@atlaskit/toggle` | | `isChecked`, `onChange`, `size` (regular/large) |

### Images & Icons

| Component | Package | Notes |
|-----------|---------|-------|
| Avatar | `@atlaskit/avatar` | Sizes: xsmall/small/medium/large/xlarge |
| Avatar Group | `@atlaskit/avatar-group` | `appearance` (stack/grid), `maxCount` |
| Icon | **Beta** `@atlaskit/icon` | Import from `/glyph/[name]`, label="" for decorative |
| Logo | `@atlaskit/logo` | Attribution, Property, Strapline variants |

### Labels

| Component | Package | Key variants | Notes |
|-----------|---------|-------------|-------|
| Badge | `@atlaskit/badge` | Numeric | appearance: primary/added/important/default |
| Lozenge | **Beta** `@atlaskit/lozenge` | Standard appearances | Display-only status indicator, NOT interactive |
| Tag | `@atlaskit/tag` | Tag, SimpleTag, Avatar Tag (Beta) | `TagGroup` for collections |
| Tag Group | `@atlaskit/tag-group` | | Wrapping container for Tags |

**Lozenge appearances:**

| Appearance | Visual | Semantic meaning |
|-----------|--------|-----------------|
| `default` | Gray | Neutral/new items |
| `success` | Green | Done, positive, complete |
| `removed` | Red | Errors, bugs, removed |
| `inprogress` | Blue | Active, in-progress |
| `moved` | Yellow/amber | Changed, warning, review |
| `new` | Purple | New features, discovery |

### Layout & Structure

| Component | Package | Notes |
|-----------|---------|-------|
| Page | ⚠ Caution `@atlaskit/page` | Avoid for new features |
| Page Header | `@atlaskit/page-header` | Consistent page titles with actions |

### Loading

| Component | Package | When to use |
|-----------|---------|-------------|
| Progress Bar | `@atlaskit/progress-bar` | Known duration or percentage; `value` 0–1 |
| Skeleton | Early Access `@atlaskit/skeleton` | **Preferred** when shape is known |
| Spinner | `@atlaskit/spinner` | Unknown duration; fallback loading |

### Messaging

| Component | Package | Key variants | Notes |
|-----------|---------|-------------|-------|
| Banner | `@atlaskit/banner` | | Top-of-screen prominent message |
| Empty State | `@atlaskit/empty-state` | | header + description + primaryAction + secondaryAction |
| Flag | `@atlaskit/flag` | Flag, AutoDismissFlag, FlagGroup | Transient confirmations/alerts |
| Inline Message | `@atlaskit/inline-message` | | Field-level feedback; appearances: info/error/warning/success |
| Modal Dialog | `@atlaskit/modal-dialog` | ModalHeader, ModalTitle, ModalBody, ModalFooter | Requires explicit user action to dismiss |
| Section Message | `@atlaskit/section-message` | | In-content messaging; appearances: info/success/warning/error/discovery |
| Spotlight | **Beta** `@atlaskit/onboarding` | SpotlightManager, SpotlightTarget, Spotlight | Onboarding tours |

### Navigation

| Component | Package | Notes |
|-----------|---------|-------|
| Breadcrumbs | `@atlaskit/breadcrumbs` | `BreadcrumbsItem` with `href` or `onClick` |
| Link | `@atlaskit/link` | Prefer over raw `<a>` for consistent styling |
| Menu | `@atlaskit/menu` | MenuGroup, MenuItem, MenuItemCheckbox |
| Navigation System | `@atlaskit/atlassian-navigation` | Full top nav — complex setup |
| Pagination | `@atlaskit/pagination` | `pages`, `selectedIndex`, `onChange` |
| Tabs | `@atlaskit/tabs` | Tab, TabList, TabPanel — **requires `id` prop** |

### Overlays & Layering

| Component | Package | Notes |
|-----------|---------|-------|
| Blanket | `@atlaskit/blanket` | Modal backdrop; `isTinted` prop |
| Drawer | ⚠ Caution `@atlaskit/drawer` | **Deprecation planned** — incompatible with new Nav; prefer Modal |
| Inline Dialog | ⚠ Caution `@atlaskit/inline-dialog` | `isOpen`, `content`, `placement` |
| Popup | ⚠ Caution `@atlaskit/popup` | `trigger` render prop, `content`, `isOpen`, `placement` |
| Tooltip | `@atlaskit/tooltip` | Trigger: hover + focus; `position`; `delay`; `content` |

### Primitives (Layout building blocks)

| Component | Package | Notes |
|-----------|---------|-------|
| Box | `@atlaskit/primitives` | Token-based div; padding/background via token props |
| Stack | `@atlaskit/primitives` | Vertical flex stack |
| Inline | `@atlaskit/primitives` | Horizontal flex row |
| Flex | **Beta** `@atlaskit/primitives` | Full flex control |
| Grid | **Beta** `@atlaskit/primitives` | CSS Grid wrapper |
| Focusable | `@atlaskit/primitives` | Wraps elements needing focus ring |
| Text | **Beta** `@atlaskit/primitives` | Typography token-based text |
| Pressable | `@atlaskit/primitives` | Token-based button primitive |
| XCSS | ⚠ Caution `@atlaskit/primitives` | Type-safe CSS — avoid for new code |

### Status Indicators

| Component | Package | Notes |
|-----------|---------|-------|
| Progress Indicator | `@atlaskit/progress-indicator` | Dot-based step indicator |
| Progress Tracker | `@atlaskit/progress-tracker` | Step-by-step process; `stages` array |

### Text & Data Display

| Component | Package | Notes |
|-----------|---------|-------|
| Code | `@atlaskit/code` | `Code` (inline) and `CodeBlock` (fenced); syntax highlighting |
| Dynamic Table | `@atlaskit/dynamic-table` | Sortable, paginated; use instead of deprecated Table |
| Heading | **Beta** `@atlaskit/heading` | Semantic headings with typography tokens |
| Inline Edit | `@atlaskit/inline-edit` | `editView`, `readView`, `onConfirm`, `defaultValue` |
| Table | ⚠ Caution `@atlaskit/table` | **Do not use** — use Dynamic Table |
| Table Tree | `@atlaskit/table-tree` | Hierarchical expandable tree table |
| Visually Hidden | `@atlaskit/visually-hidden` | Screen-reader-only text |

### Libraries

| Library | Package | Notes |
|---------|---------|-------|
| Design Tokens | `@atlaskit/tokens` | `setGlobalTheme`, `token()` fn |
| Pragmatic DnD | `@atlaskit/pragmatic-drag-and-drop` | Jira-grade drag-and-drop |
| Motion | `@atlaskit/motion` | Animation tokens and utilities |
| Portal | `@atlaskit/portal` | Render outside DOM hierarchy |
| Popper | `@atlaskit/popper` | Positioning for overlays |

### Deprecated — Never Use

| Component | Use instead |
|-----------|------------|
| `@atlaskit/atlassian-navigation` | Navigation System |
| `@atlaskit/icon-object` | Icon (Beta) |
| `@atlaskit/layout-grid` | Grid (Beta) from primitives |
| `@atlaskit/onboarding` (old) | Spotlight (Beta) |
| `@atlaskit/page-layout` | Flexbox/Grid layout |
| `@atlaskit/side-navigation` | Build custom with primitives |

---

## 13. Key Component Specifications

### Button

```tsx
import Button, { SplitButton } from '@atlaskit/button';

// Appearances:
<Button appearance="primary">Save</Button>       // Blue — primary action
<Button appearance="default">Cancel</Button>     // Gray — secondary action
<Button appearance="subtle">Learn more</Button>  // No background
<Button appearance="warning">Reset</Button>      // Amber
<Button appearance="danger">Delete</Button>      // Red
<Button appearance="discovery">Try beta</Button> // Purple
<Button appearance="link">Link</Button>          // Link style

// Spacing:
<Button spacing="default" />   // Standard padding
<Button spacing="compact" />   // Tighter padding
<Button spacing="none" />      // No padding (icon-only)

// States:
<Button isDisabled />
<Button isLoading />  // Shows spinner

// With icon:
import AddIcon from '@atlaskit/icon/glyph/add';
<Button iconBefore={<AddIcon label="" />}>Create</Button>
<Button iconAfter={<ChevronDownIcon label="" />}>Actions</Button>
```

### Modal Dialog

```tsx
import ModalDialog, { ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@atlaskit/modal-dialog';

// Use over Drawer for: forms, confirmations, focused tasks
// Do NOT use for: notifications (use Flag), tooltips, contextual overlays (use Popup)
<ModalDialog onClose={onClose} width="medium">
  <ModalHeader><ModalTitle>Delete issue</ModalTitle></ModalHeader>
  <ModalBody>This action cannot be undone.</ModalBody>
  <ModalFooter>
    <Button appearance="subtle" onClick={onClose}>Cancel</Button>
    <Button appearance="danger" onClick={handleDelete}>Delete</Button>
  </ModalFooter>
</ModalDialog>

// Width options: 'small' | 'medium' | 'large' | 'x-large' | number (px)
```

### Flag & AutoDismissFlag

```tsx
import { FlagGroup, AutoDismissFlag, Flag } from '@atlaskit/flag';

// For transient events (SSE notifications, save confirmations):
<FlagGroup onDismissed={(id) => removeFlag(id)}>
  <AutoDismissFlag
    id={flagId}
    title="Issue created"
    description="ACM-12: Fix login bug"
    icon={<span>✓</span>}
  />
</FlagGroup>

// AutoDismissFlag auto-removes after ~8s
// Flag requires manual dismiss (for important messages)
// appearance: 'normal' | 'info' | 'success' | 'warning' | 'error'
```

### Lozenge

```tsx
import Lozenge from '@atlaskit/lozenge';

// Status → Appearance mapping:
const STATUS_MAP = {
  TODO:        'default',    // Gray
  IN_PROGRESS: 'inprogress', // Blue
  REVIEW:      'moved',      // Amber
  DONE:        'success',    // Green
};

// Issue type → Appearance mapping:
const TYPE_MAP = {
  task:  'default',
  bug:   'removed',   // Red
  story: 'new',       // Purple
  epic:  'inprogress', // Blue
};

<Lozenge appearance="inprogress">In Progress</Lozenge>
<Lozenge isBold appearance="success">Done</Lozenge>  // Bold = filled background
```

### Avatar & Avatar Group

```tsx
import Avatar from '@atlaskit/avatar';
import AvatarGroup from '@atlaskit/avatar-group';

<Avatar size="small" name="Alice Johnson" />  // Shows initials + tooltip
// Sizes: 'xsmall' | 'small' | 'medium' | 'large' | 'xlarge'

<AvatarGroup
  appearance="stack"      // or "grid"
  maxCount={4}
  data={[{ key: 'alice', name: 'Alice' }, { key: 'bob', name: 'Bob' }]}
  size="small"
/>
```

### Tooltip

```tsx
import Tooltip from '@atlaskit/tooltip';

// Triggers on hover AND keyboard focus
<Tooltip content="Click to edit title" position="top" delay={500}>
  {(tooltipProps) => (
    <button {...tooltipProps} onClick={handleClick}>
      {title}
    </button>
  )}
</Tooltip>

// position: 'top' | 'bottom' | 'left' | 'right' | 'auto'
// delay: ms before showing (default 300ms)
// Max width: 250px (truncates with ellipsis)
```

### Dropdown Menu

```tsx
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu';

<DropdownMenu trigger="Actions" triggerType="button">
  <DropdownItemGroup>
    <DropdownItem onClick={handleEdit}>Edit</DropdownItem>
    <DropdownItem onClick={handleDelete}>Delete</DropdownItem>
  </DropdownItemGroup>
</DropdownMenu>

// triggerType: 'button' | 'default'
// DropdownItemCheckbox, DropdownItemRadio also available
```

### Section Message

```tsx
import SectionMessage from '@atlaskit/section-message';

// In-content messaging — not transient (use Flag for transient)
<SectionMessage
  appearance="warning"          // info | success | warning | error | discovery
  title="Sprint goal"
  actions={[{ text: 'Dismiss', onClick: dismiss }]}
>
  <p>Ship core auth by Friday</p>
</SectionMessage>
```

### Empty State

```tsx
import EmptyState from '@atlaskit/empty-state';

<EmptyState
  header="No issues yet"
  description="Create your first issue to start tracking work"
  primaryAction={<Button appearance="primary" onClick={onCreate}>Create issue</Button>}
  secondaryAction={<Button appearance="subtle">Learn more</Button>}
/>
```

### Dynamic Table

```tsx
import DynamicTable from '@atlaskit/dynamic-table';

const head = {
  cells: [
    { key: 'key', content: 'Key', width: 10, isSortable: true },
    { key: 'summary', content: 'Summary', isSortable: true },
    { key: 'status', content: 'Status', width: 12 },
  ],
};

const rows = issues.map(issue => ({
  key: issue.id,
  cells: [
    { key: issue.id, content: issue.id },
    { key: issue.title, content: issue.title },
    { key: issue.status, content: <Lozenge ...>{issue.status}</Lozenge> },
  ],
}));

<DynamicTable
  head={head}
  rows={rows}
  defaultSortKey="key"
  defaultSortOrder="ASC"
  rowsPerPage={20}
  isFixedSize
/>
```

### Inline Edit

```tsx
import InlineEdit from '@atlaskit/inline-edit';
import Textfield from '@atlaskit/textfield';

// Click-to-edit pattern:
<InlineEdit
  defaultValue={title}
  editView={({ errorMessage, ...fieldProps }) => (
    <Textfield {...fieldProps} autoFocus />
  )}
  readView={() => (
    <span style={{ color: 'var(--ds-text)' }}>{title}</span>
  )}
  onConfirm={(newValue) => handleSave(newValue)}
/>
```

### Tabs

```tsx
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';

// id prop is REQUIRED on Tabs:
<Tabs id="issue-reader-tabs">
  <TabList>
    <Tab>Read</Tab>
    <Tab>Edit</Tab>
    <Tab>History</Tab>
  </TabList>
  <TabPanel>{readContent}</TabPanel>
  <TabPanel>{editContent}</TabPanel>
  <TabPanel>{historyContent}</TabPanel>
</Tabs>
```

### Breadcrumbs

```tsx
import Breadcrumbs, { BreadcrumbsItem } from '@atlaskit/breadcrumbs';

<Breadcrumbs>
  <BreadcrumbsItem text="Pages" href="#" onClick={(e) => { e.preventDefault(); navigateToPages(); }} />
  <BreadcrumbsItem text="Architecture Overview" href="#" onClick={(e) => { e.preventDefault(); navigateToDoc('DOC-1'); }} />
  <BreadcrumbsItem text="Auth Runbook" />  {/* Last item: no href/onClick */}
</Breadcrumbs>
```

### Progress Tracker

```tsx
import ProgressTracker from '@atlaskit/progress-tracker';

const stages = [
  { id: 'planning', label: 'Planning', percentageComplete: 100, status: 'visited' },
  { id: 'active',   label: 'In Progress', percentageComplete: 50, status: 'current' },
  { id: 'review',   label: 'Review', percentageComplete: 0, status: 'unvisited' },
  { id: 'closed',   label: 'Closed', percentageComplete: 0, status: 'unvisited' },
];

<ProgressTracker items={stages} />
// status: 'visited' | 'current' | 'unvisited' | 'disabled'
```

### Toggle

```tsx
import Toggle from '@atlaskit/toggle';

<label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <Toggle
    id="compact-toggle"
    isChecked={compact}
    onChange={(e) => setCompact(e.target.checked)}
    size="regular"  // or 'large'
  />
  <span>Compact view</span>
</label>
```

### Checkbox

```tsx
import { Checkbox } from '@atlaskit/checkbox';

<Checkbox
  isChecked={selectedIds.includes(id)}
  onChange={(e) => toggleSelect(id, e.currentTarget.checked)}
  label="Select issue"  // Required for accessibility; hide visually with CSS if needed
/>
```

### Pragmatic Drag and Drop

```tsx
import { draggable, dropTargetForElements, monitorForElements }
  from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

// Make a card draggable:
useEffect(() => {
  if (!cardRef.current) return;
  return draggable({
    element: cardRef.current,
    getInitialData: () => ({ issueId: issue.id, fromStatus: issue.status }),
  });
}, [issue.id, issue.status]);

// Make a column a drop target:
useEffect(() => {
  if (!colRef.current) return;
  return dropTargetForElements({
    element: colRef.current,
    getData: () => ({ targetStatus: col }),
    onDragEnter: () => setIsDragOver(true),
    onDragLeave: () => setIsDragOver(false),
    onDrop: () => setIsDragOver(false),
  });
}, [col]);

// Monitor globally for drops:
useEffect(() => {
  return monitorForElements({
    onDrop({ source, location }) {
      const dest = location.current.dropTargets[0];
      if (!dest) return;
      const { issueId } = source.data;
      const { targetStatus } = dest.data;
      onStatusChange(issueId, targetStatus);
    },
  });
}, [onStatusChange]);
```

---

## 14. Patterns

**Reference:** https://atlassian.design/patterns

### Empty States

Structure: optional illustration → heading → description → primary action → optional secondary action

```
When to use:
- Empty board column → EmptyState with "Create issue" button
- No search results → EmptyState with "Clear filters" button
- First-time experience → EmptyState with guided onboarding action

Never:
- Show empty state while loading (show Skeleton/Spinner instead)
- Use vague descriptions ("Nothing here")
```

### Loading States

```
Known shape/size → use Skeleton (shimmer placeholder)
Unknown duration → use Spinner
Progress-trackable → use Progress Bar
Multi-step process → use Progress Tracker
```

### Form Validation

```
Field-level errors → InlineMessage (appearance="error") below the field
Form-level errors → SectionMessage (appearance="error") above submit button
Success confirmation → Flag/AutoDismissFlag after submission
Destructive confirm → Modal Dialog with explicit warning + confirmation button
```

### Destructive Actions

**Never** perform destructive actions silently. Always:
1. Show a Modal Dialog describing what will be destroyed
2. Use `appearance="danger"` on the confirm button
3. Allow cancel with `appearance="subtle"`
4. If the user must type something to confirm: add a Textfield with the resource name

### Bulk Actions

```
Pattern:
1. Checkboxes appear on hover (or always shown) on list/table items
2. Selecting one → BulkActionsBar appears at top with count + action DropdownMenu
3. Actions execute on all selected items
4. Selection cleared automatically after action completes
5. "Clear selection" always available in the action bar
```

### Navigation Patterns

```
Same-level content switching → Tabs
Hierarchical location → Breadcrumbs
Primary navigation → sidebar or top navigation
Pagination → Pagination component for lists > 20 items
Infinite scroll → use sparingly; always offer page count for long content
```

### Onboarding / Spotlight

```tsx
import { SpotlightManager, SpotlightTarget, Spotlight, SpotlightTransition }
  from '@atlaskit/onboarding';

// Wrap entire app:
<SpotlightManager blanketIsTinted>
  {/* Wrap specific elements with SpotlightTarget */}
  <SpotlightTarget name="create-button">
    <Button>Create issue</Button>
  </SpotlightTarget>
  
  {/* Show spotlight for current step */}
  <SpotlightTransition>
    {activeStep === 0 && (
      <Spotlight target="create-button" heading="Create your first issue">
        Click here to start tracking work.
      </Spotlight>
    )}
  </SpotlightTransition>
</SpotlightManager>
```

---

## 15. Dashboard-Specific Token Usage

These are the exact token applications used throughout `dashboard/src/`:

### Surface Hierarchy in This Dashboard

```
app shell background     → var(--ds-surface)           #1D2125 dark
sidebar                  → #1C2B41 (hardcoded — Jira product nav, not a token)
kanban columns           → var(--ds-surface-sunken)     #161A1D dark
issue cards              → var(--ds-surface-raised)     #282E33 dark
modals / drawers         → var(--ds-surface-overlay)    #282E33 dark (with shadow)
```

**Why #1C2B41 is hardcoded:** This is Jira's standard left navigation color. It is not in the token set — it's a product-level decision by Atlassian. Always use this exact value for the sidebar background.

### Text Tokens in This Dashboard

```css
Primary text:        var(--ds-text)           → #C7D1DB
Secondary text:      var(--ds-text-subtle)    → #B6C2CF
Tertiary/meta text:  var(--ds-text-subtlest)  → #9FADBC
Ticket ID links:     var(--ds-link)           → #4C9AFF
Danger text:         var(--ds-text-danger)    → #FD9891
```

### Border Tokens

```css
Default borders:   var(--ds-border)         → rgba(166,197,226,.16)
Strong borders:    var(--ds-border-bold)    → rgba(166,197,226,.32)
Selected state:    var(--ds-border-selected)→ #4C9AFF
Focus ring:        var(--ds-border-focused) → #388BFF
```

### Status Color Tokens (Sprint / Issue States)

```css
/* Background fills for status pills */
Success (Done):     var(--ds-background-success-bold)    → #22A06B
Warning (Review):   var(--ds-background-warning-bold)    → #E2B203
Danger (Bug):       var(--ds-background-danger-bold)     → #E34935
Discovery (Story):  var(--ds-background-discovery-bold)  → #8270DB
Brand (In Progress):var(--ds-background-brand-bold)      → #0C66E4
Neutral (Default):  var(--ds-background-neutral-bold)    → #738496
```

### Component-Level Token Applications

```tsx
// Issue cards — elevation
style={{ background: 'var(--ds-surface-raised)', border: '1px solid var(--ds-border)' }}

// Kanban columns — sunken
style={{ background: 'var(--ds-surface-sunken)', border: '1px solid var(--ds-border)' }}

// Selected card border
style={{ borderColor: 'var(--ds-border-selected)' }}

// Sprint header chip (on dark nav bg)
style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', color: '#fff' }}

// Live indicator dot (active SSE)
style={{ background: 'var(--ds-background-success-bold)' }}

// Live indicator dot (disconnected)
style={{ background: 'var(--ds-background-danger-bold)' }}
```

---

## 16. Anti-Patterns & Forbidden Choices

These are common mistakes to avoid when building the dashboard:

### Color

- **NEVER** hardcode hex values for UI chrome — always use `--ds-*` tokens (exception: sidebar `#1C2B41`)
- **NEVER** use `color.background.neutral` (transparent) where `elevation.surface.sunken` (opaque) is correct — they look similar in dark mode but are semantically different
- **NEVER** use accent/brand colors for error/warning/success states — use the semantic tokens
- **NEVER** apply color without checking contrast against the background (`--ds-text` on `--ds-surface` is guaranteed; custom combinations need verification)

### Typography

- **NEVER** use Charlie Sans in product UI — it is marketing-only
- **NEVER** hardcode `font-size`, `font-weight`, or `line-height` for body/heading text — use typography token scale
- **NEVER** use system fonts (Arial, Helvetica, sans-serif) for new text — Atlassian Sans is the product font

### Elevation

- **NEVER** mix elevation levels incorrectly (e.g., raised card inside sunken column inside overlay modal is correct; raised card directly inside overlay = wrong)
- **NEVER** use `elevation.surface.raised` without the corresponding `elevation.shadow.raised`
- **NEVER** use Blanket without a paired Modal or Drawer — it should never appear standalone

### Components

- **NEVER** use `@atlaskit/table` (Caution) — use `@atlaskit/dynamic-table`
- **NEVER** use `@atlaskit/drawer` for primary content or forms — prefer `@atlaskit/modal-dialog` (Drawer is Caution and deprecated in the new nav context)
- **NEVER** use Lozenge as a button or interactive element — it is purely a display component
- **NEVER** skip focus rings — the `Focusable` primitive handles this; never write `outline: none` without a replacement
- **NEVER** use Dropdown Menu for navigation — use Tabs or Links instead

### Accessibility

- **NEVER** rely on color alone to convey meaning — always add an icon, label, or text
- **NEVER** remove visible focus indicators — required for keyboard navigation
- **NEVER** add `tabIndex={0}` to non-interactive elements — use proper interactive elements
- **NEVER** create custom animations without `prefers-reduced-motion` support

### Patterns

- **NEVER** perform destructive actions silently — always use a confirmation Modal
- **NEVER** show empty state while loading — show Skeleton or Spinner first
- **NEVER** use Tooltip as the only way to convey important information — it's not keyboard-friendly in all contexts
- **NEVER** show multiple simultaneous Flags — queue them through FlagGroup

---

## 17. @atlaskit Package Reference

All packages installed in `dashboard/package.json` with their documentation:

| Package | Documentation URL |
|---------|------------------|
| `@atlaskit/tokens` | https://atlassian.design/components/tokens |
| `@atlaskit/lozenge` | https://atlassian.design/components/lozenge |
| `@atlaskit/badge` | https://atlassian.design/components/badge |
| `@atlaskit/avatar` | https://atlassian.design/components/avatar |
| `@atlaskit/avatar-group` | https://atlassian.design/components/avatar-group |
| `@atlaskit/progress-bar` | https://atlassian.design/components/progress-bar |
| `@atlaskit/progress-tracker` | https://atlassian.design/components/progress-tracker |
| `@atlaskit/dynamic-table` | https://atlassian.design/components/dynamic-table |
| `@atlaskit/primitives` | https://atlassian.design/components/primitives |
| `@atlaskit/icon` | https://atlassian.design/components/icon |
| `@atlaskit/button` | https://atlassian.design/components/button |
| `@atlaskit/modal-dialog` | https://atlassian.design/components/modal-dialog |
| `@atlaskit/drawer` | https://atlassian.design/components/drawer |
| `@atlaskit/flag` | https://atlassian.design/components/flag |
| `@atlaskit/section-message` | https://atlassian.design/components/section-message |
| `@atlaskit/inline-message` | https://atlassian.design/components/inline-message |
| `@atlaskit/empty-state` | https://atlassian.design/components/empty-state |
| `@atlaskit/spinner` | https://atlassian.design/components/spinner |
| `@atlaskit/tabs` | https://atlassian.design/components/tabs |
| `@atlaskit/breadcrumbs` | https://atlassian.design/components/breadcrumbs |
| `@atlaskit/select` | https://atlassian.design/components/select |
| `@atlaskit/textfield` | https://atlassian.design/components/textfield |
| `@atlaskit/textarea` | https://atlassian.design/components/textarea |
| `@atlaskit/inline-edit` | https://atlassian.design/components/inline-edit |
| `@atlaskit/toggle` | https://atlassian.design/components/toggle |
| `@atlaskit/checkbox` | https://atlassian.design/components/checkbox |
| `@atlaskit/radio` | https://atlassian.design/components/radio |
| `@atlaskit/tooltip` | https://atlassian.design/components/tooltip |
| `@atlaskit/popup` | https://atlassian.design/components/popup |
| `@atlaskit/blanket` | https://atlassian.design/components/blanket |
| `@atlaskit/tag` | https://atlassian.design/components/tag |
| `@atlaskit/tag-group` | https://atlassian.design/components/tag-group |
| `@atlaskit/table-tree` | https://atlassian.design/components/table-tree |
| `@atlaskit/dropdown-menu` | https://atlassian.design/components/dropdown-menu |
| `@atlaskit/calendar` | https://atlassian.design/components/calendar |
| `@atlaskit/form` | https://atlassian.design/components/form |
| `@atlaskit/inline-dialog` | https://atlassian.design/components/inline-dialog |
| `@atlaskit/onboarding` | https://atlassian.design/components/spotlight |
| `@atlaskit/code` | https://atlassian.design/components/code |
| `@atlaskit/pragmatic-drag-and-drop` | https://atlassian.design/components/pragmatic-drag-and-drop |
| `@atlaskit/color-picker` | https://atlassian.design/components/color-picker |
| `@atlaskit/datetime-picker` | https://atlassian.design/components/date-time-picker |

---

## Quick Reference Cheatsheet

```
Need a status badge?         → Lozenge (Beta)
Need a number badge?         → Badge
Need a label/category tag?   → Tag / SimpleTag / TagGroup
Need a confirmation?         → Modal Dialog (not Drawer)
Need a transient alert?      → Flag / AutoDismissFlag
Need an in-page alert?       → Section Message (permanent) or Inline Message (field-level)
Need a loading indicator?    → Skeleton (known shape) / Spinner (unknown duration)
Need sortable data?          → Dynamic Table (not Table)
Need click-to-edit?          → Inline Edit
Need a dropdown list?        → Dropdown Menu (for actions) / Select (for choices)
Need a hover explanation?    → Tooltip
Need drag and drop?          → @atlaskit/pragmatic-drag-and-drop
Need an icon?                → @atlaskit/icon/glyph/[name]
Need page tabs?              → Tabs (with required id prop)
Need breadcrumbs?            → Breadcrumbs / BreadcrumbsItem
Need a toggle switch?        → Toggle (not Checkbox, not Button)
Need a checkbox?             → Checkbox (for multi-select, not Toggle)
Need a sidebar/drawer?       → Prefer Modal Dialog; Drawer is Caution
```

---

## 18. AI-Driven Development Philosophy — Feature Guidelines

This plugin exists to support **AI-driven software development** workflows, not traditional Scrum/Agile project management. Every feature added to this plugin must be evaluated against this principle.

### What AI-Driven Development Means Here

In this context, a developer works with Claude Code (and other AI agents) to implement features. The human defines intent; AI handles implementation. The project management layer supports this loop:

```
Human defines intent (ticket) → AI implements → Human reviews → Merged
```

This is fundamentally different from traditional Scrum:

| Traditional PM concept | AI-workflow equivalent | Include in this plugin? |
|------------------------|----------------------|------------------------|
| Story points | Remove entirely | No |
| Velocity | Tickets completed per session | Optional |
| Sprint ceremonies | Async — no standups, no retros | No |
| Estimation poker | N/A — AI implements, not estimates | No |
| Burndown charts | Ticket throughput over time | Optional |
| Story/epic hierarchy | Feature intent → implementation tasks | Yes |
| Acceptance criteria | AI-readable prompt/spec in ticket body | Yes |

### Story Points Are Removed

**Story points do not exist in this plugin.** They represent human estimation of effort, which is irrelevant when Claude Code implements the work. Remove any reference to story points, SP, velocity-by-points, or sprint point targets from code, UI, and documentation.

If a complexity signal is needed, use one of these AI-native alternatives instead:
- **Scope**: small / medium / large (broad intent signal, not effort estimate)
- **Context tokens**: estimated input size for the implementation prompt
- **Agent count**: single agent vs. multi-agent workflow

### Feature Checklist

Before adding any new feature to this plugin, verify:

1. **Does it serve the AI implementation loop?** (ticket → Claude → result)
   - Good: ticket detail drawer that Claude reads to understand scope
   - Good: plan session that creates well-specified tickets for Claude to implement
   - Bad: burndown chart tracking SP velocity
   - Bad: sprint poker / estimation UI

2. **Is it async-first?** AI agents do not attend standups. Features must work asynchronously without synchronous human coordination.

3. **Does it reduce friction for Claude?** The best features make it easier for Claude to understand what to build and get started immediately.

4. **Is it free of traditional Scrum ceremony?** No sprint planning meetings, no retrospectives, no velocity tracking by points.

### Preferred Feature Categories

Features that belong in this plugin:
- **Ticket clarity** — richer descriptions, AI-readable specs, context links to docs/ADRs
- **Session management** — spawning Claude sessions, tracking running implementations
- **ADR/decision capture** — architecture decisions that inform future AI sessions
- **Plan generation** — structured ticket creation from a feature intent
- **Knowledge base** — wiki pages, learnings, runbooks that Claude reads for context
- **Progress visibility** — what is done, what is in flight, what is blocked
- **Review workflow** — routing completed AI work to human review

Features that do NOT belong in this plugin:
- Story point estimation, capacity planning, velocity charts
- Sprint ceremony tools (planning poker, retrospective boards)
- Team workload balancing, resource allocation
- Time tracking, billing, contractor management
- Anything that assumes a human is doing the implementation

### The Core Question

> *"Does this feature make it easier for an AI agent to implement software, or does it assume a human is doing the work?"*

If the answer is the latter — do not build it. If the answer is the former — build it well.
