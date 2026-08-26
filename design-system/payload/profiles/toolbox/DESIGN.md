# Design - ByteDesk Toolbox

Canonical design profile for the ByteDesk Toolbox tray application. Read after the
[shared foundation](../../DESIGN.md). The consumer repository's root `DESIGN.md` may
contain implementation mappings and explicit local exceptions only.

## Product stance

**Creative north star: The Command Shelf.** Toolbox is the keyboard-fluent desktop
home for discovering, installing, updating, and understanding ByteDesk applications.
It feels like a precise AI-era instrument: composed at rest, luminous when work is
active, and honest about what is live, cached, simulated, gated, or unavailable.

JetBrains Toolbox informs installed-versus-available hierarchy, coordinated updates,
and release visibility. Raycast informs invocation fluency. Neither supplies visual
identity. The governing visual reference is the family Black Glass + Optical Layering
record under `artifacts/family/black-glass-optical-layering/`.

Product direction lives in [`PRODUCT.md`](PRODUCT.md).

## Token and runtime contract

- Consume the managed family tokens at `.context/design-system/tokens/`.
- WebView CSS imports `tokens/css/bytedesk.css` and `tokens/tailwind/theme.css`.
- Rust maps `tokens/platforms/rust/bytedesk_tokens.rs` once into the Tauri/native theme
  boundary. Components never repeat token literals.
- Apply `data-bd-product="toolbox"`, `data-bd-theme="dark|light"`, and
  `data-bd-richness="soft|balanced|rich"` to the WebView root. Native surfaces select
  the corresponding typed roles.
- Toolbox identity uses `product.toolbox`; family interaction remains electric blue and
  ByteDesk attention remains restrained orange.

## Visual language

### Shell

Toolbox is a floating Black Glass command shell on an atmospheric desktop canvas. The
shell uses a near-opaque graphite or pearl material, 1px perimeter, subtle inner
top-light, and broad low-opacity ambient shadow. Search, tabs, selected application
detail, menus, and dialogs use the Optical Layering ladder. Ordinary rows stay on the
shell plane and are separated by alignment and hairlines, not cards.

The primary dark material reference is
`artifacts/family/black-glass-optical-layering/reference-dark-primary.png`. Preserve its
technical density, breathing room, compact radii, cool perimeter, mono-forward chrome,
and bounded cobalt energy. Do not flatten it into an edge-to-edge settings page.

### Themes and richness

Dark and light both ship. They are exact semantic counterparts: the same information,
geometry, iconography, component states, and behavior. Only theme tokens change.

`balanced` is the default dark richness. `soft` lifts the graphite ground and reduces
bloom; `rich` deepens the atmospheric canvas and ambient shadow. Richness never changes
layout, contrast requirements, state colors, or light mode.

### Typography

IBM Plex Sans carries application names, actions, release prose, and explanatory copy.
IBM Plex Mono carries versions, sizes, timestamps, channels, command labels, shortcuts,
paths, and compact operational metadata. Toolbox deliberately uses more Mono than a
marketing surface, but long reading remains Sans.

### Accent and status

Electric blue identifies focus, selection, primary commands, progress, and live agentic
energy. Orange is a rare ByteDesk spark for update attention, decision handoff, and
identity detail. Success, warning, danger, and info retain semantic roles and always
appear with text or an icon. Product icon colors do not recolor lifecycle state.

### Product identity

The Toolbox mark embodies an application command shelf: a compact shell or hub carrying
multiple tools around a central command. It may use dimensional dark metal/glass,
electric-blue energy, and one orange core. Generic cubes, puzzle pieces, or unmodified
component-library glyphs are not final identity. Application rows use each product's
cataloged mark and preserve that product's personality inside the shared shell.

## Information topology

- The command field leads the shelf and searches applications, versions, release notes,
  activity, and settings actions.
- `Apps` and `Activity` are primary views. Account and settings remain secondary.
- Installed applications appear before available applications.
- `Update all` stays near the pending-update summary and explains its scope before work
  begins.
- Release notes, lifecycle detail, and activity expand in place so context is preserved.
- Catalog freshness is first-class and separate from application lifecycle.

## Personality modes

Both modes share commands, content, accessibility, and state semantics.

- **Calm Companion** is the default: comfortable rows, quiet secondary metadata,
  progressive disclosure, and restrained ambient activity.
- **Mission Control** is denser: compact rows, visible synchronization evidence, and
  more monospaced operational metadata for supervising several updates.

Personality does not alter theme geometry or become an excuse for KPI tiles, topology
graphs, fake terminals, or ambient telemetry unrelated to real work.

## Components and states

- Application rows expose name, installed/available version, channel/state, and one
  primary action. Secondary actions remain discoverable without competing.
- Installed, available, public, entitled, locked, and signed-out states never
  masquerade as update health.
- Lifecycle vocabulary is stable: available, current, update available, queued,
  downloading, verifying, staged, waiting for exit, installing, complete, failed, and
  rollback available.
- Freshness vocabulary is stable: live, refreshing, cached, stale, offline, and invalid
  response.
- Per-application progress remains visible and cancellable only where the engine really
  supports cancellation. One failure does not erase completed work.
- Activity is chronological evidence: application, action, result/current state, and
  useful time.
- Loading, offline-empty, no-applications, no-updates, permission-denied, failed,
  waiting-for-exit, partial-update, and rollback states are designed before polish.
- Simulated prototype fixtures are visibly labeled and remain separate from live
  marketplace/catalog data.

## Responsive behavior

The tray shelf keeps the approved floating-shell material and clamps to the active work
area. Content scrolls and reflows instead of clipping at 200% text. Larger companion
views use a full-screen atmospheric canvas with 24-48px breathing room around the
elevated shell. At narrower widths, secondary detail collapses before the command field
or primary application state becomes ambiguous.

Native tray menus, notifications, file dialogs, and placement may follow platform
conventions while retaining Toolbox terminology and accessible state.

## Motion and microinteraction

- Open/close, detail expansion, command invocation, progress transitions, and completion
  acknowledgements use short opacity/translation transitions on the family easing.
- Hover and focus may tighten a border and lift the top-light; they do not tilt whole
  rows or create cursor-chasing spotlights.
- Blue bloom follows real focus or activity. Orange pulses only for actionable
  attention. Nothing glows merely because it exists.
- Reduced motion removes spatial travel, parallax, and bloom animation while preserving
  state, progress values, and focus.

## Storybook and approval gate

Before native adoption, the browser implementation supplies stories for the shell,
search/command field, tabs, application rows, update-all review, progress, release
detail, activity, settings, notifications, overlays, and every state above. Each story
covers dark/light, both personalities, all dark-richness levels, keyboard/focus,
reduced-motion, and responsive widths. The Tauri shell is not added or changed until
the browser mockup receives explicit human approval.

## Accessibility

- Meet WCAG 2.2 AA in both themes and personalities.
- The open, search, inspect, update-one, review-update-all, activity, settings, and quit
  path is keyboard operable.
- Progress and lifecycle changes expose accessible names/values and announce durable
  transitions without announcing every byte or animation frame.
- Color never carries lifecycle, access, freshness, or failure alone.
- Focus returns predictably after overlays, expanded details, tray hiding/reopening, and
  command completion.

## Explicit exceptions

- Toolbox uses a compact tray-scale command shelf rather than a conventional page.
- Calm Companion and Mission Control are product-level presentation choices.
- Platform-native system surfaces may follow operating-system visual conventions.

## Bans

No JetBrains visual imitation, generic SaaS dashboard, edge-to-edge flat panel tiling,
nested glass-card grid, frosted haze, decorative gradient text, rainbow telemetry,
unlabeled status color, fake update behavior, generic placeholder identity, or dark/light
composition drift.
