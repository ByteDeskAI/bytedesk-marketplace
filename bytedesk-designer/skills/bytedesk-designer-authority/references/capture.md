# Capturing an existing look

Reverse-engineering a design authority out of something that already exists. Same output
as a bootstrap; the input is evidence rather than an interview.

## Sources, best first

**CSS custom properties.** Already a token set, usually already named by role. Grep for
`--` declarations in `:root`. This is the ideal case and it is worth looking for even in a
codebase that doesn't think it has a design system.

**A Tailwind config.** `theme.extend` is a token set in a different notation. Colours,
spacing, and the type scale transfer almost directly. Note that Tailwind's defaults come
along whether the team meant them or not — a value nobody chose is not part of their
system, and importing all of it produces a 200-token authority for a product that uses
nine.

**A Figma or DTCG token export.** Structurally closest, but exports carry every experiment
anybody ever made. Expect to cut most of it.

**A brand guide PDF.** Good for voice, type, and logo rules. Usually silent on the things
that matter for interfaces — borders, muted text, disabled states, elevation.

**A live site.** Read the stylesheet, not the pixels. `document.styleSheets` or just fetch
the CSS.

**Screenshots.** Last resort. See the warning below.

## Two failure modes

### Don't launder inconsistency into a system

A codebase with eleven greys does not have an eleven-step grey scale. It has drift — three
deliberate values and eight accidents, and no way to tell which is which from the file
alone.

Cluster them, propose the scale you would collapse to, and **record what was merged** so
someone can object. The value of a capture is the decisions it forces. An authority that
faithfully preserves every accident is a worse artefact than the codebase it came from,
because now the accidents have a spec.

Signals that a value is an accident rather than a decision: used once; differs from a
neighbour by less than 3%; appears only in one component; sits at a browser or framework
default while everything around it doesn't.

### Don't read values off rendered images

Eyedroppering a screenshot picks up JPEG artefacts, blend modes, opacity, and the browser's
own colour management. A `#0B0D10` ground under a 4% white overlay reads as `#15171A`, and
you will write that number down as if it were chosen.

Prefer source, always. Where an image is genuinely all there is, say the values are
approximate, mark them for confirmation, and do not let them into the token file without
someone saying yes.

The same applies with more force to generated art — see the handoff reference's note on the
mid-tone blue prior. A colour read off a render can be wrong by a lot while looking right.

## What evidence never contains

Some things cannot be captured and must be asked:

- **Why.** Every rationale line in `DESIGN.md` comes from a person. A captured authority
  with no reasoning in it is a values dump, and the first person to disagree with a
  decision has nothing to argue with.
- **Rejected directions.** Only somebody who was there knows.
- **Motif.** Generated-art language rarely exists in a codebase at all.
- **Bans.** The rules a team follows without writing down are exactly the ones a new agent
  breaks first.

So a capture ends with a short list of questions, not a claim of completeness. Say plainly
which parts came from evidence and which need a person.

## Sequence

1. Inventory every value found, with its source and use count.
2. Cluster and propose collapses; show what merged.
3. Map surviving values onto roles — ground, surface, text, muted, border, accent. A value
   that fits no role is a signal: either the role list is short, or the value is an
   accident.
4. Write the token JSON, generate the CSS, diff the generated CSS against the original
   stylesheet, and account for every difference. This diff is the real test of the capture
   and it routinely finds a value that was missed.
5. Write `DESIGN.md` with the reasoning you have and explicit gaps where you don't.
6. Write the questions.
