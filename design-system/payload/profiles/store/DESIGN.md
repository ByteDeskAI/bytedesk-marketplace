# Design — ByteDesk Store

Canonical design profile for `bytedesk-store` and its `/admin` operator console. Read
after the [shared foundation](../../DESIGN.md); the consumer repo's root `DESIGN.md`
carries only local exceptions and enforcement commands.

## Product stance

**Creative north star: "The Ledger Desk."**

Store is the commercial backend for the ByteDesk product line: catalog, artifacts,
customers, license keys, install credentials, usage metering, billing, and install jobs.
Its Admin UI is where an operator reads and mutates the commercial record of the whole
family. The console must feel like a ledger, not a storefront — dense, precise, calm,
and auditable. Every screen answers *what is true right now* and *what changing it will
do* before it offers anything to click.

The polish bar is customer-facing, not internal-tool: paying customers' ops teams will
use this console. Product direction lives in [`PRODUCT.md`](PRODUCT.md).

## Token source

- Family value layer: `tokens/css/bytedesk.css` from this repo, consumed from the
  mounted submodule at `.context/design-system`.
- Consumer token root: the Admin UI's embedded stylesheet. Because the console is
  server-rendered, CSP-safe, and ships zero external assets, the token CSS is **inlined
  at build time** from the submodule; a generated header names the design-system commit
  it came from. The stylesheet declares local aliases over `--bd-*` and nothing else.
- Product accent: **Store green**, resolved by `data-bd-product="store"` on the root
  element. Components read `--bd-accent`, never the hex.
- Validation: `go test ./...` plus `gofmt`. The build step that inlines the token CSS
  fails the build if the submodule is missing — a stale hand-copied palette is a
  regression, not a fallback.
- Foundation value changes land in this repo first (shared `DESIGN.md` §8); Store then
  re-pins the submodule and rebuilds.

## Visual language

**Palette roles.** The family dark ground: `--bd-bg-base` for the page,
`--bd-bg-subtle` for the header band and panels, `--bd-bg-surface` for raised controls,
and the darkest step for input wells and code blocks. Hairlines and table rules use
`--bd-border-dimmer`; hover and focus borders step up to `--bd-border-stronger`. Text
runs `--bd-text-primary` → `secondary` → `tertiary` → `disabled` for placeholders.

- **Store green** (`--bd-accent`): product identity — the product mark, the environment
  chip row, and the active state of primary navigation. Used sparingly, well under 10%
  of the surface.
- **Interactive blue** (`--bd-interactive-blue`): links, focus rings, and the fill on
  primary action buttons.
- **Semantic ok / warn / danger** (`--bd-success` / `--bd-warning` / `--bd-danger`):
  license and credential state, paid tags, revocations, and errors. Status only.

**The accent–status separation rule.** Store's product accent and the family success
colour are the same green. Because of that, this console must **never** rely on green
alone to mean "healthy": status is always dot **plus word** (`active`, `revoked`,
`inactive`), and the accent never appears as a bare status dot. Where an identity green
and a status green would sit in the same row, the identity use gives way.

**Typography.** IBM Plex Sans (`--bd-font-sans`) for labels, buttons, prose, and
section titles. IBM Plex Mono (`--bd-font-mono`) for everything machine-generated —
package identifiers, license keys, client IDs, hashes, timestamps, table data, chips.
The mono/sans split is the console's primary legibility signal: if a value came from
the system, it is mono. Micro-labels are uppercase and tracked; body prose stays under
~72ch.

**Density.** Operational admin density: rows and controls sit tighter than the family
default, with a compact spacing ladder inside groups and generous separation between
sections. The console packs a lot of true rows on one screen deliberately.

**Layout.** A sticky header band (product mark left; environment chips — billing mode,
version, signing publisher — and session state right), a slim left rail of anchor links
with row counts that collapses on narrow viewports, and a bounded content column.
Sections are **full-width bands separated by 1px rules, not cards**. No nested cards,
no uniform card grid.

**Elevation.** Flat. Depth is tonal only. Toasts are the one floating layer.

**Motion.** ~150ms `--bd-ease-out-expo` on hover, focus, and toast entry; toasts leave
by opacity. Never animate layout properties. `prefers-reduced-motion` is honored by the
token layer.

## Component and composition rules

- **Tables** are the primary component: mono values, `border-bottom` rules only (no
  zebra striping), muted uppercase column headers, numerics right-aligned, timestamps
  rendered relative with the full RFC3339 value available on hover.
- **Status** is a small dot plus a word, in the semantic colour. Never colour alone.
- **Tags** are 1px-border pills with text in the semantic colour and a transparent fill.
- **Buttons**: primary is an accent- or interactive-tinted fill with a mono label;
  destructive styling appears only on the confirm step.
- **Destructive actions use a two-step inline confirm** — the button swaps in place to
  "confirm?" plus cancel, restating what will change. **No modals.** Reversible domain
  actions (revoke/reactivate, deactivate/activate) say so in the confirm copy.
- **Forms** are collapsed `<details>` disclosures ("+ New …") per section, so the
  reading view stays a ledger and the writing view is opt-in. Inputs sit in sunken
  wells with a 1px border and a focus ring.
- **Feedback**: a top-right toast stack (mono, auto-dismissing) *plus* a persistent
  per-section inline result line — a toast alone is not a record.
- **Secrets** (license keys, install credentials) appear once in a copy-to-clipboard
  reveal block on the sunken well surface, explicitly labeled as shown once.
- **Trust surfaces are permanent chrome**: signing publisher, billing mode, and session
  state are always visible in the header, never behind a menu. Security invariants are
  stated in the UI, not documented elsewhere.

## Accessibility

Shared WCAG 2.2 AA foundation applies. Store-specific requirements:

- Status, tags, and billing mode never carry meaning by colour alone — see the
  accent–status separation rule above.
- Two-step inline confirms must be operable and comprehensible by keyboard and screen
  reader: the confirm step announces the target and the consequence, and cancel is
  reachable without leaving the row.
- Toasts are polite live regions; the inline result line is the accessible record, so
  no outcome is available only for the toast's lifetime.
- Mono identifier columns still meet contrast and minimum size at the console's dense
  scale; density is never bought with unreadable type.

## Exceptions to the shared foundation

- **Build-time inlined token CSS.** The console ships zero external assets and no CDN
  fetches, so it inlines rather than imports the family token CSS. The generated header
  naming the source commit is what keeps the copy accountable; hand-editing the inlined
  block is drift.
- **Admin density.** Store runs tighter than the family default because it renders long
  commercial records. The ladder lives in the token aliases, not in components.

## Bans (absolute)

Side-stripe accent borders. Gradient text. Glassmorphism. Hero-metric tiles. Identical
card grids. Modal-first patterns. Generic SaaS admin chrome and icon soup. Marketing
gloss of any kind inside the console. Em dashes in UI copy.
