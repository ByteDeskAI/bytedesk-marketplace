---
name: bytedesk-designer-discovery
description: "Turn a product idea into a design brief a designer or an agent can actually build from: who it is for, which surfaces exist, what constraints are real, how it should sound, and what it must never look like. Use this at the start of any design work, whenever someone describes a product they want to build and wants to see it, or when design work has begun without anyone writing down what it is for. Also use it when an existing brief is thin, contradictory, or reads as a list of adjectives. Generates two or three genuinely different product framings with the Codex CLI so the operator can choose by rejecting rather than by describing, then commits to one. Produces a brief every later stage reads. Requires the Codex CLI installed and signed in."
license: Apache-2.0
metadata:
  suite: bytedesk-designer
  stage: discovery
  produces: brief.md
  requires: codex-cli
---

# Discovery

Everything downstream reads `brief.md`. A vague brief doesn't produce vague work — it
produces confident work aimed at the wrong thing, discovered three stages later when
somebody looks at a rendered surface and says *that isn't it at all*.

The job is not to gather requirements. It is to **force decisions early, while they are
still cheap**, and to write down the reasoning so a later stage can tell an intentional
choice from an accident.

Read `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md` and `${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md` first. This stage uses Codex in text mode.

## Preflight

```bash
command -v codex && codex --version
```

Missing or signed out: **stop and say which**, with the fix. If it is on the machine and working but simply unreachable — a broken shim, a
half-finished upgrade — that is the third state: repair it for this run only, say
what you did, and record the version you actually invoked. See
`${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md`. Divergent framings are the
core of this stage, and one model producing three framings alone produces three framings
with one opinion in them — which is the failure this stage exists to prevent.

## Read the authority, if there is one

An existing authority constrains discovery usefully: the ground is decided, the type is
decided, the family's voice already exists. Read it so the brief narrows rather than
re-litigates.

If there is none, that is fine — discovery runs first and `bytedesk-designer-authority`
runs after, informed by this brief. Say which order you're in so nobody waits for a
palette that was never coming.

## 1. Listen, then ask the few questions that change the output

Most of what you need is usually already in what they said. Read it properly before asking
anything.

The questions worth spending a turn on:

- **Who is looking at this, and in what state?** The single highest-leverage question here.
  Somebody triaging an incident at 2am and somebody browsing on a couch want opposite
  things from the same screen, and almost every later decision follows from this.
- **What surfaces actually exist?** Not "a web app" — the specific screens and pages. A
  brief that names four surfaces produces four buildable things; one that says "the
  product" produces nothing.
- **What is the one thing it must do better than the alternative?** This becomes the focal
  hierarchy of every surface. If everything is equally important, nothing is.
- **What must it never look like?** A named negative is worth three adjectives. "Not
  another purple gradient AI thing" is a real constraint; "modern and clean" is not.

Four questions maximum, and fewer if they've already answered them. This is a design
stage, not an intake form.

### Diverge on framing. Never diverge on facts you already have.

This is the one place the stage can defeat itself, and a live run proved it: handed a thin
brief *and* a design authority that already described the audience, the run generated three
divergent framings and invented a persona — a specific person, at a specific hour, with a
specific four-year-old spreadsheet — while the profile sitting next to it already said who
this was for. The baseline, with no skill at all, simply read the profile and got it right.

Divergence is a tool for the questions that are genuinely open. It is not a licence to
re-answer questions the evidence has already settled, and the pull to invent is strongest
exactly where a vivid detail would make the brief read better.

So before generating anything: **list what is already known** — from the authority, from an
existing brief, from the operator's own words — and mark those as fixed. Diverge on what
kind of thing this is, who it centres, and what it competes with. Do not diverge on facts
already on disk. If a framing contradicts a known fact, that is a finding about the
authority, not a new option.

## 2. Generate framings — Codex as hands

Hand Codex the raw material and ask for **two or three genuinely different framings** of
the same product. Text mode; one invocation per framing. Not tonal variations — different
answers to *what kind of thing this is*.

The productive axes to diverge along:

- **Register.** The same tool as a precise instrument, as a calm companion, as an
  opinionated expert. These produce different products, not different palettes.
- **Who is centred.** The individual doing the work, the team coordinating, the manager
  watching. Each makes a different screen the home screen.
- **What it competes with.** Positioned against a spreadsheet, against an incumbent, or
  against doing nothing at all. The third is usually the real answer and rarely the stated
  one.

Ask each framing for the same fields, so they are comparable side by side: audience,
surfaces, the one thing it does better, voice, and three visual adjectives it should
*avoid*.

## 3. Judge — Claude

Read all of them, then commit. What to look for:

**Which one survives the hardest question?** Take the constraint the operator was most
specific about and see which framing still works under it. Specificity is where they
already made a decision, whether or not they framed it as one.

**Which one produces buildable surfaces?** A framing whose surfaces are "the dashboard"
and "the settings" hasn't done any work. One that names "the morning triage view where
nothing is wrong" has.

**Which one is not the obvious one?** The first framing is usually the category default —
the shape every product in this space already has. Sometimes that's correct. But if all
three converge on it, say so out loud, because a brief that inherits a category's
conventions without noticing is how a product ends up looking like every competitor.

Then **pick one and say why**, in a sentence the operator can disagree with. Graft the best
ideas from the runners-up rather than discarding them whole — a losing framing often has
the right audience with the wrong register.

Do not present three framings and ask the operator to choose. Recommend one and show the
others. An operator who wanted to make this decision unaided wouldn't have asked.

## 4. Write `brief.md`

```markdown
# <Product> — design brief

## What it is
<One paragraph. Someone who has never heard of it should be able to say what it does.>

## Who it is for, and in what state
<The audience, and the condition they are in when they use it. This is the load-bearing
section — every later stage reads it to decide how much energy a surface may have.>

## Surfaces
<Each named specifically, with what it is for and what dominates it. This list becomes
the surface stage's work-list, so a vague entry here becomes a vague screen later.>

| Surface | What it is for | What dominates |
|---|---|---|

## The one thing
<What it must do better than the alternative. The focal hierarchy of every surface
derives from this.>

## Voice
<How it talks, plus one message it would send and one it wouldn't. The pair does more
work than three adjectives.>

## Constraints that are real
<Technical, regulatory, brand, or platform constraints that actually bind. Distinguish
these from preferences — a later stage will treat everything here as non-negotiable.>

## What it must never look like
<Named negatives. The most useful section for the direction stage, and the one operators
answer most vividly if you ask.>

## Open questions
<What was not decided, and what each is waiting on. An open question with no blocker
named is one nobody returns to.>

## Framings considered
<The runners-up, one line each, and why they lost. This is what stops the same rejected
framing being re-proposed next quarter.>
```

The last two sections are the ones that get dropped under time pressure and the ones that
pay off longest.

## 5. Record it

Write `brief.md` to the run folder, set `stages.discovery` complete in `state.json`, and
say plainly which framing was chosen and what the operator should push back on.

## What this stage must never do

- **Never invent an audience.** If it isn't known, that is an open question, not a
  placeholder to fill with "busy professionals."
- **Never write adjectives where a decision belongs.** "Clean, modern, professional"
  describes every product ever made and constrains nothing downstream.
- **Never let all three framings be the same framing.** If they converge, say so and push
  Codex along a different axis rather than pretending you diverged.
- **Never leave the surface list vague.** It is a work-list, not a gesture.

## Reference files

Shared contracts: `${CLAUDE_PLUGIN_ROOT}/references/claude-codex-collaboration.md` (the loop),
`${CLAUDE_PLUGIN_ROOT}/references/codex-handoff.md` (text-mode mechanics), `${CLAUDE_PLUGIN_ROOT}/references/authority-contract.md`,
`${CLAUDE_PLUGIN_ROOT}/references/run-folder-contract.md`.
