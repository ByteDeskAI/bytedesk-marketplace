---
name: bytedesk-designer-translate
description: "Turn an approved mockup image into a pixel-accurate HTML/CSS surface, and keep an implementation pixel-identical to that surface. Claude measures the mockup on a ruler grid and directs; Codex writes the markup; a screenshot-and-diff loop converges in as few rounds as possible. Use this whenever someone has a generated or drawn mockup (a codex render, a Figma export, a screenshot of another app) and wants it built for real, whenever they say the implementation 'doesn't match the mockup', 'isn't pixel perfect', or 'drifted from the design', and whenever a surface must be proven against a live URL rather than eyeballed. Requires the Codex CLI installed and signed in, and node with the Playwright CLI reachable through npx."
metadata:
  stage: translate
  requires: codex-cli, node, npx playwright
  produces: translate/SPEC.md, surfaces/<state>.html, translate/shots/*.png, translate/diff/*/report.json
---

# Translate: mockup → surface → implementation, measured

A mockup image is direction, not a pixel source. Image models redraw every rendering,
garble text and invent chrome; a Figma export flattens to its own pixel grid. So "pixel
perfect against the PNG" is not a number that reaches zero, and chasing it burns rounds.
What *can* reach zero is the gap between a token-accurate HTML surface and the
implementation that adopts its stylesheet. This stage makes both gaps small, in that order,
with the least work: **measure once, build once, diff, patch only what the diff names.**

Two numbers, two meanings — never swap them:

| comparison | number | ceiling | what it gates |
|---|---|---|---|
| surface ↔ mockup PNG | `layoutScore` (coarse luminance grid, tolerant of text and grain) | ~0.97 on a good translation; it never reaches 1.0 | "this surface *is* the mockup" |
| surface ↔ implementation URL | `pixelDiff` (strict per-pixel) | 0.0 — achievable because both load the same stylesheet | "the app has not drifted" |

Reporting a pixelDiff against a generated PNG as if it were the gate is the failure this
stage exists to prevent. It punishes the surface for the model's garbled microcopy and
tells the operator nothing they can act on.

## Division of labour

Claude has the eye and the ruler; Codex has the hands. Claude measures, decides what a
region's numbers are, hands Codex a brief with numbers in it, renders the result, looks,
and names the next change. Codex writes and rewrites the HTML. Codex never measures a
mockup (it cannot see the grid the way Claude does) and Claude never types the markup
(that is what produced 8/12 generic-interface tells when the orchestrator did it inline).

Preflight once per session, from `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md`:

```bash
command -v codex && codex --version
echo "Reply with exactly: OK" | timeout 60 codex exec --skip-git-repo-check -s read-only -
npx --yes playwright --version
```

Use `${CLAUDE_PLUGIN_ROOT}/scripts/codex-exec.sh` in **text** mode for every Codex call.

## Inputs

- The mockup PNG (one per state to translate). If it came from this suite it is under
  `direction/images/` or a mockups run; the prompt beside it tells you what is real and
  what the model invented.
- The design authority, resolved by `${CLAUDE_PLUGIN_ROOT}/scripts/authority-doctor.sh`.
  Vendor its CSS adapter into `surfaces/tokens/` with a `.source-sha` exactly as the
  surface stage does. The surface loads it; it carries no hex of its own.
- Optionally an **implementation URL** (a dev server, a Tauri window's Vite URL) and the
  stylesheet it uses. When given, the goal widens: the surface must also share that
  stylesheet, so the pixelDiff can be zero.
- The mockup's **logical width** — 1280 for a desktop app window, 1440 for a marketing
  page, whatever the surface will actually render at. Everything is measured in logical
  pixels; the grid script converts.

## The loop

Read `references/loop.md` before the first round; it carries the prompt shapes and the
stopping rules. The shape:

### 0. Measure once — `translate/SPEC.md`

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/bytedesk-designer-translate/scripts/grid.mjs <mockup.png> translate/grid-<state>.png --logical 1280
```

Read the gridded copy. Orange lines are 100 logical px, blue 20, thick white ticks 500.
Write the spec as numbers, not adjectives: column widths and their ratio, outer and inner
insets, row heights, control sizes, type sizes (cap height ≈ 0.7 × font size), radii,
which elements are lit and which are matte. Twenty to forty lines. Also write down what the
mockup **invented** — a title bar, hollow thumbnail slots, a stat panel — so it is not
built. A measurement written down once saves a round for every state that shares the
layout, which is why the spec is per layout, not per state.

### 1. Build once — Codex writes the surface

Hand Codex the spec, the vendored token sheet's custom-property names, the state's content,
and the rules from the surface stage (no hex, no rgb, `var(--…)` only, and the product-scope
attribute the authority's own stylesheet uses on the root — read the sheet; ByteDesk's is
`data-bd-product`, a scaffolded authority's is `data-product`). Text mode; artifact only.
Save to `surfaces/<state>.html`.

The spec must carry the **copy** as well as the numbers — every label, every row of
list content, every line of prose the state shows. A spec that says "a transcript" gets
Codex inventing one, and an invented transcript is a round spent removing it.

### 2. Render and compare

If the state contains an illustration or a stage image, mask its rect on both sides
(`--mask x,y,w,h`, repeatable) — the mockup's fog is not the surface's fog, and without the
mask every hotspot lands on it while the chrome you can actually fix goes unranked.

```bash
${CLAUDE_PLUGIN_ROOT}/skills/bytedesk-designer-translate/scripts/shoot.sh surfaces/<state>.html translate/shots/<state>-r1.png 1280x800
node ${CLAUDE_PLUGIN_ROOT}/skills/bytedesk-designer-translate/scripts/compare.mjs <mockup.png> translate/shots/<state>-r1.png translate/diff/<state>-r1
```

Read the screenshot **and** `diff.png`. The report's `hotspots` are the grid cells that
differ most, as logical rects. They are the work list — nothing else is.

### 3. Patch only the hotspots

For each hotspot (top three or four, never all eight), look at that region in both images
and decide the number that is wrong: "left column 340px, surface has 380"; "thumbnail
cards 110×110 with the label inside, surface has 96×64 below". Hand Codex the current file
and those numbered changes; ask for the whole file back with only those rules changed.
A round that changes five unrelated things teaches nothing when it fails.

### 4. Stop

Stop when the top hotspot's `lumDiff` is under 0.04 and the layoutScore has moved less
than 0.005 since the last round — the remaining difference is text and grain, and another
round is a coin flip. Three rounds is the ceiling. If round three still has a structural
hotspot, the spec is wrong, not the prompt: re-measure that region and say so.

### 5. Implementation gate (when a URL was given)

Put the implementation into the **same state** first — the same project selected, the same
panel open, the same data — or the diff measures absent content, not drift. A dev URL that
renders a blank body outside its native shell is a defect to report, not a gate result.

```bash
${CLAUDE_PLUGIN_ROOT}/skills/bytedesk-designer-translate/scripts/shoot.sh <url> translate/shots/<state>-app.png 1280x800
node ${CLAUDE_PLUGIN_ROOT}/skills/bytedesk-designer-translate/scripts/compare.mjs translate/shots/<state>-rN.png translate/shots/<state>-app.png translate/diff/<state>-app --threshold 16
```

`pixelDiff` is the gate here; 0.01 (one percent) is the most that should pass, and the
report says which rects carry the rest. Fix the implementation's CSS to match the surface —
not the other way round — because the surface is the one that was measured.

## What goes in the run folder

```
translate/
  SPEC.md                    the measurements, the invented-element list, the logical width
  grid-<state>.png           the gridded mockup that was measured
  prompts/<state>-r<N>.txt   exactly what Codex was handed, every round
  shots/<state>-r<N>.png     each round's render; <state>-app.png for the implementation
  diff/<state>-r<N>/         diff.png + report.json per round; <state>-app/ for the gate
  notes.md                   provenance header, then per round: hotspots chosen, change made, scores
surfaces/<state>.html        the deliverable, loading surfaces/tokens/
```

Record every screenshot you read in `state.json` under `stages.translate.viewed`, and the
final scores under `stages.translate.scores`. A surface whose diff you did not look at is
not translated; it is generated.

## Failure shapes worth knowing

- **Scores stall at ~0.9 with the top hotspot on a text block.** That is the model's
  paragraph versus real text. Not a defect; stop.
- **A hotspot sits on the stage image.** The mockup's fog is not the surface's fog. Put a
  neutral placeholder of the same luminance in the surface (`--ds-color-surface` block at
  the same rect) and the score stops lying about the chrome around it.
- **The surface matches but the app does not, and the diff is everywhere.** Fonts. The app
  and the surface must load the same families; a fallback family shifts every line box.
- **Codex "fixes" things you did not ask for.** Its rewrite drifted a region that was
  already right. Re-run the patch prompt with the untouched regions named explicitly as
  frozen — the loop reference has the wording.

Shared contracts: `${CLAUDE_PLUGIN_ROOT}/references/run-folder-contract.md`,
`${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md` (text mode),
`${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md`.
