# Agent Orchestration - Design

## Product stance

The interface is the **Conductor's Desk**: a full-screen Black Glass shell whose
central assistant journal is the visual anchor, with live run metadata arranged
around it. It must make a complex execution inspectable without turning the page
into a generic monitoring dashboard.

## Token source

Consume `.context/design-system/tokens/` and set
`data-bd-product="agent-orchestration"`. Dark and light use identical geometry;
dark supports `soft|balanced|rich`, with `balanced` as the default. Family blue
drives interaction and orange is reserved for actionable decisions and handoffs.

## Personality

- **Icon:** a dimensional relay or loom: distinct agent strands handed through a
  conducting core, optionally with an orange decision core. Never a generic graph.
- **Density:** compact and operational, with generous breathing room around the
  floating 1600x900 or 1600x1200 shell.
- **Depth:** conversation stays on the shell plane; selected stages, decisions,
  and inspectors rise one optical layer.
- **Motion:** deliberate and interruptible, tied only to real stages, handoffs,
  decisions, connection changes, and terminal outcomes.
- **Voice and type:** exact and neutral; use Mono liberally for identifiers,
  timestamps, permissions, event names, and evidence.
- **Motif:** a routed handoff weave around one stable conductor core.

## Components, states, and composition

The center transcript distinguishes operator, host, broker, and provider roles.
The left stage rail is data-driven. The right rail contains Activity, Approvals,
and Evidence. Include handoff dividers, decision cards, evidence inspection,
follow-up composer, connection state, and two-step cancel.

Cover `created`, `queued`, `preparing`, `running`, `verifying`,
`waiting_for_decision`, `cancelling`, `succeeded`, `failed`, `cancelled`,
`timed_out`, `rejected`, `recovery_required`, and `cleanup_required`. A broken
journal chain freezes at the last verified sequence and visibly detaches. AG-UI
may project journal events but is never the canonical execution store.

At narrow widths the transcript remains primary and both metadata rails become
labeled drawers. Status and required human action never disappear.

Storybook and HTML mockups must cover both themes, all three dark richness levels,
1600x900 and 1600x1200, responsive drawers, keyboard/focus, reduced motion, and
every durable state above. No desktop/native shell adoption precedes explicit
human approval of the browser mockup.

## Accessibility

Provide a complete keyboard path across stages, transcript, inspectors, decisions,
composer, and cancellation. Announce durable stage, decision, terminal, and
connection changes rather than every streamed delta. Never encode state by color.

## Exceptions to the shared foundation

None.
