---
name: bytedesk-designer-identity
description: "Design a logo mark, app icon, or favicon and ship it as a real asset kit rather than a picture of a logo. Use this whenever someone wants a logo, a mark, a wordmark, a brandmark, an app icon, a favicon, or a set of icons - made, revised, or explored. Generates two or three concepts with the Codex CLI to find the idea fast, then redraws the winner as SVG by hand and delivers a vector master, a PNG size ladder, a favicon carrying sizes drawn at size, ground variants, and a proof showing it at 16px where marks actually die. Exists as a separate stage because image models have an unbreakable white-background prior for marks and cannot produce exact geometry. Requires the Codex CLI installed and signed in."
license: Apache-2.0
metadata:
  suite: bytedesk-designer
  stage: identity
  produces: identity/ asset kit
  requires: codex-cli
---

# Identity

Marks are the one place in this suite where the generate-and-critique loop stops halfway,
and following it to the end produces a worse result than not using it at all. Understand
why, because the reasoning is what makes the split correct rather than arbitrary.

A mark is a **vector object**. Its value is exact geometry, exact colour, a transparent
ground, and clean behaviour at 16px. An image model gives you none of those. It also has an
essentially unbreakable **white-background prior** for marks: five consecutive renders put
the mark on white despite explicit hexes, explicit negatives, and four restatements. You
cannot prompt your way out of that, and burning rounds trying is how a good session becomes
a frustrating one.

So split the job at its natural seam: **generate to think, draw to deliver.**

Read `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md` and `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md` first.

## Preflight

```bash
command -v codex && codex --version
echo "Reply with exactly: OK" | timeout 60 codex exec --skip-git-repo-check -s read-only -
```

**The second line is the one that matters.** `--version` does not start a session, so it
does not load the MCP servers declared in `~/.codex/config.toml` — it returns cleanly on a
machine where every real invocation hangs. A preflight built on it passes, and the arc then
fails several minutes in, which is precisely what failing at preflight is supposed to
prevent. Measured on a real machine: `--version` exit 0, `codex exec` timed out at 120s.

Use `${CLAUDE_PLUGIN_ROOT}/scripts/codex-exec.sh` for every invocation rather than calling
`codex exec` directly. It carries the bounded retry described below.

**Preflight the authority in the same breath**, unless this stage genuinely has no authority
to read:

```bash
${CLAUDE_PLUGIN_ROOT}/scripts/authority-doctor.sh
```

`CONNECTED` and you may proceed, recording the sha it reports. `NOT-CONFORMING` or `none`
and you stop, exactly as for a missing Codex — a stage that guesses at values produces work
that looks finished and is wrong.

This was a real gap, not a hypothetical one: authority resolution used to happen inside each
stage rather than at the gate, and across one sweep five runs silently adopted a repository
that two others correctly refused. Same machine, same repository. The only variable was the
working directory.

Missing or signed out: **stop and say which**, with the fix. If it is on the machine and working but simply unreachable — a broken shim, a
half-finished upgrade — that is the third state: repair it for this run only, say
what you did, and record the version you actually invoked. See
`${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md`. Concept exploration is where
generation is genuinely unbeatable — it produces ideas faster than anyone can draw them —
and skipping it means drawing the first idea you had, which is rarely the right one.

## Under a governed authority

Identity-critical marks usually come from a catalogue, not from a generator. Read the
authority first: if the product already has a mark, this stage is for *variants, sizes, and
missing formats*, not for a new one. Say so rather than quietly producing a competitor to
the real mark.

Exploration is exploration whether it's raster or vector. A generated concept board is
fine; a generated thing that could be mistaken for the actual mark is not.

## 1. Brief the mark

Three questions, and the third one is the one people forget:

- **What is it for?** A favicon, an app icon on a home screen, and a mark on a conference
  banner have different floors. The smallest use decides the design.
- **What does it need to say?** One idea, not three. A mark carrying three concepts carries
  none.
- **Where will it be smallest, and on what ground?** Both grounds, if it will appear on
  light and dark.

Then write the constraint that governs everything: **it reduces to a single silhouette, no
more than two colours, and it is legible at 32px.** Write it into the brief so the critique
has something to fail against.

## 2. Generate to think — Codex as hands

Round 1 exactly as the direction stage runs it: **two or three genuinely different
concepts**, one invocation each, viewed and critiqued.

Judge **concept and silhouette only**. Ignore colour and ground entirely — they are not
real yet, and the model will get both wrong regardless of instruction. A critique that
spends its attention on a white background that was never going to be anything else has
spent its attention on nothing.

What to actually judge:

- **Does it reduce?** Squint, or look at the thumbnail. What remains is the mark. If it
  dissolves, the concept is too detailed to be a mark, however good it looks at full size.
- **Is it one idea?** Two ideas fused is the most common generated-mark failure and it
  looks sophisticated at 512px and illegible at 32.
- **Is it a cliché?** The category defaults — a swoosh, a hexagon, a gradient orb, an
  abstract letterform, a sparkle for anything AI — arrive unbidden. Name them when they
  appear.
- **Could it be redrawn?** Most marks worth shipping are geometric enough. If the winning
  concept is genuinely painterly, photographic, or textural, say so and treat the raster as
  the deliverable — but check first, because "it can't be redrawn" is usually a reflex
  rather than a finding.

## 3. Draw to deliver — Claude

Once a direction wins, **redraw it as SVG yourself**. Most marks are a handful of paths,
and the winning concept is usually simpler than the render made it look.

Write the SVG by hand:

- A `viewBox`, no fixed width/height, so it scales.
- Colours as literal hexes from the authority's tokens — an SVG asset is distributed
  standalone and cannot rely on CSS custom properties resolving.
- Paths, not embedded raster. An SVG wrapping a PNG is a PNG.
- Optically centred, not mathematically centred. They differ, and the eye notices.

## 4. Ship the kit

A mark is not a file, it's a set. Deliver all of it:

```
identity/
  mark.svg              vector master, hexes editable
  mark-light.svg        for light grounds
  mark-dark.svg         for dark grounds
  mark.png              1024 512 256 128 64 48 32 16
  favicon.ico           48 / 32 / 16, each drawn at its own size
  proof.html            the mark at 16px in a mock browser tab
```

**Each favicon size is drawn at size**, not downsampled from one image. Downsampling is why
most favicons are a grey smudge: the hinting that makes a 16px mark legible has to be done
deliberately, and at that size it often means removing a feature entirely rather than
shrinking it.

`proof.html` is what makes this a kit rather than a folder. It shows the mark at 16px in a
mock browser tab, at 32px in a mock dock, and on both grounds. **Render it and look at it.**
A mark that dies at 16px is a mark that fails, and 16px is exactly the size nobody checks.

## 5. Record it

Provenance header in `identity/notes.md`, per the run-folder contract, plus the concepts
that lost and why. That list is what stops the same rejected mark being regenerated next
quarter — and marks get re-explored more often than anything else in a brand.

## What this stage must never do

- **Never deliver a raster as the mark.** Unless it genuinely cannot be redrawn, and say so
  explicitly when claiming that.
- **Never spend a round fighting the white-background prior.** It is a known model
  behaviour, not a prompting failure. Redraw or composite.
- **Never downsample one image to make the favicon.** Draw each size.
- **Never ship without viewing `proof.html` at 16px.**
- **Never produce a new mark for a product whose authority already catalogues one**, unless
  that is explicitly what was asked.

## Reference files

Shared contracts: `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md`, `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md` (the
white-background prior and image retrieval), `${CLAUDE_PLUGIN_ROOT}/references/authority-contract.md`,
`${CLAUDE_PLUGIN_ROOT}/references/run-folder-contract.md`.
