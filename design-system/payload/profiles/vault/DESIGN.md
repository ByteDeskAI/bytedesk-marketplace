# Design — ByteDesk Vault

Canonical design profile for `bytedesk-vault` and its Admin control plane. Read after
the [shared foundation](../../DESIGN.md); the consumer repo's root `DESIGN.md` carries
only local exceptions and enforcement commands.

## Product stance

**Creative north star: "The Dispatch Desk."**

ByteDesk Vault Admin is a dense enterprise control plane for fleet identity. It should
feel like a secure operations desk where operators issue access with procedural clarity:
create identities, mint one-time gateway enroll tokens, and inspect enrolled gateways.
Visual authority comes from hierarchy, spacing, and type — never from decoration.

The register is **admin / control plane**. Every screen answers *what is true right now*
and *what changing it will do* before it offers anything to click. Honest security
posture copy is part of the design: where the product has no RBAC, the UI says so rather
than implying chrome it does not have. Product direction lives in
[`PRODUCT.md`](PRODUCT.md).

## Token source

- Family value layer: `tokens/css/bytedesk.css` from this repo, consumed from the
  mounted submodule at `.context/design-system`.
- Consumer token root: the Admin UI's embedded stylesheet. The console is
  server-rendered, CSP-safe, and ships zero external assets, so the token CSS is
  **inlined at build time** from the submodule; a generated header names the
  design-system commit it came from. The stylesheet declares local aliases over `--bd-*`
  and nothing else.
- Product accent: **Vault amber**, resolved by `data-bd-product="vault"` on the root
  element. Components read `--bd-accent`, never the hex.
- Validation: `go build ./...` and `go test ./...` plus `gofmt`. The build step that
  inlines the token CSS fails the build if the submodule is missing — a hand-copied
  palette is a regression, not a fallback.
- Foundation value changes land in this repo first (shared `DESIGN.md` §8); Vault then
  re-pins the submodule and rebuilds.

## Visual language

**Palette roles.** The family dark ground: `--bd-bg-base` for the page canvas,
`--bd-bg-subtle` for desk panels and the app bar, `--bd-bg-surface` for raised controls
and ghost buttons, and the darkest step for sunken wells — inputs and token reveals.
Hairlines and row rules use `--bd-border-dimmer`; hover, focus, and active borders step
up to `--bd-border-stronger` / `--bd-border-strongest`. Text runs `--bd-text-primary` →
`secondary` → `tertiary`, with `--bd-text-disabled` for placeholders.

- **Vault amber** (`--bd-accent`): product identity — the product mark, the org chip,
  section headers, and the active state of navigation and selection. Used sparingly.
- **Interactive blue** (`--bd-interactive-blue`): links, focus rings, and the fill on
  primary action buttons.
- **Semantic ok / warn / danger** (`--bd-success` / `--bd-warning` / `--bd-danger`):
  enrollment state, token expiry, posture banners, and errors. Status only.

**The one-accent rule.** Identity colour occupies well under 10% of any screen.
Neutrals carry structure; the accent marks what this product is, and interactive blue
marks the next step.

**The accent–status separation rule.** Vault's product accent and the family warning
colour are the same amber (`--bd-product-vault` and `--bd-warning` resolve to the same
value). Because of that, this console must **never** rely on amber alone to mean
"caution": a warning is always a dot **plus a word**, and the accent never appears as a
bare status dot. Where an identity amber and a status amber would sit in the same row,
the identity use gives way. The security posture banner is a warning surface, not an
identity surface — it is `--bd-warning` with explicit words, not the product mark.

**The no-pure-black/white rule.** Never `#000` or `#fff`. Every neutral comes from the
family ramp, which is tinted by construction.

**Typography.** IBM Plex Sans (`--bd-font-sans`) for all UI chrome — labels, headings,
body, buttons. IBM Plex Mono (`--bd-font-mono`) **only** for machine identifiers and
secrets in flight: gateway IDs, client IDs, enroll tokens, timestamps. The mono/sans
split is the console's primary legibility signal: if a value came from the system, it is
mono. Micro-labels are tracked; prose stays under ~75ch.

**The Plex-only rule.** Do not introduce a second UI sans (Inter, Roboto, system-only)
for chrome. Fallbacks in the `--bd-font-*` stacks exist only for when the Plex files
fail to load, and fonts are self-hosted — never fetched from a third-party CDN.

**Density.** Operational admin density, tighter than the family marketing default:
control and row heights around 30–32px, a compact spacing ladder inside groups, and
generous separation between sections. The ladder lives in the console's token aliases,
not in components. The console packs a lot of true rows onto one screen deliberately.

**Layout.** A sticky app bar (product mark and name left; org chip and utility links —
`/healthz`, JWKS — right) over a bounded content column of tonal panels. Sections are
separated by 1px rules. No nested panels inside panels for the same content block, no
brand gradient hero, no card grid.

**Elevation.** Vault uses a restrained calibration of the family Optical Layering
ladder: tonal base → subtle → surface → sunken well inside the structural shell. Keep
depth concentrated on the shell, sticky app bar, overlays, and active security
decisions; ordinary rows remain flat.

**Motion.** Restrained state feedback only: ~150ms on `--bd-ease-out-expo` for hover,
focus, and disclosure. Never animate layout properties. No page-load choreography.
`prefers-reduced-motion` is honored by the token layer.

## Component and composition rules

- **Buttons.** Gently rounded (`--bd-radius-md`), ~30px tall, 14px horizontal padding.
  Primary is an interactive-blue fill; ghost/secondary is `--bd-bg-surface` with a
  `--bd-border-dimmer` hairline. Focus is a 2px ring in `--bd-interactive-blue`.
  Disabled is 45% opacity with no pointer.
- **Inputs and fields.** Sunken well background, 1px quiet border, ~30px tall. Focus
  steps the border up and adds the ring; error uses a `--bd-danger` border with the
  message under the field, never colour alone.
- **Panels.** `--bd-bg-subtle`, `--bd-radius-lg`, 16px padding, 1px `--bd-border-dimmer`.
- **Tables.** Dense ~32px rows, muted uppercase column headers, hairline row rules only
  (no zebra striping), mono values, numerics right-aligned. The empty state is a single
  muted sentence inside the table body — never an illustration.
- **Status** is a small dot plus a word in the semantic colour. Never colour alone.
- **Security banner.** A warning surface: `--bd-warning` text on a low-opacity tint of
  the same, full 1px border, no left stripe. Used for the zero-admin-auth honesty notice
  and other posture statements.
- **Token reveal.** Sunken well, mono token, an explicit "shown once" label, optional
  ghost copy button.
- **Destructive actions** restate what will change before they commit, and say plainly
  when an action is reversible.
- Every primary list and form ships designed empty, error, and success states.

## Accessibility

Shared WCAG 2.2 AA foundation applies. Vault-specific requirements:

- Status, enrollment state, and posture banners never carry meaning by colour alone —
  see the accent–status separation rule above.
- Amber on the dark ground is used at label size or larger; it never carries small body
  prose.
- Mono identifier columns still meet contrast and minimum size at the console's dense
  scale. Density is never bought with unreadable type.
- Focus is always visible on the sunken-well surfaces, not just on panels.

## Exceptions to the shared foundation

- **Build-time inlined token CSS.** The console ships zero external assets and makes no
  CDN fetches, so it inlines rather than imports the family token CSS. The generated
  header naming the source commit is what keeps the copy accountable; hand-editing the
  inlined block is drift.
- **Admin density.** Vault runs tighter than the family default because it renders long
  identity and enrollment records. The ladder lives in the token aliases, not in
  components.

## Bans (absolute)

Restated colour literals — a hex code in this console is drift, not a decision. Neon
cyberpunk vault skins. HashiCorp-clone purple marketing chrome. Glassmorphism stacks.
Side-stripe accent borders (`border-left` > 1px as decoration). Gradient text.
Hero-metric SaaS tiles. Identical card grids. Third-party CDN fonts. Decorative motion
or page-load choreography. Fake RBAC chrome or any UI implying a control the product
does not enforce. The ADE lime/orange console accent as Vault's identity.
