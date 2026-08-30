# Design — ByteDesk Marketplace

Canonical design profile for the public `bytedesk-marketplace-server` website,
publisher workspace, and moderator console. Read this after the shared ByteDesk
foundation and before the consumer repository's local `DESIGN.md` adapter.

## Product stance

**Creative north star: "The Package Observatory."**

The marketplace is a public technical registry. It must make package identity,
compatibility, provenance, lifecycle, and installability legible before it asks a
visitor to trust or download anything. It is neither the commercial ByteDesk Store
nor a generic SaaS dashboard: discovery feels open and browsable, while signed-in
publishing and moderation remain precise, dense, and auditable.

Product direction lives in [`PRODUCT.md`](PRODUCT.md).

## Token source

- Consume the vendored family CSS at
  `.context/design-system/tokens/css/bytedesk.css` and its Tailwind adapter.
- Local aliases live in the web application's `globals.css`; components consume
  semantic variables and never copy foundation values.
- The default experience is dark. A complete light theme is selected through
  `data-theme="light"` and must preserve WCAG 2.2 AA contrast.
- `npm --prefix web run design:check` validates token usage and component boundaries.

## Visual language

**Palette roles.** Deep neutral foundations make package metadata, code, and trust
signals easy to scan. Interactive blue is the sole general action color. Orange is
reserved for the ByteDesk product mark and exceptional brand calls to action. Green,
amber, and red communicate verified/healthy, pending/risk, and rejected/revoked only;
every state also carries text or an icon.

**Typography.** IBM Plex Sans carries navigation, headings, descriptions, and forms.
IBM Plex Mono carries coordinates, versions, digests, commands, provider names,
timestamps, and policy identifiers. Package coordinates are the dominant identity
element on package pages; display names remain secondary and human friendly.

**Density.** Public search and package pages are moderately dense and comfortable at
14px base type. Publisher and moderator workspaces are denser but never reduce target
sizes or hide consequences. Long descriptions stay within a readable measure.

**Layout.** Public pages use a bounded wide canvas with persistent search, compact
filter rail, and result list. Package detail uses a main documentation/evidence column
plus a narrow immutable-facts rail. Signed-in operations use a slim navigation rail
and full-width tables. Cards communicate distinct resources, not every section.

**Elevation.** Use the family depth ramp sparingly: flat bands and hairlines for dense
metadata, raised cards for search results, elevated surfaces only for menus and
dialogs. Avoid nested cards.

**Motion.** Short opacity/translation transitions clarify state changes and navigation.
No looping decoration. Honor reduced motion and never animate security state in a way
that delays comprehension.

## Component and composition rules

- Pages compose templates and domain organisms and contain no styling decisions.
- Shared atoms are domain free. Repeated search, status, metadata, and command-copy
  structures become molecules before domain organisms are created.
- Search results lead with `@namespace/name`, verified publisher state, summary,
  supported-provider badges, current version, and update time. Downloads and ratings
  remain secondary signals.
- Package detail permanently exposes lifecycle state, release-root digest, evidence
  freshness, and provider compatibility. Trust information is never hidden behind an
  overflow menu.
- Commands render in copyable mono blocks with the target provider and scope stated
  in adjacent text.
- Status is icon or dot plus word. Color alone never communicates publish, quarantine,
  yank, tombstone, verification, or private visibility.
- Destructive lifecycle actions use a consequence summary and explicit confirmation.
- Loading skeletons match the expected result/list/detail shape. Empty, error,
  unauthorized, private, quarantined, yanked, tombstoned, and stale-trust states are
  designed first-class surfaces.
- Ratings and reviews are visually separated from signed evidence and never use
  verified/security iconography.
- Use Lucide icons only; use them to aid scanning rather than decorate every label.

## Accessibility

- Meet WCAG 2.2 AA in both themes, at 200% zoom, and with reduced motion.
- Search, filters, version selection, provider selection, copy controls, publishing,
  and moderation are fully keyboard operable with visible focus.
- Announce publish-state changes through a polite live region and preserve a durable
  inline result.
- Digest and coordinate truncation retains an accessible full value and copy action.
- Tables have semantic headers and a usable stacked representation below 720px.

## Exceptions to the shared foundation

- Marketplace implements the shared dark/light parity contract and respects user
  preference across documentation-heavy pages.
- Marketplace is less dense than operational ByteDesk consoles on anonymous routes;
  publisher and moderator routes return to the family operational density.

## Bans

Marketplace does not use Store's commercial ledger contract, pricing language,
upgrade CTAs, hero metric grids, unbounded decorative glass stacks, gradient text, icon soup, fake terminal
chrome, provider logos without approved provenance, or ratings styled as trust proof.

## Generated art

The family contract is [`DESIGN.md` §10](../../DESIGN.md) — read it first. It holds the
invariants: unlifted dark ground, exactly one lit element, accent as edge-light or
contained glow and never a fill, matte with fine grain, composition that breathes, and
the hard limit that generated art carries no logos, copy, controls, invented metrics,
functional icons, or rasterized UI.

This section supplies the half that must not be shared.

**Motif — Submissions arriving at a threshold.**

The marketplace is a queue with a gate. Flat plates in procession toward one defined threshold line; exactly one has crossed it and is lit.

**Accent:** brand orange (no product accent assigned), read live from `tokens/`. Never sampled from a rendered image.

**Watch for:** The threshold must be a real line in the composition. Without it the plates are only a receding row and the moderation idea disappears.

A piece that would work equally well for another ByteDesk product has failed this
section, however good it looks.
