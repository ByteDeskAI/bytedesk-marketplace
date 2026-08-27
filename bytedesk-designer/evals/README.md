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
