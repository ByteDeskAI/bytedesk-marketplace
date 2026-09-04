---
name: "ByteDesk Task Management"
description: "ByteDesk Task Management: one claimed card among many resting ones"
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
  accent: "#047BF4"
  accent-light: "#255DA5"
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
# Design: ByteDesk Task Management

## Overview

Task Management is the dashboard of the `task-management` plugin shipped by
`bytedesk-marketplace`: a live board over a git-tracked markdown store where Claude,
Codex, and Grok sessions and the humans steering them plan, claim, block, prove, and
finish work, every verb a file the store already wrote. It is not a Jira clone and not
a KPI-tile admin template; it shows who holds what, why a card stopped, and what the next
unblocked thing is, on any width, without a mouse. Register: product.

Creative north star: "The Claim Board." The composition motif is one claimed card among
many resting ones. Personality: compact density, calm motion, balanced richness, and the
claimed card as the signature icon metaphor, one plate among many lit along one edge.
Read after the shared foundation in `foundation/DESIGN.md`; this file names only what
Task Management adds or changes.

## Colors

`--bd-accent` resolves through `data-bd-product="task-management"`, which inherits the
Gateway accent (`--bd-product-gateway`, the family interaction blue) while still carrying
its own scope. No product accent is minted: the board is an operator console and its
identity is its density and motif, not a colour. Interactive blue is the sole general
action colour: focus, primary actions, links, and the live-write pulse. Orange stays
reserved for the ByteDesk mark. Status is never carried by the accent.

Status vocabulary, always dot plus word, one per store status:

- `backlog` reads "backlog", neutral on `--bd-text-tertiary`.
- `open` reads "todo", neutral on `--bd-text-secondary`.
- `in_progress` reads "in progress" on `--bd-info`.
- `blocked` reads "blocked" on `--bd-danger`.
- `parked` reads "parked" on `--bd-warning`.
- `done` reads "done" on `--bd-success`.

Each role uses its `-bg` and `-line` companions for chips and rails; status, priority,
liveness, and claim state are chip primitives, dot plus word. Priority is a word and a
glyph, never a colour. Liveness (a session writing now) is the accent pulse plus the word
"live". Dark is default, light the equal counterpart. Richness runs at the family default.

## Typography

IBM Plex Sans for every interface surface: titles, bodies, navigation, forms, and every
machine value. Entity ids (`TM-014`, `EP-002`, `ADR-0007`, `CAP-0001`, `SP-001`), SHAs,
PR numbers, timestamps, paths, branch names, session ids, and worktree paths are Sans
with weight and size doing the work. Points, counts, and every numeric column use
tabular figures. Base type is 14px.

The only machine-text surface is the copyable command block, which states the launcher
path (`.bytedesk/task-management/bin/tm ...`, `/task-management:<skill>`). It uses the
family machine-text token (`--bd-font-mono`) and nothing else does.

## Elevation

Depth lives at the shell boundary and on the inspector (`--bd-shadow-shell`). Cards are
flat plates with a hairline; only the claimed card is lit. Menus and dialogs are the only
elevated surfaces. Glass is sanctioned on the shell only.

Operational console density, denser than Marketplace: 28px controls and 24px chips on
pointer devices, `--bd-size-hit-target-touch` below 720px. Cards show id, title, status,
and at most one row of chips; everything else lives in the inspector. Layout is a slim
navigation rail, a command bar, the canvas, and one lifted inspector on the right. The
canvas is the board (columns or epic lanes), the backlog, the graph, or a timeline.
Entity routes open the inspector over the list they came from; on tablet it is a
slide-over sheet, on phone the whole screen. No card-on-card and no nested panels.

Motion is 120 to 180ms opacity and translate on `--bd-ease-out-expo` for state changes,
column moves, and inspector open and close. The live-write pulse is the only looping
motion and it is information, not decoration. Reduced motion removes the pulse and every
transition.

## Components

- Screens compose the shell and domain organisms with no styling decisions of their own.
- Card: a focusable list item with roving tabindex and an accessible name carrying what
  its chips show. Columns are lists; digits move the focused card. States: resting,
  claimed (edge-lit), live, blocked, parked, stale, foreign-entity, selected.
- Inspector: a sticky identity header (id, status, holder, epic, title) over one
  scrolling body grouped by rules; the body owns its scroll and never chains to the
  canvas.
- Gated writes (done, claim, steal, worktree remove, doctor fix, sweep, override): a
  consequence sentence and explicit confirmation. Refusals appear inline at the control
  and in the live region, in the server's own wording.
- Charts (burndown, throughput, cycle time, dependency graph): `--bd-chart-series-*`
  and chart strokes only, with axes and labels, degrading to a table below 720px.
- Lucide icons only, to aid scanning, never one per label. Voice is terse and
  imperative; a refusal shows the CLI's wording verbatim and the board never paraphrases
  a gate. Empty states say what to do next in one line.

Gated HTML mockups and stories, each at 390, 1024, and 1440 widths, in dark and light
parity, with keyboard focus visible, reduced motion, and empty, loading, offline,
queued, refused, stale, foreign-entity, gate-blocked, and destructive states: Board,
Backlog, Task, Epic, Graph, Timeline, Sessions, Health, Settings. Loading skeletons
match the board, list, and inspector shapes.

## Do's and Don'ts

### Do

- Hold WCAG 2.2 AA in both themes, at 200% zoom, and with reduced motion.
- Make the whole write surface keyboard operable: column walk, card move, open, create,
  search, palette, bulk select. `?` lists every binding, generated from the handler's
  own map.
- Move focus to the inspector heading on open and back to the opening card on close.
- Announce write results and other sessions' status changes in a polite live region,
  and persist every result inline.
- Keep an accessible full value and a copy action behind every truncated id, path, or
  reason.
- Give tables semantic headers and a stacked representation below 720px.

### Don't

- No hero metric grids, KPI tiles as decoration, progress rings without numbers,
  gradient text, icon soup, fake terminal chrome, avatars as the only holder indicator,
  colour-only status, `window.prompt` data entry, or rasterized mockups as UI.
- Never invent state, metrics, or ordering the store does not carry.
- No exceptions to the shared foundation are declared.
- Generated art must never let the lit plate differ in shape or size from the resting
  ones. If it does, the piece is about a hero, not a claim, and the board idea
  disappears.
