# ByteDesk Shared Design Foundation

This document is the base layer inherited by every ByteDesk product profile. It governs how design truth is represented and consumed. As of the canonical-tokens change, the family shares one foundation value layer (`tokens/`) — ground, brand, type, and semantic values every product inherits — while density, visual genre, and product identity remain per-profile decisions.

This repository is the sole upstream design authority for the ByteDesk family. No
consumer product, including bytedesk.ai or Workforce, is an alternate source of brand,
token, asset, or visual-system truth. Consumer implementations can reveal a need and
provide evidence; the canonical decision still lands here before other products inherit
or reuse it.

## 1. Source-of-truth order

Every consumer reads, in order:

1. this shared foundation;
2. its selected `profiles/<product>/DESIGN.md` (with `profiles/<product>/PRODUCT.md` where present);
3. its root `DESIGN.md` for local implementation references and explicit exceptions.

Layers 1 and 2 are read from the managed delivery root at
`.context/design-system`, whether a legacy consumer still mounts the repository
as a submodule or a current consumer vendors the reviewed plugin payload. A
consumer sets `IMPECCABLE_CONTEXT_DIR=.context/design-system/profiles/<app>` so
its agents load that app's profile from the exact design-system source revision
recorded in the delivery root.

A local exception names the inherited rule it changes and explains why. Copying inherited prose into a consumer is not an override; it is drift.

A consumer's current implementation is not precedent by itself. Do not reverse-engineer
a shared rule from a shipped page, screenshot, or local asset. Propose the decision here,
place it at the narrowest owning layer, review it, and then update consumers.

## 2. Token-first implementation

Visual values route through the consumer's declared token root. Components do not invent colors, type sizes, spacing, radii, shadows, or motion values. A product profile identifies its actual token source and enforcement command.

Canonical family values live in `tokens/` (`bytedesk.tokens.json` is the source of truth; CSS and Tailwind adapters accompany it). A consumer's token root **maps to** these values rather than restating them as literals.

There is still no published runtime package: each runtime consumes the adapter
that fits it from `.context/design-system` at the recorded source revision. Web
runtimes `@import` the managed token CSS directly. Go-embedded admin UIs, which
ship zero external assets by design, inline the managed token CSS at build time
and stamp the source commit into the generated file. Either delivery transport
updates tokens and the design profile together. Products differentiate through
their assigned accent (`tokens/README.md` table) and profile-scoped decisions,
not by forking the foundation. A product needing a different foundation value
lands the change here first (§8).

## 3. Product identity is explicit

Shared ByteDesk brand assets live under `assets/brand/`. Product identity lives under `assets/products/<product>/` and `profiles/<product>/`. Do not substitute one product's icon, wordmark, palette, or component rules for another product's identity.

ByteDesk master marks, lockups, and organization-wide exports originate here. Product
marks originate here under their product directory. Consumer repositories use cataloged
exports and must not become the only storage location for an identity master or approved
variant.

## 4. Accessible by default

- Target WCAG 2.2 AA for shipped user interfaces.
- Keyboard access, visible focus, sufficient contrast, and reduced-motion behavior are design requirements.
- Color is never the only carrier of state.
- Motion communicates state or hierarchy; it does not block comprehension.

## 5. Operational clarity

Interfaces expose the state, consequence, and next action before decoration. Machine values use stable formatting. Status meanings remain consistent inside a product. Product-specific density and visual genre belong in its profile.

## 6. Asset integrity

Use cataloged assets only. Preserve aspect ratio, clear space, approved color variant, and accessible labeling. Do not recolor raster marks, trace new vectors from screenshots, or add untracked logo variants in a consumer.

Each asset records its source repository, source path, source commit, and SHA-256 checksum in `catalog.json`. Third-party assets require explicit license and attribution metadata before import.

## 7. Approved artifacts

Only durable, approved work products belong under `artifacts/`. Every artifact folder includes a README naming its product, owner, approval state, source, and intended use. Drafts remain in product workspaces until approved.

An accepted brand guide or identity system must preserve the curated research and
decision trail that produced it. Its artifact records the product evidence, design
hypotheses, concept rounds, rejected directions with rationale, selected direction,
authorship and tool provenance, approval date, and supersession history. Preserve enough
evidence for a future contributor to understand why the system exists without treating
every scratch iteration as canonical guidance.

The approved guide and the applicable `DESIGN.md` files are normative. Research and
decision records explain the reasoning; they do not silently create additional rules.

## 8. Change discipline

Design-system changes land here first. Consumer repositories adopt an exact
source revision through a reviewed managed-payload sync or a legacy
submodule-pointer update. Breaking profile or asset changes are called out in
`CHANGELOG.md`; silent floating updates are prohibited.
