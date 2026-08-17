# Design — ByteDesk Gateway

Canonical design profile for `bytedesk-remote-gateway`. Read after the
[shared foundation](../../DESIGN.md); the consumer repo's root `DESIGN.md` carries only
local exceptions and enforcement commands.

## Product stance

**Creative north star: "The Operator Console."**

Gateway is secure remote access to your own workstation — terminal, desktop, files, and
an AI workroom behind real authentication. Its UI is a **single-operator console**, not
a dashboard product: the person using it is already inside the machine and needs the
shortest path between intent and a live session. Visual authority comes from density,
hierarchy, and honest live state, never decoration.

The console covers Sessions (tab launcher plus terminal), Mission Control health, the
Agentic workroom, Files, Security admin, and Infrastructure. Product direction lives in
[`PRODUCT.md`](PRODUCT.md).

## Token source

- Family value layer: `tokens/css/bytedesk.css` from this repo, consumed from the
  mounted submodule at `.context/design-system`.
- Consumer token root: `web/src/styles/theme.css`. Its local aliases (`--bg`, `--text`,
  `--accent`, `--ok`, `--radius`, `--font`, …) **map to** `--bd-*` values; the SPA never
  declares a colour literal outside that mapping.
- Product accent: **Gateway blue**, resolved by `data-bd-product="gateway"` on `<html>`.
  Components read `--bd-accent` (via the local `--accent` alias), never the hex.
- Validation: `npm run build` in `web/` (the embedded bundle gate) plus `go test ./...`.
- Foundation value changes land in this repo first (shared `DESIGN.md` §8); the gateway
  then re-pins the submodule and re-vendors the token CSS.

## Visual language

**Palette roles.** Dark-first from `--bd-bg-base`, stepping through subtle / surface /
elevated / overlay for panels, controls, and hover states. Rules use `--bd-border-*`;
type uses the `--bd-text-*` ramp with a distinct disabled tier for inert chrome.

- **Gateway blue** (`--bd-accent`): primary actions, links, focus rings, active tab and
  selection. Kept under ~10% of any screen — neutrals carry structure, blue marks the
  next step.
- **Brand orange** (`--bd-brand-orange`): ByteDesk brand and commerce moments inside the
  console (Store surfaces, upgrade paths) only. It is not a second action colour.
- **Semantic ok / warn / danger**: live state only — session health, tunnel status,
  watchdog and deploy posture, ban and kick outcomes. Never decoration.

Accent-tinted backgrounds and lines are derived with `color-mix()` from the accent
token so the whole console re-tints correctly if the accent changes.

**Typography.** IBM Plex Sans (`--bd-font-sans`) for all chrome; IBM Plex Mono
(`--bd-font-mono`) for the surfaces that are genuinely machine text — terminal output,
paths, IDs, IP addresses, commands, log lines. Console text runs at a smaller base than
marketing surfaces; hierarchy comes from weight and colour, not from large type.

**Density.** Operator density is a first-class product decision: ~28px rows and control
heights, a compact 2/4/6/8/12/16/20px spacing ladder, a fixed narrow sidebar and a
short top bar. Chrome must never cost more vertical space than the work it frames — the
terminal and file panes are the product; everything else is a frame.

**Status vocabulary.** Live state is shown as dot + word (never colour alone), with
relative time in the label and the absolute timestamp available on hover. Health that
streams over SSE must visibly distinguish *live*, *stale*, and *disconnected* — a stale
snapshot presented as current is a correctness bug, not a styling choice.

**Elevation.** Flat by default; depth is tonal (base → subtle → surface → elevated).
Shadows are reserved for genuinely floating layers — overlays, palettes, portaled
panels — and never decorate a resting panel.

**Motion.** 120–250ms, `--bd-ease-out-expo`, on hover, focus, tab switch, and panel
open. Never animate layout properties in the session stage; a terminal must not reflow
for aesthetics. `prefers-reduced-motion` is honored by the token layer.

## Component and composition rules

- **App shell**: fixed top bar (product mark, environment/health chips, session state)
  plus a narrow left rail of primary routes with counts. The shell is chrome and stays
  visually quieter than the stage it frames.
- **Sessions stage**: the terminal or remote surface fills the stage; tab strip and
  launcher controls sit in the chrome, not over the stage. Overlays that cover a live
  session are dismissible by keyboard and never trap focus.
- **Tables** (sessions, viewers, bans, audit): dense rows, hairline dividers, muted
  uppercase micro-labels, mono for machine values, numerics right-aligned. Empty states
  are one muted sentence inside the table body — no illustrations.
- **Destructive actions** (kick, ban, revoke): inline two-step confirm in place; the
  affected identifier is restated in the confirm step. No modal-first patterns.
- **Security posture surfaces**: the console states its own limitations plainly — a
  warn-toned banner with a full 1px border, never a side stripe, never dismissed by
  default. Fake enterprise RBAC chrome is prohibited.
- **Secrets in flight** (enroll tokens, install credentials): shown once in a sunken
  mono reveal block with an explicit copy affordance and a "shown once" label.
- **Forms**: sunken input wells, 1px borders, accent focus ring, server-side validation
  mirrored in the UI — the UI may disable an invalid choice, but never *only* the UI.

## Accessibility

Shared WCAG 2.2 AA foundation applies. Gateway-specific requirements:

- Every action reachable from the console must be reachable by keyboard, including tab
  switching, the launcher, and overlay dismissal. Focus is always visible against the
  dark ground.
- Terminal and remote-screen surfaces are third-party render targets; the surrounding
  chrome must therefore carry the accessible labels, state announcements, and keyboard
  escape route the embedded surface cannot provide.
- The mobile PWA's on-screen key row is an accessibility feature, not a nicety: it is
  the only way to send modifier keys on touch devices and must remain reachable.
- Live-updating health regions announce politely; they must not steal focus.

## Exceptions to the shared foundation

- **Console density.** Gateway runs tighter than the family default because it frames a
  terminal. The density ladder above is the exception, and it is expressed as tokens in
  `theme.css`, not as per-component literals.
- **Embedded third-party surfaces.** Terminal and screen-mirror renderers are not
  token-styled ByteDesk components. They are configured to the nearest token values and
  are explicitly out of scope for component rules above.
