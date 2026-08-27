---
name: bytedesk-designer-direction
description: "Establish the visual world of a product by generating and critiquing art direction: Claude briefs, the Codex CLI renders, Claude looks at the result and re-briefs until it lands. Use this whenever someone wants an image made, changed, or explored - moodboards, hero and header graphics, social and ad creative, illustrations, spot art, packaging, textures, or abstract pieces that establish how something should feel. Trigger it even when they never say Codex or image generation, as in a header graphic for the launch post, or that image is too busy redo it. Also covers variants of an existing image and edits to one they already have. Reads the design authority live for the palette, the product motif, and the rules on what generated art may be, rather than inventing a look. For logos, marks, and icons use the identity skill instead. Requires the Codex CLI installed and signed in."
license: Apache-2.0
metadata:
  suite: bytedesk-designer
  stage: direction
  produces: direction/ images, prompts, and per-round critique
  requires: codex-cli
---

# Art direction

Claude has a design eye and no hands. Codex has a native image tool and takes whatever
direction it is given. This stage puts them together: Claude directs, Codex renders,
**Claude looks at what came back** and directs again.

The critique step is the whole point. Anyone can pipe a sentence into an image model. What
makes this worth running is that Claude *sees* the returned PNG, judges it against the
brief, and knows which single thing to change next.

Read `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md` and `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md` before the first handoff of a session. This file assumes both.

## Preflight

```bash
command -v codex && codex --version
```

If Codex is missing or signed out, **stop and say which**, with the matching fix. If it is
installed and working but unreachable, repair it for this run only and say what you did —
`${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md` has the three states. There is
no fallback that produces an image, and a stage that quietly went ahead would file an
artifact whose provenance header is a lie. Offer to write the art direction anyway so the
operator can run it themselves — but do not write it into the run folder as though the
stage completed.

## Read the authority first

Before anything else, resolve the design authority and read it. Not for inspiration — for
three specific things, and the third one decides whether the image should exist at all:

1. **The palette and ground**, live from the token file. Never a remembered value.
2. **The product's motif** from its profile — the image language this product uses, and
   the directions already rejected. Regenerating an idea somebody judged last quarter is
   the most avoidable failure here.
3. **The generated-art contract** from the foundation. This is a boundary, not a
   suggestion.

`${CLAUDE_PLUGIN_ROOT}/references/authority-contract.md` covers resolution, the authority
order, and what to do when a request crosses the contract's line. The short version, since
it is easy to get wrong and expensive to get wrong: generated raster is **exploration**. It
carries no logos, no product copy, no fake controls, no invented metrics, no functional
icons, no rasterised UI. When a request crosses that line, don't refuse flatly and don't
quietly produce the forbidden thing — say which part is out of bounds, offer the form that
works, and **pair it with a direction piece** so the operator gets both answers they came
for: what it will be, and what it will feel like.

If there is no authority at all, say so once and offer `bytedesk-designer-authority`. Do
not invent a palette and proceed; a look invented here will be contradicted by the first
real token file and everything built on it thrown away.

## The loop

### 1. Interview, briefly

Two or three sharp questions cost seconds and save whole rounds. The ones that change the
output:

- **What is this for, and where will it be seen?** A favicon, a 1200×630 OG card, and a
  conference banner are different objects, not one object at three sizes.
- **Is there an existing look to match?** A site, a previous image, a style profile.
- **What must be in it, and what must not?**

If they've already said enough, don't interrogate them. Read `references/art-direction.md`
before writing the first brief.

### 2. Write the brief

`direction/brief.md` carries the reasoning; the prompt carries the instruction. These are
different documents and both matter. "This needs to read at 32px, so the mark has to
survive losing all interior detail" belongs in the brief and nowhere near the prompt.

Name the **register** explicitly — see the register section in `references/art-direction.md`.
A brief that doesn't say which kind of good it wants gets the model's average of all of
them, which is the stock look.

### 3. Hand off

One invocation, one image. On round 1, generate **two or three genuinely different
directions**, not three variations on one idea — the operator usually doesn't know what
they want until they see the wrong thing beside the right one.

Write each prompt to `direction/prompts/r1-a.txt` before running it. A prompt that exists
only in a shell history is a result you cannot reproduce.

### 4. Look at it

Read each returned PNG so it **enters context as an image**. Then critique it against the
brief — `references/critique.md` has the pass, in disqualifying-first order, and the
failure patterns image models reliably produce.

Say what you see honestly. "This one is fine" when it isn't wastes a round and erodes the
operator's trust in your eye, which is the only thing making this better than prompting
directly. If all the directions failed, say so, and say *why* you think they failed —
that diagnosis is what makes round 2 different rather than another roll of the dice.

Record every viewed file in `state.json` under this stage's `viewed` list. Nothing may
appear in `artifacts` that is absent from `viewed`.

### 5. Revise, one axis per round

**Change one axis per round.** Alter palette, composition, and rendering style at once and
even a better result teaches you nothing transferable — you cannot back out the change that
hurt. Hold everything that worked *verbatim* and move one thing.

Three rounds is a ceiling, not a quota. Stop early when it's good; burning rounds on an
image the operator already likes is a worse outcome than stopping at one. If round 3 still
misses, stop and say what you'd try next — at that point the brief is wrong, not the
prompt, and another roll will not find it.

This is not hypothetical. A piece briefed as "parallel tracks at differing completion"
converged on a literal progress bar over two rounds, each round more literal than the last,
because the brief itself described a chart. The fix was a new brief, not a fourth prompt.

## Contact sheet

Once a round has more than one image, write `contact-sheet.html`: each variant, its prompt
underneath, its filename. Reference images relatively (`images/r1-a.png`) so the folder
stays portable. Dark neutral ground — images judged against white read as heavier than they
are.

Its job is comparison. Same display size for every variant, in a row, so differences in
weight and contrast are visible at a glance. Include a thumbnail strip, because a piece
that dies at 40px is a piece that fails.

## Provenance

`direction/notes.md` opens with the header from the run-folder contract, then carries the
critique per round. Under a governed authority this is required; everywhere else it is
still what stops a generated draft being mistaken six months later for an approved
decision.

## Style profiles

When the operator is producing a set — a campaign, a surface family, an ongoing brand —
write what you learned to `style-profiles/<name>.md` and reuse it. `assets/style-profile-template.md`
has the shape.

A style profile earns its keep by being **specific and negative**. "Warm off-white grounds,
never pure white" and "no drop shadows, ever" do more work than "modern and clean." Update
it when something is rejected — a rejection is a preference stated out loud.

**Never write authority values into a style profile.** Where a repository owns the tokens,
read them live each run. Style profiles are for taste no repo captures: composition habits,
rejected directions, prompt fragments that worked.

## When it goes wrong

Model-side behaviour — the mid-tone blue prior, the white-background prior for marks,
garbled text, log noise that isn't a failure — is in `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md`, along with what a real failure looks like. Two that belong here instead:

- **The image ignores a colour, or lands figure and ground backwards.** Extremely common.
  State both terms explicitly with a preposition and re-run; see the figure/ground note in
  `references/art-direction.md`.
- **Every variant is technically compliant and none is worth looking at.** The inverse
  failure, and the easier one to miss because it passes every other check. If a variant
  could be mistaken for a failed image load, it has failed — say so rather than shipping it
  as the disciplined option. Correctness is the floor, not the goal.

## Reference files

- `references/art-direction.md` — how to write a prompt that lands. Read before the first brief.
- `references/critique.md` — the pass for judging a returned image, and revision discipline.
- `assets/style-profile-template.md` — for taste no authority captures.

Shared contracts: `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md`, `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md`,
`${CLAUDE_PLUGIN_ROOT}/references/authority-contract.md`, `${CLAUDE_PLUGIN_ROOT}/references/run-folder-contract.md`.
