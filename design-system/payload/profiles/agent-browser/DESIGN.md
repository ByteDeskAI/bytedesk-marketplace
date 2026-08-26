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
