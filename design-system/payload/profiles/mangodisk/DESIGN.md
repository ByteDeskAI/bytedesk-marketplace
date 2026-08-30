# MangoDisk - Design

## Product stance

The interface is an explorable storage landscape inside a restrained Black Glass
shell. Depth communicates directory hierarchy and selection consequence; it never
makes destructive cleanup feel playful or automatic.

## Token source

Consume `.context/design-system/tokens/` and set `data-bd-product="mangodisk"`.
Support exact dark/light geometry and all governed dark richness levels.

## Personality

- **Icon:** an anthropomorphic disk platter with a readable scanning “eye” and
  layered storage rings; avoid a trash can as the primary identity.
- **Density:** high-information analysis with calm review and confirmation zones.
- **Depth:** optical layers map storage hierarchy; keep base depth restrained.
- **Motion:** measured scan/reveal transitions; deletion and cleanup never use
  celebratory motion before verification.
- **Voice and type:** safety-first, with Mono for sizes, paths, rule IDs, and history.
- **Motif:** concentric capacity rings resolving into a navigable treemap.

## Components and states

Cover capacity overview, treemap/list, scan scope and progress, large files,
duplicates, cleanup rules, applications, protected paths, selection impact,
preflight, confirmation, execution, verification, partial failure, and history.
Storybook and HTML mockups require both themes, all richness levels, responsive
layouts, keyboard/focus, reduced motion, empty disks, permission denial, cancelled
scan, unavailable volume, and every destructive state. Tauri adoption waits for
explicit browser mockup approval.

## Accessibility

Treemaps require synchronized hierarchical tables and keyboard navigation. Sizes,
risks, and protection are textual, and destructive focus returns predictably.

## Exceptions to the shared foundation

None.

## Generated art

The family contract is [`DESIGN.md` §10](../../DESIGN.md) — read it first. It holds the
invariants: unlifted dark ground, exactly one lit element, accent as edge-light or
contained glow and never a fill, matte with fine grain, composition that breathes, and
the hard limit that generated art carries no logos, copy, controls, invented metrics,
functional icons, or rasterized UI.

This section supplies the half that must not be shared.

**Motif — A landscape whose depth is hierarchy.**

MangoDisk makes storage explorable and makes deletion feel consequential. Nested plateaus stepping up and back, each level a lighter graphite, one carrying an edge-light — the level currently selected.

**Accent:** product.mangodisk orange, read live from `tokens/`. Never sampled from a rendered image.

**Watch for:** Scale should read large and the material solid. Anything playful undercuts a product whose main action is destructive.

A piece that would work equally well for another ByteDesk product has failed this
section, however good it looks.
