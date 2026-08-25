# ByteDesk Canonical Tokens

This directory is the shared **value layer** of the ByteDesk family: one dark-first
foundation (backgrounds, text, brand, semantic colors, borders, type, radii, motion)
plus a per-product accent map, published in three forms:

| File | Form | For |
|---|---|---|
| `bytedesk.tokens.json` | DTCG-style JSON | Non-CSS runtimes (egui/native, codegen, tooling) |
| `css/bytedesk.css` | CSS custom properties (`--bd-*`) | Any web runtime, including Go-embedded admin HTML |
| `tailwind/theme.css` | Tailwind v4 `@theme` adapter | Next.js / Vite React apps |

`bytedesk.tokens.json` is the source of truth; the CSS files must stay in sync with it.
Change values here first (Change discipline, shared `DESIGN.md` §8), then consumers
adopt via submodule pointer bump.

Consumers reach these files through the submodule mounted at `.context/design-system`.
The same mount also carries each app's design profile
(`profiles/<app>/DESIGN.md` + `PRODUCT.md`), so one pointer bump moves an app's tokens
and its design context together.

## The family contract

- **Ground**: every product surface starts from `bg.base #0F1017` and the shared ramp.
- **Brand**: orange `#EC4E02` is ByteDesk — conversion moments and brand marks only.
- **Interaction**: blue `#0079F2` — links, focus, affordances.
- **Product accents** identify products (marks, chips, card gradients, doc headers) and
  never replace semantic colors:

  | Product | Accent | Contrast on bg.base |
  |---|---|---|
  | Platform | `#EC4E02` (brand) | 5.1:1 |
  | Gateway | `#0079F2` | 4.5:1 |
  | Vault | `#DFA700` | 8.7:1 |
  | Store | `#009118` | 4.6:1 |
  | Workforce | `#A170EB` | 5.5:1 |
  | Agent Browser | `#1DB8CE` | 8.0:1 |
  | Agent Memory | `#EA5DA9` | 6.0:1 |
  | Capture | `#0A84FF` | 5.2:1 |

- **Type**: IBM Plex Sans (Plex Mono for code/terminal surfaces). Fluid scale on web,
  static px scale (the clamp minimums) on native.
- **Accessibility**: WCAG 2.2 AA. Contrast ratios above are computed, not estimated.
  Two flagged pairs: `text.on-brand` on orange is 3.0:1 (AA **large** only — CTA-size
  text) and `danger` on bg.base is 4.1:1 (pair with an icon/label; AA large as text).
- **Motion**: 150/250/400ms, `ease-out-expo`; consumers honor `prefers-reduced-motion`
  (the CSS zeroes the duration tokens automatically).

## Themeability

- Dark is the canonical theme. A light theme is a **reserved contract**: when designed,
  it will ship here as `[data-bd-theme="light"]` overrides of the same `--bd-*` names,
  so consumers that alias tokens get it for free. Do not invent per-product light themes.
- Product scoping: set `data-bd-product="<product>"` on any subtree; `--bd-accent`
  (and `--bd-accent-glow`, `--bd-shadow-glow-accent`) resolve to that product's accent.

## Consumption per runtime

**Tailwind v4 / Vite / Next.js app (bytedesk.ai, Workforce `ui/`, Gateway `web/`)** —
`@import` the two CSS files from the submodule mount in the root stylesheet:

```css
@import "tailwindcss";
@import "../../.context/design-system/tokens/css/bytedesk.css";
@import "../../.context/design-system/tokens/tailwind/theme.css";
/* local product tokens/utilities below — must reference --bd-* vars, not literals */
```

Importing from the mount is the contract; a vendored copy is a fallback for build
setups that cannot resolve outside the source root, and it must carry a header naming
the design-system commit it came from.

**Go-embedded admin HTML (Store, Vault)** — a **build step reads
`tokens/css/bytedesk.css` from the mount** and inlines it into the embedded stylesheet,
emitting a generated header that names the design-system commit. These UIs are
CDN-free and zero-dependency by design, so inlining — not importing — is how they
consume the layer; the build step is what keeps the inlined block from becoming a
hand-maintained palette. Style against `--bd-*` variables only, and never hand-edit the
generated block.

**egui / native (Capture)** — map from `bytedesk.tokens.json` at build or dev time:
`bg.base → Visuals.panel_fill`, `bg.surface → Visuals.widgets.inactive.bg_fill`,
`text.primary → Visuals.override_text_color`, `product.capture → selection/accent`,
radius `lg` (8px) for window/widget rounding, the static `type` scale for text styles.
Capture's existing profile accent `#0a84ff` is preserved as its family accent.

**Docs/marketing surfaces** — same as Tailwind or raw CSS var consumption; product
pages scope with `data-bd-product`.

## What this layer is not

- Not a component library. Components stay in products; this is values + contract.
- Not the brand asset store. Brand SVG masters currently live in the `bytedesk.ai`
  site repo (`public/brand/`); nominating them into `assets/brand/` requires either
  mirroring that repo into the ByteDeskAI org or amending the catalog provenance rule
  (`scripts/validate.mjs` accepts only `ByteDeskAI/*` sources) — flagged as an owner
  decision in `CHANGELOG.md`.
