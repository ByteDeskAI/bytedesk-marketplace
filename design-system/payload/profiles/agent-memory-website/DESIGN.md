# ByteDesk Agent Memory Website — Design

## Product stance

The Agent Memory website explains durable, permissioned memory infrastructure to
teams operating fleets of AI agents. It should make trust boundaries, ownership
tiers, storage choices, and integration surfaces understandable before it asks a
reader to deploy anything. The visual register is a precise technical field guide:
calm, inspectable, and grounded in real schemas, requests, and product behavior.

This profile governs the marketing website in `site/index.html`. The development
playground is a separate product surface and may use a denser workbench adapter.

## Token source

The consumer vendors the canonical ByteDesk token layer at
`.context/design-system/tokens/`. The token block in `site/index.html` maps its
local `--color-*`, spacing, type, radius, shadow, and motion names to `--bd-*`
values; it does not restate foundation values.

Use `data-bd-product="agent-memory"` on the page root so `--bd-accent` resolves
to the canonical Agent Memory product accent. The consumer integrity gate is:

```text
node .bytedesk/design-system-check.mjs
```

## Visual language

- **Ground:** predominantly light, quiet surfaces with dark, high-contrast text.
  A single dark technical band may hold code, trust-boundary proof, or deployment
  detail; dark sections are evidence surfaces rather than decoration.
- **Accent:** the Agent Memory product accent identifies links, focus, selected
  states, and the one emphasized phrase in a composition. It never replaces
  semantic success, warning, or failure colors.
- **Type:** a restrained sans family for display and prose. Monospace appears only
  for addresses, schemas, API/MCP examples, payloads, and measured telemetry.
- **Density:** explanatory sections breathe; diagrams, schemas, and integration
  examples may be dense when their structure remains scannable.
- **Status vocabulary:** granted, denied, scoped, recalled, stored, and unavailable.
  Every state pairs color with a label or icon.
- **Motion:** short reveals and state transitions may clarify sequence. Security
  boundaries, denial results, and code examples never depend on animation.

## Component and composition rules

- Lead with the trust model and the operational consequence, not an abstract AI
  claim. Show real ownership tiers, addresses, tool names, or deployment steps.
- Use diagrams to explain agent, department, organization, customer, and initiative
  boundaries. A boundary must remain legible without color.
- Code and protocol examples are real, copyable, and labeled by transport. Do not
  invent output, scale claims, customer proof, or benchmarks.
- Prefer progressive disclosure for the REST, MCP, SDK, schema, and storage-plugin
  surfaces. Keep the default view useful without requiring interaction.
- Cards group genuinely parallel concepts only. Do not turn a sequential security
  or deployment story into an interchangeable feature grid.
- Calls to action state the next concrete step: inspect the model, connect an agent,
  run the local service, or read deployment guidance.

## Accessibility

- Ownership and authorization diagrams require a text equivalent that states who
  can read and write each tier.
- Interactive examples use native controls, visible focus, and announced selected,
  expanded, granted, and denied states.
- Long code and address values wrap or scroll without hiding the surrounding label.
- Reduced-motion mode removes pointer effects, scroll-linked animation, and staged
  reveals while keeping every section visible.

## Exceptions to the shared foundation

None.

## Generated art

The family contract is [`DESIGN.md` §10](../../DESIGN.md) — read it first. It holds the
invariants: unlifted dark ground, exactly one lit element, accent as edge-light or
contained glow and never a fill, matte with fine grain, composition that breathes, and
the hard limit that generated art carries no logos, copy, controls, invented metrics,
functional icons, or rasterized UI.

This section supplies the half that must not be shared.

**Motif — Containment, with room to breathe.**

The site explains trust boundaries before asking for adoption, so it inherits the product's containment motif and gives it far more empty space. Marketing may breathe where the console may not.

**Accent:** product.agent-memory pink, read live from `tokens/`. Never sampled from a rendered image.

**Watch for:** Same idea as the product, different pacing. If it reads as dense as the workbench, the surface is wrong.

A piece that would work equally well for another ByteDesk product has failed this
section, however good it looks.
