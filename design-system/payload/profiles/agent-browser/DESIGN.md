# Agent Browser - Design

## Product stance

Agent Browser feels like a precise appshell around a living browser viewport. The
viewport is evidence, not decoration; connection chrome stays quiet until control,
identity, or recovery needs attention.

## Token source

Consume `.context/design-system/tokens/` and set
`data-bd-product="agent-browser"`. Use both themes with exact geometry and the
governed dark richness selector.

## Personality

- **Accent:** canonical Agent Browser cyan.
- **Icon:** an anthropomorphic appshell/window with a focused viewport “face”; avoid
  a generic globe or browser-company logo.
- **Density:** compact control chrome surrounding a generous evidence viewport.
- **Depth:** viewport and shell share the base plane; takeover, identity, and
  recovery controls rise only while active.
- **Motion:** quick and physical for connect, attach, takeover, and return-control;
  never simulate browsing activity.
- **Voice and type:** concise instrument labels with Mono for IDs, URLs, endpoints,
  timing, and connection state.
- **Motif:** nested frames showing agent control, browser surface, and human handoff.

## Components and states

Required components include session identity, live viewport, control owner,
connection quality, attach/takeover/return actions, identity creation, task evidence,
and failure recovery. Cover idle, allocating, connecting, connected, agent-controlled,
human-controlled, reconnecting, expired, failed, and unavailable states.

Storybook and HTML mockups cover both themes, all richness levels, responsive widths,
keyboard/focus, reduced motion, permission denial, offline/reconnect, and destructive
session termination. Do not invent a general dashboard. No native adoption precedes
explicit browser-mockup approval.

## Accessibility

Control ownership is always textual and announced when it changes. Viewport controls
remain keyboard reachable, focus cannot be trapped by the remote surface, and reduced
motion removes connection pulses without hiding state.

## Exceptions to the shared foundation

None.

## Generated art

The family contract is [`DESIGN.md` §10](../../DESIGN.md) — read it first. It holds the
invariants: unlifted dark ground, exactly one lit element, accent as edge-light or
contained glow and never a fill, matte with fine grain, composition that breathes, and
the hard limit that generated art carries no logos, copy, controls, invented metrics,
functional icons, or rasterized UI.

This section supplies the half that must not be shared.

**Motif — One lit aperture onto something live.**

The viewport is evidence and the chrome stays quiet. A single clean opening cut into inert dark, its interior luminous, everything around it frame.

**Accent:** product.agent-browser cyan, read live from `tokens/`. Never sampled from a rendered image.

**Watch for:** Only one aperture. Several turn a window onto live work into a wall of screens.

A piece that would work equally well for another ByteDesk product has failed this
section, however good it looks.
