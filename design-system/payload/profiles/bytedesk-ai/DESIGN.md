# Design — ByteDesk.ai (suite marketing site)

Canonical design profile for `bytedesk.ai`, the public front door for the ByteDesk
product suite. Read after the [shared foundation](../../DESIGN.md); the consumer repo's
root `DESIGN.md` carries only local exceptions and enforcement commands.

## Product stance

A dark, technical marketing site that presents eight products as one operating suite
(host, agent, and delivery layers), promotes the free products as the way in, sells
paid tiers through checkout, and offers managed services for buyers who want outcomes
done for them.

Register: **brand**. Practical, technical, confident — an operating suite you install,
not a generic SaaS landing page. The committed color strategy is that **the dark ground
is the brand surface**; brand orange is spent only on brand and conversion moments.

Audiences and their journeys are defined in [`PRODUCT.md`](PRODUCT.md).

## Token source

- Family value layer: `tokens/css/bytedesk.css` + `tokens/tailwind/theme.css` from this
  repo, consumed from the mounted submodule at `.context/design-system`.
- Consumer token root: the site's `@theme inline {}` block in `src/app/globals.css`.
  Local `--color-*` names **alias** `--bd-*` values; they never restate literals.
- Product scoping: `data-bd-product="<slug>"` on a subtree resolves `--bd-accent` to
  that product's accent. The site is the one surface that legitimately renders all
  eight accents, because it renders all eight products.
- Validation: `npm run build` (type-check + lint gate). No separate design linter.
- Foundation value changes land in this repo first (shared `DESIGN.md` §8), then the
  site re-pins the submodule.

## Visual language

**Palette roles.** Ground is `--bd-bg-base`; section bands step through
`--bd-bg-subtle` / `--bd-bg-surface` / `--bd-bg-elevated` / `--bd-bg-overlay`. Text uses
the `--bd-text-*` ramp, rules use `--bd-border-*`.

- **Brand orange** (`--bd-brand-orange`, the Platform accent): ByteDesk identity and
  primary conversion only — *Install free*, *Buy*, *Book a Growth Consult*. Nothing else.
- **Interactive blue** (`--bd-accent-blue` / `--bd-info`): links, focus rings, selected
  states, secondary actions.
- **Semantic green / amber / red**: status only. Never decoration.
- **Product accents**: identity only — marks, chips, section headers, card edges on
  product pages. They never take over a semantic role or the orange conversion role.

**Typography.** IBM Plex Sans across the site (the committed family for the whole
suite; identity preservation wins over per-surface novelty). IBM Plex Mono **only** in
real code and terminal contexts: install one-liners, API snippets, product terminal
surfaces. Letter spacing 0. Fluid scale via the `--bd-text-*` tokens; hierarchy comes
from size and weight contrast, not from a second family.

**Density.** Marketing density, not console density — this profile is deliberately
looser than the Gateway, Vault, and Store operator profiles that share its tokens.

**Layout direction.** The suite reads as an operating stack, not a card catalog:

- The three-layer product stack as a structured, asymmetric composition; products get
  differentiated treatment by role (flagship band, compact rows), not identical cards.
- The install one-liner is a first-class hero element — real command, copy button.
- Operational panels: dense, readable, real product surfaces.
- Scenario walkthroughs as step sequences with product hand-offs made visible.
- Honest maturity chips (v0.x, self-host, beta) styled as system metadata.

Sections alternate dark / light / gradient in a deliberate rhythm rather than a uniform
dark page; each section declares its own theme so global chrome can adapt on scroll.

**Motion.** Operational and restrained: 120–300ms, `--bd-ease-out-expo`, scroll-scrub
reveals only where they clarify sequence. Status ticks, signal sweeps, progress fills,
route-line motion. `prefers-reduced-motion` is honored automatically by the token layer.

**Imagery.** Scene photography is permitted as art direction — real work scenes that
ground the products in the life they serve. One decisive photo per section that earns
it; never wallpaper, never image grids. Duotone/darken treatment toward `--bd-bg-base`
so photographs sit inside the dark system. Alt text is written in the site's voice.
**Photography is mood, never proof:** it must not imply customers, teams, or outcomes.

## Component and composition rules

- Components reference tokens or token-backed utilities, never one-off literals.
- Custom utility classes are the site's shared vocabulary (surfaces, cards, backgrounds,
  bento layout, marquee). Extend the existing vocabulary before inventing new CSS.
- Section chrome declares its own light/dark theme so the header can swap glass styles.
- Brand assets: clear space ≥ ¼ mark width; never stretch, skew, recolor, or add
  effects. Product marks come from this repo's catalog (`assets/products/<product>/`).

## Accessibility

Shared WCAG 2.2 AA foundation applies. Site-specific requirements:

- Brand-orange text is AA-large only — CTA-size text or paired with an icon/label.
- Every animated counter and scroll reveal degrades to its final state under
  `prefers-reduced-motion`; content is never gated behind motion.
- Alternating light and dark sections must each pass contrast independently; a token
  chosen for the dark ground is not assumed safe on the light band.

## Exceptions to the shared foundation

- **All eight product accents render on one surface.** Shared foundation §3 keeps
  product identity separated; the suite site is the deliberate exception, and it scopes
  every accent with `data-bd-product` rather than hand-picking colors.
- **Light sections and a complete light theme exist.** Section rhythm may still alternate
  tonal bands, while the complete page implements the shared `[data-bd-theme="light"]`
  contract with exact component and information parity.

## Bans

Fake proof of any kind (logos, testimonials, metrics, "trusted by" strips). Gradient
text as identity. Side-stripe accent borders (`border-left` > 1px as decoration).
Excessive glassmorphism beyond the family structural shell, frosted stacks, heavy blur. Purple-blue or teal gradient
themes; decorative orbs and bokeh blobs. Vague AI language without a workflow,
artifact, or operator outcome. Imagery as wallpaper or fake proof.
