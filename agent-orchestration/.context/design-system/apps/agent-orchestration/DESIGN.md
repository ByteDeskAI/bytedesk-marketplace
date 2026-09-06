---
name: "Agent Orchestration"
description: "Agent Orchestration: many lines of work converging under one hand"
colors:
  canvas-dark: "#101316"
  shell-dark: "#171A1D"
  raised-dark: "#1D2125"
  ink-dark: "#E6E8EB"
  canvas-light: "#ECEDEF"
  shell-light: "#F8F9FB"
  raised-light: "#FBFCFE"
  ink-light: "#22252A"
  interaction-blue: "#047BF4"
  interaction-blue-light: "#255DA5"
  on-interactive-dark: "#101316"
  on-interactive-light: "#F4F7FD"
  brand-orange: "#EC4E02"
  success: "#029219"
  warning: "#DFA700"
  danger: "#E52222"
  info: "#1DB8CE"
  accent: "#C1BBFF"
  accent-light: "#5339A8"
typography:
  display:
    fontFamily: "\"IBM Plex Sans\", ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "40px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "\"IBM Plex Sans\", ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "normal"
  body:
    fontFamily: "\"IBM Plex Sans\", ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "\"IBM Plex Sans\", ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0.04em"
  machine-text:
    fontFamily: "\"IBM Plex Mono\", ui-monospace, SFMono-Regular, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  full: "9999px"
spacing:
  0: "0px"
  1: "2px"
  2: "4px"
  3: "6px"
  4: "8px"
  5: "12px"
  6: "16px"
  7: "20px"
  8: "24px"
  9: "32px"
  10: "40px"
  11: "48px"
components:
  button-primary:
    backgroundColor: "{colors.interaction-blue}"
    textColor: "{colors.on-interactive-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 16px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.interaction-blue}"
    textColor: "{colors.on-interactive-dark}"
  button-ghost:
    backgroundColor: "{colors.raised-dark}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.md}"
    padding: "6px 16px"
    height: "32px"
  field:
    backgroundColor: "{colors.shell-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  status-badge:
    backgroundColor: "{colors.shell-dark}"
    textColor: "{colors.ink-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---
# Design: Agent Orchestration

## Overview

Agent Orchestration is the governed operator window for one delegated run across
Claude Code, Codex, Grok Build, and Kimi Code. It projects the durable hash-chained
journal and never becomes a second source of execution truth. Operators and reviewers
use it inside the plugin host; it is not a fleet dashboard. Register: product.

The creative north star is the Conductor's Desk: a full-screen shell whose central
assistant journal is the anchor, with live run metadata arranged around it. The
composition motif is many lines of work converging under one hand: dispatch and
convergence, never completion.

Personality: compact operational density, calm interruptible motion, balanced
richness, and a dimensional relay or loom handing agent strands through a conducting
core as the icon metaphor. Read after the shared foundation; this file names only
what Agent Orchestration adds.

## Colors

The accent is `--bd-accent` resolved through `data-bd-product="agent-orchestration"`.
It may mark the run identity and the product mark. Interaction, focus, and streaming
activity stay on `--bd-interactive-blue`. `--bd-brand-orange` is reserved for
actionable decisions and handoffs.

Run states carry a word: succeeded on `--bd-success`; waiting_for_decision,
recovery_required, and cleanup_required on `--bd-warning`; failed, timed_out, and
rejected on `--bd-danger`; created, queued, preparing, running, verifying,
cancelling, and cancelled on `--bd-info` or neutral ink. Never encode state by color.

Richness defaults to balanced and the user may change it. Both themes ship as one
interface with identical geometry.

## Typography

IBM Plex Sans for every interface surface. Identifiers, timestamps, permissions,
event names, provider and model names, monospace in the source profile, are Sans at
medium weight and the small size. Sequence numbers, timestamps, and durations use
tabular figures.

Machine-text content uses the family machine-text token `--bd-font-mono` on exactly
two surfaces: raw evidence output in the Evidence inspector, and code blocks inside
transcript entries. Nothing else uses monospace.

## Elevation

The conversation stays on the shell plane. Selected stages, decision cards, and open
inspectors rise one level to `--bd-bg-elevated`. The shell floats at 1600x900 or
1600x1200 with generous canvas around it. Glass is sanctioned for the shell perimeter
only.

Density is compact and operational. The breathing-room floor holds at rest; no
compaction mode is declared.

## Components

Layout: the center transcript distinguishes operator, host, broker, and provider
roles; the left stage rail is data-driven; the right rail holds Activity, Approvals,
and Evidence.

Signature components: handoff divider, decision card, evidence inspector, follow-up
composer, connection state, and two-step cancel.

Cover created, queued, preparing, running, verifying, waiting_for_decision,
cancelling, succeeded, failed, cancelled, timed_out, rejected, recovery_required,
and cleanup_required. A broken journal chain freezes at the last verified sequence
and visibly detaches. Unverified projection state is labeled, not smoothed over.

At narrow widths the transcript stays primary and both rails become labeled drawers.
Status and required human action never disappear.

Storybook stories and HTML mockups cover both themes, all richness levels, 1600x900
and 1600x1200, responsive drawers, keyboard and focus, reduced motion, every durable
state above, and empty, loading, error, offline, and destructive cancellation. The
approved references live at `mockups/operator-session-shell-v1/`
and are never runtime assets. No native shell adoption precedes approval of the
browser mockup.

## Do's and Don'ts

### Do

- Provide a complete keyboard path across stages, transcript, inspectors, decisions,
  composer, and cancellation.
- Announce durable stage, decision, terminal, and connection changes, not every
  streamed delta.
- Show the consequence of follow-up, approval, rejection, and cancellation before
  mutation and preserve provider attribution after it.
- Keep provider, model, run, workspace, and permission identifiers verbatim.

### Don't

- Never fabricate cost, token, tool, or provider activity.
- AG-UI may project journal events but is never the canonical execution store.
- No generic graph as the mark.
- No exceptions to the shared foundation.
- Generated art must never depict parallel tracks at differing completion. Rejected
  twice: both rounds became a progress bar, which is an interface element.
