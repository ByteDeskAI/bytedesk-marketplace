# The translate loop — prompt shapes and stopping rules

The point of this loop is to reach "done" in one build and one or two patches. Everything
below exists to avoid the two ways it gets expensive: rebuilding from scratch each round,
and changing things the diff did not name.

## Round 1 — build prompt (text mode)

```
Reply with the artifact only — no preamble, no explanation, no code fences.

Write a single self-contained HTML file for one application state. It loads the stylesheet
at ./tokens/design.css (relative path) and uses only its custom properties for every
colour: no hex, no rgb(), no named colours. Root element carries data-product="<id>".
Fonts: var(--ds-font-family) for chrome, var(--ds-font-mono) for paths, ids, versions, logs.
Fixed 1280×800 layout, overflow hidden on body; no responsive behaviour.

MEASUREMENTS (logical px — build to these, do not eyeball):
<the SPEC.md table for this layout>

STATE CONTENT:
<what each region shows in this state; real, plausible text; no lorem>

DO NOT BUILD (the mockup invented these):
<list from SPEC.md>

Available custom properties:
<the names, one per line, from the vendored sheet>
```

## Rounds 2–3 — patch prompt

```
Reply with the whole file only — no preamble, no explanation, no code fences.

Below is the current HTML. Make exactly the changes listed and nothing else; every other
rule and element stays byte-for-byte as it is.

CHANGES:
1. <region>: <property> is <wrong value>; make it <measured value>. (<why, one clause>)
2. …

FROZEN (already correct — do not touch): <regions>

CURRENT FILE:
<contents of surfaces/<state>.html>
```

Three or four changes per round. Each change is one region and one number. If you find
yourself writing "and also tidy up the header", stop — that is a new round's job, or no
one's.

## Choosing the hotspots

`report.json` lists eight. Take them in order but skip:

- cells whose difference is text rendering (the mockup's paragraph vs yours) — you can see
  it in `diff.png` as speckle inside a block, not an edge;
- cells on the stage image or any illustration;
- cells already frozen from a previous round unless the score there got worse.

What remains, top three or four, is the round.

## Stopping

Stop early when any of these holds:

- top remaining hotspot `lumDiff < 0.04` and layoutScore moved `< 0.005` since last round;
- the operator says it is good — a round spent on an image they already like is waste;
- round 3 finished.

If round 3 still shows a structural hotspot (an edge, not speckle), the measurement for
that region was wrong. Say so, re-measure on the grid, correct `SPEC.md`, and take one
more round as a disclosed exception. One. If it does not close, the report names the
region as unresolved; the operator decides whether it is worth more.

## Implementation gate

When a live URL exists, the surface and the implementation must load the **same**
stylesheet — the surface's vendored `tokens/` and the app's global sheet, or the surface
imports the app's sheet directly. Shoot both, compare with `--threshold 16`. Treat any
pixelDiff above 0.01 as a defect in the implementation: read the hotspot rects, find the
CSS rule in the app, match it to the surface's. Never edit the surface to match the app;
the surface was measured, the app was not.

## Provenance header for translate/notes.md

```
Tool: codex exec (<codex --version>), text mode, via scripts/codex-exec.sh
Date: <date>
Requested by: <name>
Mockup: <path> — <what produced it, and its prompt path if it was generated>
Authority: <repo> @ <sha> — tokens vendored to surfaces/tokens/ (.source-sha)
Logical size: 1280×800
Status: surface = measured translation; mockup = direction only, not a pixel source
```
