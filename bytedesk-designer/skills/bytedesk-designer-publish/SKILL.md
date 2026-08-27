---
name: bytedesk-designer-publish
description: "Assemble finished design work into a browsable storybook that anyone can open: every surface rendered live, every direction piece beside the brief that produced it, provenance attached, and a manifest recording what came from where. Use this when design work is done and needs to be shared, shown, handed over, reviewed by people, or kept somewhere it will not rot - a storybook, a gallery, a contact sheet, a design index, a handoff package. Also use it to add newly finished work to a storybook that already exists. Builds a static zero-dependency site that loads the design authority's real stylesheet, so what it shows cannot drift from what the system says."
license: Apache-2.0
metadata:
  suite: bytedesk-designer
  stage: publish
  produces: storybook/ and manifest.json
  requires: none
---

# Publish

The stage that turns a run folder into something a person can open. Everything before this
produced artifacts; this produces the thing you send someone.

It is the one member of the suite that does **not** require Codex. Assembly is mechanical
and judgement here is about pairing and provenance, not production. Say so rather than
running a preflight that has nothing to gate.

## What a storybook is for

Not archival. A storybook exists so somebody can answer three questions without asking
anyone:

1. **What does this look like?** — the surfaces, rendered live, not screenshotted.
2. **What was it trying to be?** — the brief, beside the thing it produced.
3. **Can I trust this?** — provenance, and whether it is approved or exploration.

A storybook that answers only the first is a screenshot gallery, and it goes stale the
first time a token changes.

## 1. Render surfaces live, never as images

Embed each surface in an `<iframe>` pointing at the real HTML file. Do not screenshot it
into the storybook.

This is the rule that keeps the storybook honest. A screenshot is a claim about how
something looked on the day it was taken; an iframe is the thing itself, loading the same
vendored stylesheet the surface loads. Change a token, re-vendor, and the storybook is
correct again with no work. Screenshot it and the storybook is confidently wrong forever.

Screenshots belong in the review record, where being a snapshot is the point.

## 2. Pair every artifact with its reasoning

A direction piece with no brief beside it is decoration. Each entry carries:

- the artifact
- one line of what it was for
- the prompt or brief that produced it, available but not shouting
- its provenance header
- its status — **exploration** or **approved**, and never blank

The status field is the one that matters six months out. An unlabelled generated image in a
shared folder becomes an approved design by default, because nobody remembers it wasn't.

## 3. Say which is accurate and which is feel

Where a surface and a direction piece both exist for the same thing, put them together and
label them. "The HTML is the accurate one; the image is the feel." Two sentences prevent the
most common misreading of a design handoff, where somebody builds against a generated
picture because it was prettier than the real page.

## 4. Build it static, with no dependencies

One HTML file per page, or one page with sections. No build step, no CDN, no framework, no
package.json. It must open from a `file://` URL in five years.

Load the design authority's stylesheet **directly** — the vendored copy the surfaces
already use — so the storybook's own chrome sits in the same system as its contents. A
storybook styled in something else quietly implies the system doesn't cover this case.

Give it a dark neutral ground unless the authority is light-first. Work judged against
white reads as heavier than it is.

**Navigation, minimally**: a list of surfaces, a list of direction pieces, and a jump to
each. A storybook that needs explaining has failed at its one job.

## 5. Write the manifest

`manifest.json` records what is in the storybook and where each thing came from:

```json
{
  "generated": "2026-08-27",
  "authority": { "path": "…", "sha": "9f3c1a7" },
  "entries": [
    { "kind": "surface", "path": "surfaces/settings.html",
      "brief": "brief.md#settings", "status": "approved" },
    { "kind": "direction", "path": "direction/images/r2-a.png",
      "prompt": "direction/prompts/r2-a.txt", "status": "exploration" }
  ]
}
```

Generate it **after** everything else is written, and if the repo commits it, regenerate it
after the commit rather than before. A manifest built from a working tree that then changes
records checksums for files that no longer exist — which is worse than no manifest, because
it looks authoritative.

## 6. Check it before handing it over

Three checks, all cheap, all catching things that are obvious once seen and invisible until
then:

- **Open it and look at it.** Every iframe loaded, every image resolved, nothing showing a
  broken-image glyph. A storybook is a page; the rule about viewing before promoting applies
  to it as much as to anything it contains.
- **Every link relative.** An absolute path to somebody's home directory works perfectly on
  the machine that made it and nowhere else. This is the single most common way a handoff
  package arrives broken.
- **Move the folder and open it again.** The fastest way to find an absolute path is to
  break it.

## Adding to an existing storybook

Read the existing manifest first. Append; do not regenerate the whole thing from scratch and
silently drop entries whose source files have moved. If an entry's source is gone, say so
and ask — a missing file is information, not a reason to quietly shorten the list.

## What this stage must never do

- **Never screenshot a surface into the storybook.** Iframe the real thing.
- **Never publish an artifact with a blank status.** Exploration or approved.
- **Never leave an absolute path in a published file.**
- **Never restyle the storybook outside the authority.**
- **Never publish without opening it.**

## Reference files

At the plugin root: `run-folder-contract.md` (what exists to publish, and the provenance
header), `authority-contract.md` (which stylesheet to load).
