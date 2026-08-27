---
name: bytedesk-designer-surface
description: "Build a real screen in HTML and CSS against a design authority's actual tokens, then render it, look at the screenshot, and fix what is wrong. Use this whenever someone wants to see a screen, page, or app view - a mockup, a wireframe made real, a landing page, a dashboard, a settings screen, an email template, a component in context - and whenever a generated image would have been the wrong tool because the thing needs real text, real controls, real data, and colours that are exactly right. Also use it to turn an approved direction or a screenshot into something buildable. The output is a page that loads the authority's stylesheet, so it cannot drift from the system it claims to follow. Requires the Codex CLI installed and signed in."
license: Apache-2.0
metadata:
  suite: bytedesk-designer
  stage: surface
  produces: surfaces/*.html and screenshots
  requires: codex-cli
---

# Surface

This is where the accurate artifact gets built. A generated image of a screen is a picture
of a screen: its text is garbled, its controls are decorative, its numbers are invented,
and its colours are approximately right in a way that cannot be relied on. A surface built
in HTML against real tokens is the actual thing at zero fidelity cost.

The rule that makes it worth doing: **the page loads the authority's stylesheet.** It does
not re-declare the palette, and it does not carry a hex anywhere in its own CSS. A mockup
that hardcodes colours is a mockup that will disagree with the product within a month, and
nobody will notice until it's in a deck.

Read `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md` and `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md` first.

## Preflight

```bash
command -v codex && codex --version
```

Missing or signed out: **stop and say which**, with the fix. If it is on the machine and working but simply unreachable — a broken shim, a
half-finished upgrade — that is the third state: repair it for this run only, say
what you did, and record the version you actually invoked. See
`${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md`. Codex writes the
implementations; Claude renders them, looks, and re-briefs. A surface Claude wrote and
judged alone has one opinion in it and a provenance header claiming two.

## Inputs

This stage needs `brief.md` (for what the surface is and who is looking) and a resolved
authority (for the tokens). If the brief is absent, refuse and name the stage that produces
it. If the authority is absent, refuse and name that one — a surface built against an
invented palette is worse than no surface, because it looks finished.

Direction pieces from `direction/` are useful input but not required. Where they exist,
read them: they carry the light, the texture, and the accent behaviour the surface should
be consistent with.

## 1. Vendor the tokens, once

Copy the authority's CSS adapter to `surfaces/tokens/` and write `.source-sha` with the
commit it came from.

This is the suite's one sanctioned cache, and it exists for a mundane reason: a static HTML
file has to load CSS from a path that will still work when the folder is zipped and emailed.
The `.source-sha` is what makes the copy honest — drift becomes detectable instead of
silent, and a page rendered six months ago can be explained.

Vendor. Do not retype. A hand-copied palette is the exact failure this stage exists to
avoid.

## 2. Decide what the surface actually shows

Before any markup, decide three things and write them into the brief for this surface:

**The state.** Populated with realistic data — not empty, not lorem, not the happy path
only. The state most worth building is usually the *awkward* one: the list with one item,
the name that's too long, the metric that's negative. A surface that only exists in its
best state hides every layout decision that matters.

**The focal hierarchy.** What the eye hits first, second, third. This comes from the
brief's "one thing" section. If three elements compete, the surface has failed before it
is written.

**The restraint level.** The authority's profile governs the *product*; marketing surfaces
inherit the palette and the type but are allowed to be striking. Decide which room you are
in and say so — flattening both into the same austerity produces on-system work nobody
wants to look at.

## 3. Hand off — Codex as hands

Give Codex the surface brief, the token names it may use, and the structure. Text mode,
one surface per invocation.

Two instructions belong in every prompt here, because they are what Codex gets wrong left
to itself:

- **Use only `var(--...)` for colour, spacing, radius, and type.** No hex, no `rgb()`, no
  pixel value that should have been a token. Give it the token list; it cannot read the
  file.
- **Semantic HTML, real text, no framework.** A single self-contained page linking
  `tokens/<name>.css`. No build step, no CDN, no placeholder text.

Ask for realistic copy in the product's voice, from the brief. Lorem ipsum makes every
layout look better than it is, because real text is uneven and lorem is not.

## 4. Render it and look at it

This is the step that makes this stage more than templating. Open the page in a browser and
**take a screenshot**, then read the screenshot so it enters context as an image.

Reading the HTML is not looking at the surface. Markup that is correct line by line
routinely renders as something nobody would ship, and you cannot see that in the source.

Then judge, in this order:

1. **Does it render at all?** A missing stylesheet path renders as unstyled text and is
   embarrassing precisely because it's obvious once seen.
2. **Squint test.** Blur it. What still reads is the actual hierarchy. If it turns to grey
   mush, the value structure is flat and no colour adjustment fixes it.
3. **Is the intended focal element the one the eye hits first?** Usually not, on round 1.
4. **Does the awkward state hold?** Long strings, empty lists, negative numbers, wrapped
   headings.
5. **Does it read as the product from the brief**, or as a generic admin template? The
   second is Codex's default gravity, and "naming it explicitly" means the list below, not
   a feeling. See *Named reflexes*.
6. **Narrow and wide.** Render at a phone width too, unless the brief says desktop only.

Record every screenshot in `state.json` under `viewed`. Nothing goes in `artifacts` that
isn't in `viewed`.

## Named reflexes

Generated interfaces have a house style, and it is recognisable. The reliable way to avoid
it is not to describe good design — every model already believes it is doing that — but to
**name the specific moves it reaches for by default and forbid those by name**.

Two rules govern this whole section:

**The authority always wins.** If a product's design system asks for something on this list,
it gets it. These are defaults to break, not laws. A skill that overrides someone's design
system has stopped being useful to them.

**Ban the move, not the element.** "No badges" is wrong — a badge carrying real state is
fine. "No badge whose only job is to say Live" is the actual rule. Every entry below is a
*decorative* use of something that has a legitimate one.

### The list

- **Eyebrow labels** — a small uppercase, letter-spaced line above a heading. The single
  most common tell, and the one this suite's own surfaces hit a third of the time before it
  was written down.
- **Ornamental section copy** — a page header like "Operational clarity without the
  clutter", or mini-notes explaining what the UI beneath them does.
- **Pill everything** — `border-radius: 999px` applied past the one or two places it belongs.
- **One radius everywhere** — the same rounded rectangle on the sidebar, the cards, the
  buttons and the panels, so nothing reads as a different *kind* of thing.
- **Glass panels** — `backdrop-filter` blur as the default surface treatment.
- **Decorative gradients** — gradient as a background, a border, or a brand mark. A gradient
  that encodes data is not this.
- **Dramatic shadows** — blur past roughly 20px, or coloured shadows, standing in for
  hierarchy that the layout should be carrying.
- **Hover transforms** — `translate` or `scale` on nav items and cards.
- **The metric-card grid as the opening move** — three or four KPI tiles across the top
  because that is what a dashboard looks like, rather than because those are the numbers.
- **Charts with nothing in them** — a donut with invented percentages, a sparkline that
  fills a gap. Fabricated data is separately banned above; this is the layout habit that
  invites it.
- **A hero block inside an internal screen** — real product reason or not at all.
- **Status dots via `::before`**, and nav badges that only ever say "Live".
- **A right-hand rail** holding "Today" or "Recent activity" that the information
  architecture never asked for.
- **Invented product voice** — labels like "live pulse", "night shift", "operator checklist"
  that appear nowhere in the brief.

### Say them before you build

Before writing the prompt, list what you would reach for on this surface if none of the
above existed — then don't. Writing the reflex down is what makes it visible; a rule you
have not consciously nearly-broken is a rule you will break.

Put the list in the prompt too. Codex is the one producing the markup, and a ban it never
saw is a ban that does not apply to it.

*The named-reflex list is adapted from [Uncodixfy](https://github.com/cyxzdev/Uncodixfy)
(MIT), narrowed to the entries that describe a generation habit rather than a house style.
Its palettes and its absolute colour and typeface bans are deliberately not carried over —
in this suite those decisions belong to the authority.*

## 5. Revise, one axis per round

Same discipline as everywhere in this suite: **one axis per round**, hold what worked
verbatim, three rounds is a ceiling. If round 3 still misses, the surface brief is wrong,
not the markup — say what you'd change about it rather than rolling again.

## 6. Verify against the authority

Before promoting, run two checks. Both are cheap and both catch real defects:

```bash
grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' surfaces/*.html
```

Any hit is a hardcoded colour that should be a token. There is no legitimate exception in a
surface file; if a value genuinely isn't in the authority, that is a finding for the
authority, not a licence to inline it.

Then check that every `var(--...)` used actually exists in the vendored stylesheet. A
typo'd custom property doesn't error — it silently falls back to nothing, and the element
renders transparent or unstyled in a way that is easy to miss on a busy page and impossible
to miss in a review.

**Then check the product scope is actually on the page.** Where the authority serves a
family from one stylesheet, the product's own accent lives in a `[data-product="…"]` block
and the root element has to carry that attribute for it to apply. Forget it and the page
renders in the *family* default instead — and this is the nastiest failure in this stage,
because the page uses `var(--...)` correctly, hardcodes nothing, passes both greps above,
and is still entirely the wrong colour. Two independent runs hit it on the same file.

Check it the only way that works: render it and compare the accent you see against the
token value you expect.

If the authority ships `scripts/validate.mjs`, run it too.

## What this stage must never do

- **Never hardcode a colour, a spacing value, or a font stack.** Vendor the tokens and use
  them.
- **Never ship a surface it has not rendered and viewed.** Correct-looking markup renders
  wrong constantly.
- **Never use lorem ipsum.** It flatters every layout it touches.
- **Never invent data that could be mistaken for real**, and put the marker *in the
  artifact*. This rule failed in testing — two independent runs produced entirely plausible
  fake figures — because "keep it obviously illustrative" is an adjective with no method,
  and because it fights the rule above it: the state has to look real or the layout isn't
  tested.

  Resolve it by separating shape from content. The **shape** stays realistic — long names,
  negative amounts, wrapping headings, empty sections — because that is what stresses the
  layout. The **content** must not survive being screenshotted into a deck: fictional
  entity names, figures that are visibly round or visibly absurd at the margin, and a line
  on the surface itself saying what it is.

  The marker goes in the page, not in your message. A mockup outlives the sentence that
  accompanied it — same reason the provenance header exists — and "I said it was fake" is
  no defence once the image is in a slide.
- **Never add a framework or a CDN link.** The page must open from disk in five years.

## Reference files

Shared contracts: `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md`, `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md` (text mode),
`${CLAUDE_PLUGIN_ROOT}/references/authority-contract.md` (the product/marketing distinction), `${CLAUDE_PLUGIN_ROOT}/references/run-folder-contract.md`
(the vendored-tokens rule and `.source-sha`).
