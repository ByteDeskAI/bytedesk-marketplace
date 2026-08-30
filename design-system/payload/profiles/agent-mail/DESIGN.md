# Agent Mail - Design

## Product stance

Agent Mail is the **Intelligent Dispatch Desk**: a browser-based correspondence
instrument where a mailbox-scoped agent can inspect, search, organize, and draft
without obscuring the human communication at its center. It is not a generic
mail skin, an autonomous outbound agent, or a marketing site.

The signature workflow is **Routed Correspondence**: inbox to selected thread,
selected thread to agent-assisted draft, and draft to explicit human review.

## Approved visual authority

The approved dark and light inbox-with-agent references live at
[`mockups/inbox-agent-review-v1/`](mockups/inbox-agent-review-v1/README.md).
Browser and Storybook implementations match their composition, material,
hierarchy, and personality while retaining the normative product and
accessibility contracts here. Approved mockups are references, never runtime
image assets.

## Token source

Consume `.context/design-system/tokens/` and set
`data-bd-product="agent-mail"`. Dark and light use identical geometry. Dark
supports `soft|balanced|rich`, with `balanced` as the default. Family electric
cobalt identifies active correspondence and agent routing. Orange is reserved
for needs-attention and explicit human-review boundaries, never routine mail.

The consumer token root is `src/app/globals.css`. Local Tailwind or CSS names
alias `--bd-*` values and never restate literal color, spacing, type, radius,
shadow, or motion values.

## Personality

- **Icon:** a dimensional technical envelope whose folded flaps become three
  routed strands converging on a small orange approval seal. It may feel
  attentive through posture and geometry, but never becomes a robot head,
  cartoon mascot, generic envelope outline, or generic node graph.
- **Density:** compact in folders and message lists, calm in the reading plane,
  and slightly more expressive in the agent rail.
- **Depth:** mail content stays on the shell plane. The selected thread, active
  route, tool progress, and human-review boundary may rise one optical layer.
- **Motion:** short route pulses explain arrival, selection, tool handoff, and
  draft completion. Motion stops when the state is understood and is removed
  under reduced motion.
- **Voice and type:** clear, precise, and human. Use IBM Plex Sans for interface
  language and correspondence; use IBM Plex Mono for addresses, timestamps,
  message identifiers, tool names, and MCP URLs.
- **Motif:** routed correspondence converging on one governed approval seal.

## Primary composition

The desktop inbox shell uses four coherent zones separated by hairlines rather
than card gutters:

1. mailbox identity, compose, system folders, and custom folders;
2. folder controls and a compact conversation list;
3. the selected message or thread as the calm visual anchor;
4. the mailbox-scoped Agent and MCP inspector.

The agent rail remains visibly connected to the selected correspondence. Agent
tool calls show their actual name and durable state. A produced reply is a draft
for review with `Edit in composer`; the agent rail never presents automatic
send as an available action.

## Components and states

Cover the mailbox index, mailbox creation and deletion, folder navigation,
conversation list, selected message, expandable thread, attachments, rich
compose, search operators and results, settings, Agent/MCP tabs, tool progress,
draft review, and clear-chat confirmation.

Every data surface provides loading, empty, error, unavailable, and permission
states. Mail-specific coverage includes unread/read, starred, thread count,
attachment, related draft, needs reply, draft saving, draft saved, sending,
sent, send failed, attachment failure, agent connecting, streaming, stopped,
tool running, tool complete, tool error, and Access authentication failure.

Do not imply bulk operations, offline/PWA support, semantic search, delivery or
bounce truth, scheduled send, undo send, rules, labels, cloud sync, or autonomous
outbound mail unless the product contract later ships them.

At narrow widths the reading plane remains primary. Folder navigation,
conversation list, and agent inspector become labeled drawers or sequential
views; unread state, agent scope, and required human review never disappear.

Storybook and HTML mockups cover both themes, all three dark richness levels,
1600x900 and 1600x1200, responsive drawers, keyboard/focus, reduced motion, and
the operational states above.

## Accessibility

The shared WCAG 2.2 AA foundation applies. Provide a complete keyboard path
across folders, conversations, thread actions, attachments, compose, agent tool
results, draft review, and MCP details. Unread, selected, tool, and review states
never rely on color alone. Announce meaningful arrival, draft, send, tool,
connection, and authentication state changes without narrating streaming deltas
or stealing focus.

## Exceptions to the shared foundation

None.

## Generated art

The family contract is [`DESIGN.md` §10](../../DESIGN.md) — read it first. It holds the
invariants: unlifted dark ground, exactly one lit element, accent as edge-light or
contained glow and never a fill, matte with fine grain, composition that breathes, and
the hard limit that generated art carries no logos, copy, controls, invented metrics,
functional icons, or rasterized UI.

This section supplies the half that must not be shared.

**Motif — A scattered stream resolving into a still stack.**

Agent Mail sorts correspondence without hiding the human at its centre. Loose forms drifting at angles on one side, resolving into an aligned stack on the other, with one item in the stack lit — the one still needing a person.

**Accent:** product.agent-mail cobalt, read live from `tokens/`. Never sampled from a rendered image.

**Watch for:** The lit item belongs in the resolved stack, not the scatter. The product is what survives sorting, not the mess before it.

A piece that would work equally well for another ByteDesk product has failed this
section, however good it looks.
