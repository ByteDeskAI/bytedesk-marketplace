---
name: bytedesk-designer-review
description: "Independently check finished design work before it ships, using a second model that is deliberately shown the artifact without being told what it was supposed to be. Use this before promoting, publishing, or handing over any image, mockup, screen, mark, or set of them - and whenever someone asks whether design work is ready, whether it matches the system, whether it is on brief, or wants a second opinion on something they already made. Catches what the author structurally cannot see: an element that reads as a chart when the brief called it a diagram, a value that drifted from the tokens, an artifact nobody actually looked at. Produces findings with evidence rather than a verdict. Requires the Codex CLI installed and signed in."
license: Apache-2.0
metadata:
  suite: bytedesk-designer
  stage: review
  produces: review/findings.json
  requires: codex-cli
---

# Review

The author of a brief cannot reliably judge whether the result matches it. Having written
"markers on tracks", you read markers on tracks; a reader who never saw those words sees a
progress bar. That is not carelessness — it is what writing the brief does to you, and no
amount of care removes it.

So this stage does one structural thing: it shows the artifact to an eye that has **never
seen the brief**, and reconciles what that eye reports against what the brief intended.

This is the gate. It exists because a set of fifteen images was once promoted into a
governed repository after three were looked at, and one of them violated a rule the
generating skill itself declared. Nothing objected, because everything that could have
objected had read the brief.

Read `references/claude-codex-collaboration.md` and `references/codex-handoff.md` at the
plugin root first.

## Preflight

```bash
command -v codex && codex --version
```

Missing or signed out: **stop and say which**, with the fix. There is no degraded mode
here — a review Claude performed alone is precisely the review this stage exists to
replace, and reporting it as a review would be worse than not running one.

## 1. The mechanical checks, first

These are cheap, they never disagree with themselves, and they catch a surprising share of
real defects. Run them before spending a model on anything.

**Did every artifact get looked at?** Cross-check `artifacts` against `viewed` in
`state.json` for every stage. An artifact promoted without being viewed is a finding, and
it is the highest-severity one this stage reports regardless of how the artifact looks.

**Do the surfaces carry hardcoded values?**

```bash
grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' surfaces/*.html
```

**Has the vendored stylesheet drifted?** Compare `surfaces/.source-sha` against the
authority's current head. A difference is not automatically a defect — it is a fact that
needs stating, because a surface built against last month's tokens looks fine and is wrong.

**Does every `var(--...)` resolve?** A typo'd custom property doesn't error; it silently
renders as nothing.

**Does the authority's own validator pass?** Run `scripts/validate.mjs` if it exists.

**Is provenance present?** Every notes file opens with the header from the run-folder
contract, and the Codex version recorded in `state.json` is real.

## 2. The blind read — Codex as critic

Hand Codex each artifact **without the brief, without the product name, and without any
statement of intent**. Attaching any of those defeats the entire mechanism.

The fixed question is in `references/codex-handoff.md` at the plugin root. Its shape
matters more than its wording: ask what the artifact *depicts*, ask it to enumerate
anything that reads as a control, chart, logo, word, or number, ask what dominates, and ask
what colours it actually sees. Four questions, answered cold.

One artifact per invocation. Do not batch — a critic shown three images starts comparing
them, and comparison is not what you asked for.

## 3. Reconcile — Claude

The blind read is **evidence, not a verdict**. Now put it beside the brief and decide.

The productive disagreements, and what each usually means:

| Blind read says | Brief says | Usually means |
|---|---|---|
| "a progress bar" | "markers on tracks" | the brief described a chart; the artifact is right and the brief was wrong |
| "three colours: blue, white, grey" | accent is amber | the render drifted, or the accent never landed |
| "a dashboard with metrics" | "abstract texture" | a generated-art contract violation |
| "I can't tell what this is" | anything | the artifact has no focal move — the failure that passes every other check |
| nothing dominant | a stated focal hierarchy | the hierarchy exists in the brief and not in the artifact |

The general rule: **a blind critic that disagrees with the brief is usually right about
what is *there* and wrong about whether it matters.** Believe its observation; make the
judgement yourself.

Where the blind read reports an interface element, a logo, copy, or a number in something
the authority's contract says must not contain them, that is a contract violation and it
does not need a second opinion. Those are the findings that got shipped last time.

## 4. Write findings

`review/findings.json`:

```json
{
  "run": "2026-08-27-quiet-ledger",
  "authority_sha": "9f3c1a7",
  "findings": [
    {
      "severity": "blocking",
      "kind": "contract",
      "artifact": "direction/images/r2-a.png",
      "finding": "Reads as a progress bar. The authority's generated-art contract excludes interface elements.",
      "evidence": "Blind read, unprompted: 'a horizontal progress bar, partially filled'.",
      "fix": "Re-brief. The brief described completion state, which converges on a chart however it is phrased."
    }
  ]
}
```

**Every finding carries evidence.** A finding without a quotable blind read or a command
output is an opinion, and opinions are what this stage was built to supplement.

Severities: `blocking` (contract violation, unviewed artifact, drifted tokens),
`should-fix` (on-brief but weak, hierarchy absent, awkward state broken), `note` (worth
knowing, not worth a round).

## 5. Report

Lead with the verdict — ship, fix these first, or re-brief — then the findings in severity
order. Do not describe artifacts the operator is looking at; tell them what is wrong with
them.

**Say it plainly when nothing is wrong.** A review stage that always finds something
becomes a stage people route around. Zero findings, stated confidently, is a real result.

## What this stage must never do

- **Never show the brief to the blind critic.** Not "for context", not summarised, not the
  product name.
- **Never treat the blind read as the verdict.** Reconcile it.
- **Never report a finding without evidence.**
- **Never review its own work.** If this stage was invoked in the same context that
  produced the artifacts, say so — the blind read is still valid, but Claude's
  reconciliation carries the same authorship bias the stage exists to correct, and the
  operator should know which half is independent.
- **Never pass a run where an artifact was promoted unviewed.** It is blocking, whatever it
  looks like.

## Reference files

At the plugin root: `claude-codex-collaboration.md` (why the blind critic exists),
`codex-handoff.md` (the fixed question and attachment mechanics),
`authority-contract.md`, `run-folder-contract.md` (the `viewed` list this stage audits).
