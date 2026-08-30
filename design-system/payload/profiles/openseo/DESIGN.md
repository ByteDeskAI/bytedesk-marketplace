# OpenSEO - Design

## Product stance

OpenSEO is a campaign observatory: Black Glass frames clear search evidence,
comparisons, and agent collaboration without becoming a wall of interchangeable
analytics cards.

## Token source

Consume `.context/design-system/tokens/` and set `data-bd-product="openseo"`.
Support exact dark/light geometry and all governed dark richness levels.

## Personality

- **Icon:** an anthropomorphic search lens whose iris is a rising analysis graph;
  avoid a generic magnifier, globe, or marketing megaphone.
- **Density:** analytical and comparative, with whitespace around the next action.
- **Depth:** evidence stays on the working plane; agent plans and drill-down details
  rise only while active.
- **Motion:** crisp filtering, ranking change, and agent handoff; never imply live
  data where a provider response is cached or pending.
- **Voice and type:** evidence-led, with Mono for queries, URLs, ranks, dates, costs,
  provider IDs, and structured agent events.
- **Motif:** a search aperture aligning evidence, trend, and recommended action.

## Components and states

Cover research, rankings, competitors, backlinks, audits, AI visibility, provider
cost/consent, saved projects, agent chat/activity, evidence citations, and export.
Distinguish fresh, cached, stale, queued, running, partial, rate-limited, unauthenticated,
unavailable, and failed data. AG-UI may carry agent events but product records and
provider results remain canonical.

Storybook and HTML mockups cover every route and state in both themes, all richness
levels, responsive widths, keyboard/focus, reduced motion, empty projects, permission
and billing boundaries, long-running analysis, and destructive resets before adoption.

## Accessibility

Charts require tables or equivalent summaries, rank change includes direction and
value, and filters, agent activity, and evidence remain fully keyboard operable.

## Exceptions to the shared foundation

None.

## Generated art

The family contract is [`DESIGN.md` §10](../../DESIGN.md) — read it first. It holds the
invariants: unlifted dark ground, exactly one lit element, accent as edge-light or
contained glow and never a fill, matte with fine grain, composition that breathes, and
the hard limit that generated art carries no logos, copy, controls, invented metrics,
functional icons, or rasterized UI.

This section supplies the half that must not be shared.

**Motif — Two positions compared.**

OpenSEO frames evidence rather than stacking interchangeable cards. Two solid bars at different heights, the upper lit and slightly forward, the lower plainly present and unlit.

**Accent:** product.openseo teal, read live from `tokens/`. Never sampled from a rendered image.

**Watch for:** Round 1 rendered soft tapering wedges fading into the dark, so it read as a gradient rather than a comparison. Both terms of a comparison must be legible.

A piece that would work equally well for another ByteDesk product has failed this
section, however good it looks.
