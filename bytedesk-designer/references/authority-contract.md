# The design-authority contract

This suite has **no taste of its own**. Everything it knows about how things should look
comes from a *design authority* — a repository the user owns, containing their tokens,
their per-product profiles, and their rules. The suite reads it live, every run.

That seam is the whole design. It is what makes the suite generic enough to hand to
anyone and specific enough to produce work that looks like *theirs*.

## Resolution order

Run `${CLAUDE_PLUGIN_ROOT}/scripts/authority-doctor.sh` — do not resolve by hand. It
implements exactly this, verifies what it finds, and reports which rule fired.

1. an explicit `--authority <path>` argument
2. a `.design-authority` file, searched from the working directory upward
3. nothing found → **stop**, and offer to connect or create one

**There is no rule that looks around.** There used to be — a conforming repo at
`../design-system` or `~/design-system` — and it was wrong twice over. It baked one
company's directory naming into a suite meant for anyone, and it made resolution depend on
where the terminal happened to be. Measured across one sweep: seven runs, same machine,
same repository, two different answers. Five adopted it by convention; two refused to reach
a repo they could see but could not legitimately resolve, and those two were right.

The doctor may still *notice* plausible authorities nearby and name them. It will never use
one. A repo found by directory name is as likely to be the wrong repo, and that failure
does not announce itself — it surfaces weeks later as colours nobody can explain.

Resolution happens once per run and the result is recorded in `state.json` with the commit
sha. Say which rule resolved it and which sha, every run.

## The `.design-authority` file

Plain text, one setting per line, **committed to the consuming repository** — so every
clone, every teammate and every CI job resolves identically instead of depending on a
working directory.

```
# how this repo finds its design system
path: ../acme-brand
```

`path` may be relative to the file or absolute. A remote may be recorded instead:

```
repo: https://github.com/acme/brand.git
ref: v2.1.0
```

Nothing in this suite clones for you. A `repo:` with no local `path:` is reported as
not-cloned, with the clone command — because cloning someone's design system into an
unnamed directory on their behalf is a decision they should make.

## Verifying, not assuming

Resolving is not the same as conforming, and the doctor checks both. It reports:

- **connected** — required pieces present, git-pinnable, its own validator passing
- **found but not conforming** — names what is missing and what degrades as a result
- **nothing configured** — offers to connect an existing authority or create one

A resolved path whose own `validate.mjs` fails counts as **not conforming**, and that is
deliberate. Internally inconsistent values are worse than absent ones: every stage reads
them confidently and produces work that is wrong in a way no downstream gate can see.

## What a conforming authority provides

```
DESIGN.md                       foundation: ground, light, type, spacing, motion,
                                and the generated-art contract
tokens/<name>.tokens.json       canonical values (DTCG-shaped or equivalent)
tokens/css/<name>.css           browser adapter + per-product scopes
profiles/<product>/DESIGN.md    per-product language, motif, accent, bans
catalog.json                    inventory of products with checksums
scripts/validate.mjs            the authority's own gates
```

Only `DESIGN.md` and one token file are strictly required. Everything else degrades
gracefully: no `profiles/` means every product inherits the foundation directly; no
`catalog.json` means the suite discovers products from the directory listing; no
`validate.mjs` means the suite reports what it would have checked rather than running it.

Degrading is not the same as guessing. A missing profile means *inherit*, never *invent*.

## Authority order

When two sources disagree, the more specific one wins:

```
root DESIGN.md  →  profiles/<product>/DESIGN.md  →  consumer-local overrides
```

A product profile may narrow the foundation; it may not contradict a family-wide rule. If
it appears to, that is a finding for the review stage, not a licence to pick one.

## The generated-art contract

This is the part most authorities don't have yet and most need. It answers a question that
comes up on the first run and never stops mattering: **what is generated raster art
allowed to be?**

A reasonable default, and the one `bytedesk-designer-authority` proposes when bootstrapping:

> Generated raster art is **exploration** — abstract visuals, moodboards, identity boards,
> non-critical texture. It must not contain logos or identity-critical marks, product copy,
> fake controls, invented metrics, functional icons, or rasterised application UI.
> Interfaces and icons are built in HTML/CSS against real tokens. A generated screenshot is
> not implementation source.
>
> Never read a colour value off generated art.

The user is free to reject or rewrite it. What matters is that the answer lives in *their*
repo, where their team can see it, rather than inside a skill.

### When a request crosses the line

Don't refuse flatly, and don't quietly produce the forbidden thing. Say which part is out
of bounds, and offer the form that works — an HTML surface screenshotted against real
tokens, or the catalogued mark.

**Then pair it with a direction piece.** A user who asked for a mockup and receives only a
dry token-accurate screenshot feels downgraded, and reasonably so: they came wanting to
*see something*, and correctness alone doesn't scratch that. One or two abstract pieces in
the same visual world — the mood, the texture, the light, the accent behaviour — carry no
controls or copy, so they stay inside the rules, and together the pair answers both
questions actually being asked: what will it be, and what will it feel like.

Say plainly which is which. "The HTML is the accurate one; these are the feel."

## Product surfaces and marketing surfaces are different rooms

A profile's restraint rules govern the **product**. An operator console scoring decorative
use at 3/10 is a rule about that console, where decoration competes with information and
loses. It is not a rule about the launch post, the OG card, or the conference banner.

Marketing and brand surfaces inherit the palette, the type, and the ground — and are
allowed to be striking. Flattening both into the same austerity produces on-system work
nobody wants to look at, which is its own kind of failure.

## Reading, not caching

Read token values live from the authority on every run. The single exception is the
vendored `surfaces/tokens/` copy, which exists because a static HTML page has to load CSS
from somewhere — and it carries `.source-sha` precisely so drift is detectable rather than
silent.

Never write an authority's values into a skill file, a style profile, or a prompt library.
Two copies of a palette is one copy too many.

## A worked example

`ByteDeskAI/design-system` is a conforming authority with 19 product profiles, a DTCG
token set with generated platform adapters, an accent-parity gate in `scripts/validate.mjs`,
and a family-wide generated-art contract at `DESIGN.md` §10. It is documented here as **one
example of the shape** — not a default, not a fallback, and none of its values appear
anywhere in this suite.
