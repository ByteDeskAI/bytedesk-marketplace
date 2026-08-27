---
name: bytedesk-designer-authority
description: "Create, audit, or extend a design-authority repository: the single source of truth for design tokens, per-product profiles, motif language, and the rules governing what generated art may be. Use this when someone wants to start a design system, set up design tokens, capture an existing look as a reusable system, add a product to one they already have, decide a product accent, or check whether their tokens, CSS and docs still agree. Also use it when another design task cannot find an authority to read, since nothing else in the suite can run without one. Bootstraps from nothing, from a scattering of existing brand values, or from a live site or screenshot to reverse-engineer. Produces a real git repository with a validator, not a document. Requires the Codex CLI installed and signed in."
license: Apache-2.0
metadata:
  suite: bytedesk-designer
  stage: authority
  produces: a conforming design-authority repository
  requires: codex-cli
---

# Design authority

Everything else in this suite reads what this skill produces. A design authority is a git
repository holding the values, the language, and the rules — the thing a team points at
when they argue about a colour, and the thing an agent reads instead of inventing one.

It is a **repository, not a document**. That distinction is the point: a document gets
copied into a deck and drifts. A repository has a commit sha, so a run six months old can
be explained, and a validator, so a rule that isn't followed is a build failure rather
than a disappointment.

Read `${CLAUDE_PLUGIN_ROOT}/references/authority-contract.md` for the shape a conforming
authority must have, and `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md` for how Claude and
Codex divide this work. Both are prerequisites, not background.

## Preflight

```bash
command -v codex && codex --version
```

Codex is required — it produces the candidate palettes, scales, and motif language that
Claude then judges. If it is missing or signed out, **stop and say which**, with the fix. If it is on the machine and working but simply unreachable — a broken shim, a
half-finished upgrade — that is the third state: repair it for this run only, say
what you did, and record the version you actually invoked. See
`${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md`.
Do not build the authority alone: a palette Claude picked unaided is a palette with one
opinion in it, and the header this skill writes would be claiming otherwise.

## First, find out whether one already exists

Do not create a second authority next to a first. Resolve in the order given in the
contract — `--authority`, then `.design-authority`, then `../design-system` and
`~/design-system` — and read what you find before offering to build anything.

Three situations, three different jobs:

| What you find | What this skill does |
|---|---|
| a conforming repo | **audit** — report what's missing or inconsistent, fix what's asked |
| design values scattered across a codebase, a Figma export, a brand PDF, a live site | **capture** — reverse-engineer them into a repo |
| nothing | **bootstrap** — build one from the product idea |

Say which one you're doing before you start. An operator who asked you to add a product
and watched you scaffold a fresh repo has lost their afternoon.

## Bootstrap

### 1. Interview — short, and about the right things

Three or four questions, not a form. The ones that actually change the output:

- **What is this for, and who is looking at it?** An operator console at 2am and a
  marketing site have opposite answers to almost every question below.
- **Light ground or dark ground?** Everything else hangs off this. Ask it first and ask it
  plainly; "either" is not an answer you can build on.
- **Is there anything to match?** An existing product, a competitor they admire, a
  screenshot, a hex they already use.
- **How many products will live under this?** One means a flat authority. Several means
  profiles and a family/product split from day one, and retrofitting that split later is
  genuinely painful.

If they've already told you enough, don't interrogate them.

### 2. Generate directions — Codex as hands

Hand Codex **two or three genuinely different foundations**, not variations on one. Text
mode; see the handoff reference for flags and prompt shape. Each returns a palette, a type
scale, and a spacing rhythm as plain values.

Divergence here is the whole value. A team rarely knows what it wants until it sees the
austere version beside the warm one.

Ask each for a *rationale line per decision*. You are going to write those into `DESIGN.md`
and they need to say why, not what — "warm off-white ground because the product is read
for hours and pure white fatigues" is worth keeping; "#F7F4EE" is already in the tokens.

### 3. Judge — Claude

Look at every returned foundation. Check what Codex reliably gets wrong:

- **Contrast.** Compute it; don't eyeball it. Body text under 4.5:1 against its own ground
  is a defect, not a style. Check the accent against *both* grounds if the system has two.
- **Coherence.** A palette whose accent belongs to a different system than its neutrals is
  the most common failure, and it looks fine in a swatch row and wrong in a layout.
- **Scale sanity.** A type scale with two steps 1px apart has a step that will never be
  used; a spacing scale that isn't a consistent ratio makes every future decision an
  argument.
- **Does it answer the ground question?** A "dark-first" palette with a light-grey ground
  didn't.

Then pick one and say why, in a sentence the user can disagree with. Take the best ideas
from the runners-up rather than discarding them whole — a losing palette often has the
right accent.

### 4. Write the repo

```
DESIGN.md                     foundation + the generated-art contract
tokens/<name>.tokens.json     canonical values, DTCG-shaped
tokens/css/<name>.css         :root custom properties + per-product scopes
profiles/<product>/DESIGN.md  one per product
catalog.json                  the inventory
scripts/validate.mjs          the gates
README.md                     how to consume it
```

Templates are in `assets/`. Fill them; don't ship them with placeholders in.

**`DESIGN.md` carries the reasoning, `tokens/` carries the values, and neither repeats the
other.** A hex written in prose is a hex that will disagree with the token file within a
month.

**Generate the CSS adapter from the token JSON**, mechanically, and say in the file that it
is generated. Two hand-maintained copies of a palette is the drift this whole suite exists
to prevent.

### 5. The generated-art contract is not optional

`DESIGN.md` gets a section stating what generated raster art may and may not be. The
contract reference carries a default worth proposing. Do not skip it because the user
hasn't asked — they haven't asked because they haven't yet had a generated screenshot
mistaken for an approved design, and this section is how that stays true.

Offer it as a proposal, in their repo, in their words, and let them cut it. What matters is
that the answer lives somewhere their team can read it.

### 6. Make the rules enforceable

`scripts/validate.mjs` is what separates an authority from a style guide. Ship it with at
least:

- **token parity** — every token in the JSON appears in the CSS adapter, and nothing
  appears in the CSS that isn't in the JSON
- **contrast** — every declared text/ground pairing meets its stated threshold
- **profile completeness** — every product in `catalog.json` has a profile, and every
  profile is in the catalog
- **accent declarations** — every product states whether it owns an accent, inherits one,
  or has none. Undecided is a legal state and must be *declared*, so it shows up in the
  output every run instead of being forgotten.

**Prove each gate by breaking the repo.** Introduce the failure it is supposed to catch,
confirm it catches it, and undo it. A gate that has never failed is a gate you are
guessing about — this is not a formality, and an accent-parity gate written this way found
four undocumented accents on its first real run.

### 7. Commit, and say what to do next

`git init`, one commit, and a plain statement of where it is and how to point the rest of
the suite at it (`--authority <path>`, or a `.design-authority` file in the consuming
repo).

## Capture — reverse-engineering an existing look

Same output, different input. Read what exists first: CSS custom properties, a Tailwind
config, a Figma token export, a brand PDF, or screenshots.

Two failure modes to watch:

**Don't launder inconsistency into a system.** A codebase with eleven greys does not have
an eleven-step grey scale; it has drift. Say so, propose the scale you'd collapse them to,
and record what was merged. The value of a capture is the decisions it forces, not the
completeness of its inventory.

**Don't read values off rendered images.** Eyedroppering a screenshot picks up compression
artefacts, blend modes, and opacity you can't see. Prefer the source. Where an image is
genuinely all you have, say the value is approximate and mark it for confirmation.

## Audit — a repo that already conforms

Run its own `validate.mjs` first; if it passes, the interesting findings are the ones a
validator can't reach:

- rules that exist in one product's profile but are really family-wide policy — the most
  common structural fault, and it means every other product is silently unbound
- a profile contradicting the foundation rather than narrowing it
- values duplicated between `DESIGN.md` prose and the token file, already diverging
- products in the catalog with no profile, or profiles with no catalog entry
- an accent shared by several products without either declaring the sharing

Report findings; change only what you're asked to change.

## Adding a product

The narrow case, and the common one. A new profile needs: its language and voice, its
motif for generated art, its accent decision, and its bans — the things this product
specifically must not do.

An accent decision is one of four, and all four are legitimate: **own** it, **inherit** the
family's, have **none**, or leave it **undecided**. Undecided must be written down. A
product with an accent nobody declared is how two products end up on the same hex and
nobody notices for a year.

If the accent is `own`, it must agree in four places — token JSON, CSS custom property,
the per-product scope, and whatever table the README keeps. That's exactly the kind of
four-way consistency a human forgets and a validator never does.

## What this skill must never do

- **Never invent a value the authority already specifies.** Read it.
- **Never write the suite's own opinions into a user's repo.** The templates in `assets/`
  are shapes with prompts in them, not a house style with the serial numbers filed off.
- **Never cache authority values anywhere outside the authority.** Not in a run folder,
  not in a style profile, not in a prompt library.
- **Never claim a gate passes without running it.**

## Reference files

- `references/repo-layout.md` — the full file-by-file spec, and what each gate checks
- `references/capture.md` — reverse-engineering from CSS, Tailwind, Figma exports, sites
- `assets/` — templates for `DESIGN.md`, a profile, `catalog.json`, and `validate.mjs`

Shared contracts: `${CLAUDE_PLUGIN_ROOT}/references/authority-contract.md` (the contract),
`${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md` (the loop), `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md`
(the mechanics).
