# Eval sweep, iteration 1

Every eval run twice — once with its skill, once with nothing — then graded by an
independent agent against the assertions, one at a time, with quoted evidence.

**With-skill 164/171 (96%). Baseline 89/171 (52%). +44 points.**

Median cost: 6.4 min and 109k tokens with the skill, 4.7 min and 89k without. The skill
costs about a third more and is worth it on every dimension the assertions measure.

`benchmark-iteration-1.json` has the per-eval and per-skill breakdown.
`sweep-findings.md` has the defects it surfaced, which is the actual product of a sweep —
the score only tells you whether the suite is worth having.

## What to do with this next

**92 of 164 assertions passed in both configurations.** By the discriminating-or-delete
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
