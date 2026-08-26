# Design — Agent Mail

Canonical design profile for `agent-mail`, a browser-based ByteDesk platform.
Read this after the [shared foundation](../../DESIGN.md). The consumer
repository's root `DESIGN.md` contains only local implementation references and
explicit exceptions.

## Product stance

Agent Mail is a browser-based ByteDesk platform, not a marketing site. This
initial profile deliberately does not establish unapproved branding, personas,
information architecture, density, layout, or mail-specific behavior.
Decisions made later must be added here before they are treated as canonical
design guidance.

## Token source

- Family values come from `tokens/css/bytedesk.css` and
  `tokens/tailwind/theme.css` in the managed design-system payload.
- The consumer token root is `src/app/globals.css`. Local Tailwind or CSS names
  alias `--bd-*` values and never restate literal colors, spacing, type, radius,
  shadow, or motion values.
- Until Agent Mail has an approved product identity, the root element uses
  `data-bd-product="platform"`. Components consume `--bd-accent`; they do not
  create an `agent-mail` accent locally.
- The consumer validates the adapter and application with `npm run build` and
  the committed design-system integrity check.

## Visual language

- Use the shared background, text, border, and elevation ramps to communicate
  hierarchy. Depth is tonal; decoration must not compete with operational
  state.
- Reserve the product accent for identity and active navigation. Links, focus,
  and primary interactions use the shared interactive color. Success, warning,
  and danger tokens communicate status only.
- Use IBM Plex Sans for interface language and IBM Plex Mono only for stable
  machine values such as identifiers, addresses, timestamps, and diagnostic
  output.
- Motion explains state changes and spatial relationships, stays within the
  shared timing vocabulary, and has a reduced-motion equivalent.
- No product-specific density, layout, status vocabulary, iconography, or
  motion treatment is approved yet. Keep those decisions local and provisional
  until this profile is updated.

## Component and composition rules

- Build the application shell from token-backed, reusable primitives; route
  pages compose product organisms instead of duplicating controls or layout.
- Every data-bearing surface provides loading, empty, error, and unavailable
  states appropriate to its operation.
- Actions expose their target and consequence before execution. Destructive or
  irreversible actions require an explicit confirmation boundary.
- Do not establish canonical domain workflows or visualizations until the
  corresponding product contract exists.

## Accessibility

The shared WCAG 2.2 AA foundation applies. Because this is an operational web
platform, complete workflows must be keyboard reachable, focus must remain
visible across navigation and overlays, status cannot rely on color alone, and
live updates must avoid stealing focus or producing excessive announcements.

## Exceptions to the shared foundation

None.
