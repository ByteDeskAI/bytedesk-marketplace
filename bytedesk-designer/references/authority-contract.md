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

## Which profile governs a run

Authority order says which *values* win. This says which *file* is read — a different
question, and one the order alone cannot answer once a product exists in a place the
authority has never heard of.

Resolve in this order and stop at the first hit:

1. **The run's own project.** Walk up from the run folder to the first directory holding
   **both** `project.json` and `DESIGN.md`. That `DESIGN.md` is the profile.
2. **The authority.** `profiles/<product>/DESIGN.md`, where `<product>` is the `product`
   field in the run's `state.json`. That string and the directory name are the whole join.
3. **Nothing.** Inherit the foundation, and say so.

Both files are required at layer 1 because either alone is ambiguous: a `project.json`
belonging to some unrelated toolchain sits higher up a great many trees, and a bare
`DESIGN.md` is what the authority root itself looks like.

**The project comes first because it is the thing being designed** — and because it is the
only side of this the suite may write to. Reversed, a new project named `gateway` would
quietly inherit the language of a stranger's `gateway` that happens to sit in the shared
authority, and nothing in the run would show that the substitution had occurred.

**The authority is read-only.** Under a solution it is typically a clone of a repository
the operator does not own. A run never adds a profile or a catalog entry to it; extending
an authority is a deliberate act in the authority's own repository, through
`bytedesk-designer-authority`.

**Runs outside a project are unaffected.** A run at `~/Pictures/claude-design/runs/…` walks
to the filesystem root, finds no project, and resolves at layer 2 exactly as before.

**The catalog is not consulted.** Resolution is by directory. Catalogs are an inventory,
they disagree about their own shape between authorities, and a product listed in neither
the catalog nor `profiles/` is invisible to every gate anyway — so reading one here would
add a failure mode without adding an answer.

**A template is not a profile.** A `DESIGN.md` still carrying its angle-bracket placeholders
has been created but not written; it resolves as layer 3 and reports that it did. Every
project starts in that state. Handing `<A thing seen, not an adjective>` to a renderer as
art direction is worse than inheriting the foundation, because it looks like a decision.

`scripts/authority-doctor.sh --product <id>` reports the resolution: `PROFILE:`,
`PROFILE-RESOLVED-BY: project | authority | inherit`, and `PROFILE-STATE:` when the file is
still a template. A run records the answer in `state.json` and in its provenance header, per
the run-folder contract — which profile governed the work is not recoverable afterwards
unless the run wrote it down.

## An unreachable authority is not a missing one

Resolution assumes the resolved path can actually be read. Under a solution that assumption
has a sharp edge: the authority sits at `<solution>/design-system`, a sibling of the project
repository rather than a file inside it, so any sandbox scoped to the project alone — an
isolated worktree for a write run, a container mount, a restricted-filesystem agent — has a
valid `.design-authority` pointing at a path that does not exist there.

That is a different condition from "nothing configured", and it must not degrade the same
way. A missing authority means inherit. An **unreachable** one means the values exist, are
governed, and simply could not be read — so inheriting silently produces work that looks
authored against the system and is not. Observed once already: an agent that could not reach
`../../design-system` substituted a stand-in stylesheet of invented tokens, disclosed the
substitution, and produced a surface in a colour nobody chose. Both mechanical gates passed,
because a grep for hardcoded colour sees custom properties either way and a used-versus-
defined diff compares the stylesheet against whatever sits at the vendored path.

So: **fail closed.** A stage that resolves an authority it cannot read stops and says
`AUTHORITY: unreachable` with the path it tried. It does not fall back to the foundation, and
it never writes its own token file. Whoever runs work in a sandbox is responsible for making
the authority reachable inside it.

The check that actually catches a substituted adapter compares the vendored file against the
authority's own, at the authority's real path — not against itself.

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
