# Design — ByteDesk Task Management

Canonical design profile for the `task-management` dashboard shipped by
`bytedesk-marketplace`: the operator console for AI coding-agent task management. Read
this after the shared ByteDesk foundation and before the dashboard's local
`styles/tokens.css` adapter.

## Product stance

**Creative north star: "The Claim Board."**

Task management is a live board over a git-tracked markdown store. Claude, Codex and
Grok sessions and the humans steering them plan work, claim it, block it, prove it and
finish it here, and every one of those verbs is a file the store already wrote. The
dashboard is not a Jira clone and not a KPI-tile admin template: it is an instrument
that shows who holds what, why a card stopped, and what the next unblocked thing is —
at a glance, on any width, without a mouse.

Product direction lives in [`PRODUCT.md`](PRODUCT.md).

## Token source

- Consume the vendored family CSS at `.context/design-system/tokens/css/bytedesk.css`,
  delivered by `bd-design sync` into the consuming repository.
- Local aliases live in the dashboard's `styles/tokens.css` as `--tm-*` roles; components
  consume those semantic variables and never copy a foundation value.
- Product scope is `data-bd-product="task-management"` on `<html>`. The scope
  **inherits** the Gateway accent: `--bd-accent` resolves to `--bd-product-gateway`, the
  family interaction blue. No product accent is minted — the board is an operator
  console, and its identity is its density and its motif, not a colour.
- The default experience is dark. `data-bd-theme="light"` is the equal counterpart and
  both must preserve WCAG 2.2 AA. Dark richness is not exposed; the board runs at the
  family default.
- Validation: `node .bytedesk/design-system-check.mjs` in the consumer, and a grep that no
  colour, radius, spacing or motion literal exists outside `styles/tokens.css`.

## Visual language

**Accent.** Interactive blue is the sole general action colour: focus, primary actions,
links, the live-write pulse. Orange stays reserved for the ByteDesk mark. Status is never
carried by the accent.

**Signature icon metaphor.** The claimed card: one plate among many resting ones, lit
along one edge. A claimed task is the only element on the board with edge-light; every
other card is unlit material.

**Status vocabulary.** The six store statuses, always dot plus word, never colour alone:

| Store status | Word | Semantic role |
|---|---|---|
| `backlog` | backlog | neutral, `--bd-text-tertiary` |
| `open` | todo | neutral, `--bd-text-secondary` |
| `in_progress` | in progress | `--bd-info` |
| `blocked` | blocked | `--bd-danger` |
| `parked` | parked | `--bd-warning` |
| `done` | done | `--bd-success` |

Each role uses its `-bg` and `-line` companions for chips and rails. Priority is a word
and a glyph, not a colour. Liveness (a session writing right now) is the accent pulse plus
the word `live`.

**Typography.** IBM Plex Sans carries titles, bodies, navigation and forms. IBM Plex Mono
carries every machine value: entity ids (`TM-014`, `EP-002`, `ADR-0007`, `CAP-0001`,
`SP-001`), SHAs, PR numbers, timestamps, paths, branch names, session ids, worktree
paths, points and counts. The Sans/Mono ratio is roughly 80/20 on the board and 60/40 in
inspectors and the activity timeline, where machine values dominate.

**Density.** Operational console — denser than Marketplace. Base type 14px, 28px controls
and 24px chips on pointer devices, `--bd-size-hit-target-touch` below 720px. Cards show
id, title, status, and at most one row of chips; everything else lives in the inspector.

**Layout.** A slim navigation rail, a command bar, the canvas, and one lifted inspector on
the right. The canvas is the board (columns, or epic lanes), the backlog, the graph, or a
timeline. Entity routes open the inspector over the list they came from; on tablet it is a
slide-over sheet, on phone it is the whole screen. No card-on-card and no nested panels.

**Surface and depth.** Depth lives at the shell boundary and on the inspector
(`--bd-shadow-shell`). Cards are flat plates with a hairline; only the claimed card is
lit. Menus and dialogs are the only elevated surfaces.

**Motion.** 120–180ms opacity and translate on `--bd-ease-out-expo` for state changes,
column moves and inspector open/close. The live-write pulse is the only looping motion
and it is information, not decoration. Reduced motion removes the pulse and every
transition.

**Voice.** Terse and imperative. A refusal shows the CLI's own wording verbatim — the
board never paraphrases a gate. Empty states say what to do next in one line.

**Domain composition motif.** One claimed card among many resting ones.

## Component and composition rules

- Screens compose the shell (rail, command bar, canvas, inspector) and domain organisms;
  they contain no styling decisions. Shared primitives are domain free.
- Every card is a focusable list item with a roving tabindex and an accessible name that
  carries what its chips show. Columns are lists; digits move the focused card.
- Status, priority, liveness and claim state are chip primitives with dot plus word.
  Colour alone never communicates a status, a claim, a refusal or an offline write.
- The inspector is a sticky identity header (id, status, holder, epic, title) over one
  scrolling body grouped by rules; the body contains its own scroll and never chains to
  the canvas.
- Gated writes (done, claim, steal, worktree remove, doctor fix, sweep, override) use a
  consequence sentence and explicit confirmation. Refusals appear inline at the control
  and in the live region, with the server's wording.
- Commands render in copyable mono blocks with the launcher path stated
  (`.bytedesk/task-management/bin/tm …`, `/task-management:<skill>`).
- Loading skeletons match the board, list and inspector shapes. Empty, offline, queued,
  refused, stale, foreign-entity and gate-blocked states are designed first-class
  surfaces.
- Charts (burndown, throughput, cycle time, the dependency graph) use `--bd-chart-*`
  series and strokes only, carry axes and labels, and degrade to a table below 720px.
- Use Lucide icons only, to aid scanning; never one per label.

Gated HTML mockups, each at 390, 1024 and 1440 widths, in dark and light parity, with
keyboard focus visible, reduced motion, and empty / loading / offline / refused /
destructive states: **Board**, **Backlog**, **Task**, **Epic**, **Graph**, **Timeline**,
**Sessions**, **Health**, **Settings**.

## Accessibility

- WCAG 2.2 AA in both themes, at 200% zoom, and with reduced motion.
- The whole write surface is keyboard operable: column walk, card move, open, create,
  search, palette, bulk select. `?` lists every binding and the sheet is generated from
  the handler's own map.
- Focus moves to the inspector heading on open and returns to the opening card on close.
- A polite live region announces write results and other sessions' status changes;
  every result also persists inline.
- Truncated ids, paths and reasons retain an accessible full value and a copy action.
- Tables have semantic headers and a stacked representation below 720px.

## Exceptions to the shared foundation

None.

## Bans

Task management does not use hero metric grids, KPI tiles as decoration, progress
rings without numbers, gradient text, icon soup, fake terminal chrome, avatars as the
only holder indicator, colour-only status, `window.prompt` data entry, or rasterized
mockups as UI.

## Generated art

The family contract is [`DESIGN.md` §10](../../DESIGN.md) — read it first. It holds the
invariants: unlifted dark ground, exactly one lit element, accent as edge-light or
contained glow and never a fill, matte with fine grain, composition that breathes, and
the hard limit that generated art carries no logos, copy, controls, invented metrics,
functional icons, or rasterized UI.

This section supplies the half that must not be shared.

**Motif — One claimed card among many resting ones.**

A field of identical flat plates at rest on the dark ground, loosely gridded like a
board seen from above. Exactly one plate is lifted a few millimetres and lit along a
single edge — the claim. Nothing points at it; the lift and the edge-light are the whole
statement.

**Accent:** Gateway blue (inherited; no product accent assigned), read live from
`tokens/`. Never sampled from a rendered image.

**Watch for:** The resting plates must read as the same object as the lit one. If the
lit plate differs in shape or size the piece is about a hero, not about a claim, and the
board idea disappears.

A piece that would work equally well for another ByteDesk product has failed this
section, however good it looks.
