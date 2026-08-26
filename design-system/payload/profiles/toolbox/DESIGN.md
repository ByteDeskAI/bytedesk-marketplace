# Design — ByteDesk Toolbox

Canonical design profile for the ByteDesk Toolbox tray application. Read after the
[shared foundation](../../DESIGN.md); the consumer repository's root `DESIGN.md`
contains only implementation mappings and explicit local exceptions.

## Product stance

**Creative north star: "The Command Shelf."**

Toolbox is a compact, keyboard-fluent shelf for the ByteDesk applications on this
machine. It prioritizes installed applications, pending work, and the next safe action;
discovery follows below. The shelf should feel composed when nothing needs attention
and precise when several updates are moving at once.

JetBrains Toolbox informs workflow hierarchy only: installed versus available groups,
per-application actions, coordinated updates, and accessible release history. Raycast
informs invocation fluency—search, keyboard movement, and immediate commands. Linear
informs status hierarchy—short labels, restrained metadata, and unmistakable current
state. None of these products supplies Toolbox's visual identity.

Product direction lives in [`PRODUCT.md`](PRODUCT.md).

## Token source

- Consume the vendored family token layer at `.context/design-system/tokens/`.
- WebView CSS imports `tokens/css/bytedesk.css` and
  `tokens/tailwind/theme.css`; local semantic aliases map to `--bd-*` values.
- Rust reads the generated `tokens/platforms/rust/bytedesk_tokens.rs` adapter and maps
  values once into its native theme boundary. Components never repeat token literals.
- Apply `data-bd-product="toolbox"` to the WebView root. Native surfaces select
  `product.toolbox` through the equivalent theme adapter.
- Product accent: **Toolbox periwinkle** (`#7C8AE8`). It reaches 6.02:1 on
  `--bd-bg-base`, 5.38:1 on `--bd-bg-subtle`, and 4.83:1 on `--bd-bg-surface`, meeting
  WCAG 2.2 AA for normal text on canonical dark grounds. Use the accent for identity,
  focus-adjacent selection, and primary action emphasis—not for semantic update state.
- Consumer validation runs the vendored design-system integrity check plus its frontend
  typecheck/build and Rust checks.

## Visual language

**Theme.** Dark is the only shipping theme. Light variants are non-shipping design
research: keep them isolated from runtime imports and do not present them as an
available preference until the family foundation approves a light system.

**Palette roles.** Canonical dark grounds and tonal elevation keep the small window
quiet. Periwinkle identifies Toolbox and selected/primary actions. Success, warning,
danger, and info tokens retain their semantic meanings and always appear with a word
or icon. Avoid broad accent washes, glows, gradient chrome, and color-coded app health
without a label.

**Typography.** IBM Plex Sans carries application names, actions, release-note prose,
and navigation. IBM Plex Mono carries versions, download sizes, timestamps, channels,
and diagnostic values. Hierarchy comes from weight, spacing, and tone rather than large
display type.

**Topology.** The compact command field leads the shelf. `Apps` and `Activity` are the
primary views; account and settings are secondary in-window views. `Apps` orders
installed applications before available applications, and keeps a restrained but
prominent `Update all` action near the pending-update summary. Release notes and
lifecycle detail expand in place so context is not lost.

**Density personalities.** Both personalities are shipping, selectable runtime modes;
they change presentation density without changing information, command identifiers,
accessibility, or behavior.

- **Calm Companion** is the default. It uses comfortable rows, quiet secondary
  metadata, progressive disclosure, and generous separation between applications.
- **Mission Control** uses compact rows, visible synchronization telemetry, and more
  monospaced operational metadata for users supervising several updates.

**Elevation.** Resting content is flat and separated by tone and hairlines. Menus,
dialogs, and the command overlay may use the canonical elevated/overlay surfaces and
shadow tokens. Avoid nested cards and card-per-field composition.

**Motion.** Use short opacity/translation transitions for opening the shelf, expanding
detail, and acknowledging state changes. Progress may move only when it represents real
or explicitly simulated work. Reduced-motion mode removes spatial transitions and
nonessential progress animation without hiding state.

**Iconography.** Use a consistent monoline icon family for UI actions. Application
identity uses only cataloged product assets; until Toolbox has an approved mark, use a
clearly provisional, non-cube tray glyph and do not catalog it as final identity.

## Component and composition rules

- The command field searches applications, versions, release notes, activity, and
  settings actions. Keyboard navigation and visible focus work from first open.
- Application rows expose name, installed/available state, version, and one primary
  action. Secondary actions and release detail remain available without competing with
  the primary action.
- Installed and available groups are semantically labeled. Public, entitled, locked,
  and signed-out access states never masquerade as update status.
- `Update all` summarizes its scope before it starts. Per-application progress remains
  visible and cancellable where the engine supports cancellation; one failure does not
  visually erase completed work.
- Lifecycle vocabulary is stable: available, current, update available, queued,
  downloading, verifying, staged, waiting for exit, installing, complete, failed, and
  rollback available. Compact UI may shorten labels only when the accessible name keeps
  the full state.
- Catalog freshness is first-class: live, refreshing, cached, stale, offline, and
  invalid response are distinguishable from application lifecycle.
- Activity is chronological evidence, not decoration. Each entry identifies the
  application, action, result or current state, and useful time.
- Settings use ordinary controls with concise consequences. Account and entitlement
  information stays secondary to local application management.
- Loading, offline-empty, no-applications, no-updates, permission-denied, failed,
  waiting-for-exit, and partial-update states are designed before polish.
- The compact desktop window may clamp to the active work area, but content scrolls and
  reflows rather than clipping at large text scale. Native tray menus and notifications
  may follow platform conventions while retaining Toolbox terminology and state.

## Accessibility

- Meet WCAG 2.2 AA across both dark personalities, including visible focus, keyboard
  traversal, 200% text scaling, reduced motion, and high-contrast operating-system
  preferences where the runtime exposes them.
- The full critical path—open, search, inspect, update one, review `Update all`, change
  view, open settings, and quit—is keyboard operable.
- Progress and background changes expose accessible names and values. Announce durable
  lifecycle transitions politely; do not announce every byte or animation frame.
- Color never carries lifecycle, access, freshness, or failure alone. Use text and,
  where useful, an icon or progress value.
- Focus returns predictably after collapsing details, closing overlays, hiding and
  reopening the tray window, or completing a command.
- Truncated versions, application names, and release text retain an accessible full
  value and an inspection path.

## Exceptions to the shared foundation

- **Tray-scale topology.** Toolbox uses a compact fixed-width command shelf rather than
  a conventional page or dashboard because it is invoked transiently from the system
  tray. Text scaling may increase height and scrolling; it must not preserve a fixed
  viewport by clipping content.
- **Selectable density.** Calm Companion and Mission Control are two shipping
  presentations over the same semantic component/state model. This is a product-level
  preference, not a family-wide density rule.
- **Platform-native surfaces.** System tray menus, notifications, file dialogs, and
  window placement may follow operating-system conventions. Their command labels,
  consequences, and accessible state remain aligned with this profile.

## Bans

No JetBrains visual imitation, cube mark, permanent dashboard chrome, nested-card
grids, glassmorphism, gradient text, ambient telemetry, hidden update consequences,
status by color alone, or shipping light theme.
