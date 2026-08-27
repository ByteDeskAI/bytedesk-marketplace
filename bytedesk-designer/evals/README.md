# Eval sweep, iteration 1

Every eval run twice — once with its skill, once with nothing — then graded by an
independent agent against the assertions, one at a time, with quoted evidence.

**With-skill 174/183 (95%). Baseline 91/183 (50%). +45 points.**

All 31 evals, 62 runs, complete.

Median cost: 6.8 min and 112k tokens with the skill, 4.7 min and 89k without. The skill
costs about a third more and is worth it on every dimension the assertions measure.

`benchmark-iteration-1.json` has the per-eval and per-skill breakdown.
`sweep-findings.md` has the defects it surfaced, which is the actual product of a sweep —
the score only tells you whether the suite is worth having.

## What to do with this next

**96 of 176 assertions passed in both configurations.** By the discriminating-or-delete
rule they measure a careful agent rather than this suite, and should be retired or
sharpened before iteration 2. They are the ones that read like good practice: *added the
product to the catalog*, *led with a verdict*, *did not invent rationale*. Good advice,
no signal.

**Two evals scored identically both ways** — `append-without-dropping` and
`resume-with-missing-files`. Both state a default rather than a discipline. Give them a
harder trap or delete them.

**One eval scored negative** — `thin-existing-brief`, 5/6 against the baseline's 6/6. That
one was worth more than the other thirty put together: it caught the discovery skill
diverging on a fact the authority had already settled, in direct contradiction of its own
rule against inventing an audience. Fixed. A negative delta is a finding, not an
embarrassment.

## The orchestrator's number needs an asterisk

`bytedesk-designer` scores 21/26 against 11/26 (+38%), the lowest of the eight — and two of
its four evals are the ones that measure least. `fc-orchestrator` scored 2/5 because its
assertion could not describe what the run actually did (it repaired a broken launcher and
ran *with* Codex, which the wording forbade neither way). `resume-with-missing-files`
scored 5/5 both ways.

More importantly, both of its heavy evals ran while twenty other subagents were in flight,
which is what starved their fan-outs. The orchestrator was measured under exactly the
condition it handles worst, and the condition was mine, not the environment's. Re-run it
idle before trusting the number.

## Two assertions in this suite have never been graded

The fan-out verification assertions were added to `batch-discipline` *after* its runs had
started, so the snapshot they were graded against carries six assertions, not eight. The
two new ones — did it verify each worker produced, and did it disclose the fallback — are
untested, which is unfortunate given they are the assertions that finding came from.

They are also the ones most likely to be non-trivial. Grade them first in iteration 2.

---

# Iteration 2 — what changed, and why nothing was retired

## Assertions are now typed

Every assertion carries a `kind`:

| kind | count | rule |
|---|---|---|
| `discriminator` | 78 | showed a delta in iteration 1. Compute the headline on these. |
| `unproven` | 82 | passed in **both** configurations, **once**. |
| `untested` | 37 | added or rewritten since, or unobservable as previously worded. |

**On the 78 discriminators the separation is total: 85/85 with the skills, 0/85 without.**
Every assertion that discriminates at all discriminates completely. The +45 point headline
was diluted by assertions that were never going to move.

## Why nothing was retired

The obvious move was to delete the 82 that passed both ways. I tried it, with a keyword
heuristic, and it retired *"viewed the returned image before judging it"* and *"round 1
explored two or more genuinely different directions"* — the two rules the entire suite
exists to enforce.

They passed both ways because a strong baseline happened to do them on that one task. Every
assertion here has **n=1**, and one observation cannot separate a default from a discipline
the baseline hit by luck. So `unproven` means give it a harder fixture, not delete it.
Retire only what passes both ways a second time, against a fixture built to catch it.

## The four fixture problems iteration 1 exposed

**Seven assertions failed in both configurations**, and four share one shape: *do X before
starting*. A single-shot non-interactive harness has no "before" — the agent gets one
user-facing message, at the end. They were unobservable by construction, not unmet, and are
now reworded to what a final message can evidence.

**One of the seven was a real skill gap.** Both configurations produced entirely plausible
fake figures, because *"keep them obviously illustrative"* is an adjective with no method —
and it fights the rule directly above it, which demands realistic data. The surface skill
now separates shape from content and puts the marker in the artifact rather than in the
accompanying message, for the same reason the provenance header exists: the mockup outlives
the sentence that came with it.

**Two evals scored identically both ways and are re-trapped, not deleted:**

- `append-without-dropping` → the trap is now a **renamed** source, not a missing one. A
  regenerate silently repoints it and nothing looks broken; the entry still renders and has
  quietly lost its status and its history.
- `resume-with-missing-files` → renamed `resume-with-stale-files`. Every file now exists, so
  an existence check passes and the run looks complete — but `.source-sha` names a commit the
  authority has moved past. The discipline is not *verify it exists*, it is *verify it is
  current*.

## The orchestrator still needs an idle re-run

A probe settled the earlier confusion: a nested spawn succeeded in **6 seconds with no
error**, with the pane backlog I had blamed still in place. So neither "nesting is
unavailable" nor "orphaned panes" was the cause. What is established is only that it fails
under heavy parent concurrency and works at normal load — which is exactly the condition a
large sweep creates. The orchestrator was measured at its worst, and the condition was mine.

---

# Iteration 2 — results

Eight runs: the two orchestrator evals re-run with fan-out headroom, and the two re-trapped
evals run for the first time.

| eval | iteration 1 | iteration 2 |
|---|---|---|
| `batch-discipline` | 6/8 vs 4/8 | **8/8 vs 3/8** |
| `cold-start-no-authority` | 5/6 vs 0/6 | 5/6 vs 0/6 |
| `append-without-dropping` | 5/5 vs 5/5 | 5/7 vs 6/7 |
| `resume-with-stale-files` | 5/5 vs 5/5 | 6/7 vs 7/7 |

**The orchestrator's number was being suppressed by the condition it was measured in** —
+38% in iteration 1, **+71%** across its two evals here. With headroom the with-skill run
scored perfectly: six scoped workers, PNGs verified on disk before believing the replies,
and the viewed-vs-artifacts gate run. The baseline never fanned out at all.

## The fan-out mechanism, finally specific

Naming a worker allocates it a terminal pane. When that budget is exhausted — here by
long-lived sessions from other tools — every *named* spawn fails with `no space for new
pane` while unnamed spawns work fine; a probe confirmed the plain case succeeds in six
seconds. One run hit it, retried unnamed in two batches of three, and launched all six with
no work lost. Another hit it and didn't retry. That difference is why the workaround is now
in the skill rather than a warning.

I revised this diagnosis four times. The first three — "nesting is unavailable", "my own
concurrency", "load generally" — were guesses stated as conclusions.

## Both re-trapped evals came back negative, and both were worth it

Neither meant the fixture was too easy.

`append-without-dropping` (**5/7 vs 6/7**) exposed a real defect **in the skill**: the run
marked two screens it had just built as `approved`, while the baseline called them `draft`.
The cause was this suite's own status vocabulary — two words, `exploration` and `approved`,
and a freshly built surface is neither. Given no correct option a careful run picked the
wrong one. Three statuses now, and the rule they carry: **a stage cannot approve its own
output.**

`resume-with-stale-files` (**6/7 vs 7/7**) exposed a defect **in the eval**: the assertion
demanded the run re-vendor drifted tokens, while the orchestrator's own rule says a run
surfacing blocking findings stops and reports. The run quoted that rule, declined to fix,
and lost a point for obeying the skill. The grader named the conflict rather than letting it
pass as a result. Assertion rewritten to accept either.

That run also produced the deepest finding in either iteration. It checked whether the run's
*record* was truthful, not just whether its files were current: the promoted image is 4096
pixels of one colour, `notes.md` claims it holds the motif, `state.json` lists it as viewed.
**"Those cannot all be true."** It ranked that above the colour bug and the drift, because it
is about whether the record can be trusted. The baseline fixed both mechanical problems and
never asked.

## Running total

**Nine defects fixed across the two iterations. Six were found by runs testing something
else, and two by baselines with no skill at all** — which is the argument for running
baselines rather than just measuring against them.
