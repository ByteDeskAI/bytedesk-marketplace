## Skill defects surfaced by the sweep

1. **review/SKILL.md — "no degraded mode" vs "offer the useful part".**
   The run flagged the tension itself: the skill says review has no degraded mode and must
   stop, while the collaboration contract says offering the still-useful part is good so
   long as it is not filed as stage output. The §1 mechanical checks need no model at all,
   so the correct behaviour is: run them, write `review_status: incomplete`, do not file.
   The run inferred that correctly, but it should not have had to.

2. **The fixture authority ships colour tokens only.** Two runs independently reported it:
   `DESIGN.md` names a 4px base and a 1.2 type scale but there are no `space.*` or `font.*`
   tokens, so every surface invents its own. This is a fixture defect, not a skill defect —
   but it is also the exact finding `authority`'s audit mode is supposed to produce, and it
   produced it unprompted.

3. **The fail-closed rule has a third state it never named, and the orchestrator found it.**

   Six of seven with-skill runs stopped at preflight. The seventh — the orchestrator, which
   has the most latitude — diagnosed the cause (volta's shim gone, the 0.146.0 install
   itself intact), wrote a two-line shim pointing at the real binary, and ran the whole arc.
   The images it produced are genuine 1672x941 PNGs from real Codex sessions with real
   session ids.

   So it did not run *without* Codex. It repaired the launcher and ran *with* it, which is
   the opposite of the failure the rule exists to prevent: the provenance header it wrote
   is true.

   The skills name two states — **absent** and **unauthenticated**. There is a third:
   **installed, working, signed in, but unreachable** (a clobbered shim, a broken PATH, a
   half-finished upgrade). That is a tooling fault, and repairing it is not substitution.

   But silent self-repair is one step from silent substitution, and the difference has to
   be visible from the artifact rather than from trusting the agent. So the rule needs a
   third clause rather than a loophole: **repair is allowed; concealed repair is not.**
   Say what was broken, say what you pointed at, and record in `state.json` the version of
   the binary actually invoked — not the version the package claims.

   The eval is also wrong as written. "Refused to proceed rather than running the arc
   without Codex" cannot grade this run, because the run did not do the thing the assertion
   forbids. It needs splitting: refuse-on-absent, and repair-and-disclose-on-unreachable.

4. **The shipped validator's accent gate checks three places, not the four it documents.**
   Found by the add-product run, unprompted: `skills/bytedesk-designer-authority/references/repo-layout.md` and the skill both say an
   `own` accent must agree across the token JSON, the CSS custom property, the
   `[data-product]` scope, and the README table. `validate.mjs` checks the catalog, the
   scope and the README — the token JSON never holds per-product accents, so that arm of
   the gate is vacuous. Either the tokens must carry them or the docs must stop claiming
   four. A gate that is documented wider than it checks is worse than a narrow one,
   because people trust the documentation.

5. **The blind-read eval may not discriminate, and the fixture is why.**
   The baseline caught the contract violation without any blind read at all — it opened
   the PNG, saw a progress bar, and cited the DESIGN.md clause. That is the correct
   outcome and it means the eval measured nothing about the mechanism under test.

   The cause is fixture design, not skill design: the violation I planted is a literal
   determinate progress bar with an evenly-ticked scale. Nobody who opens it can miss it.
   The failure the blind read exists for is the *subtle* case — the piece whose author
   reads it as "markers on tracks" and a stranger reads as a chart, where both readings
   are defensible. A violation that obvious tests attentiveness, not blindness.

   If this eval scores equally in both configurations it should be retired and rebuilt
   around an ambiguous artifact, per the discriminating-or-delete rule.

6. **Two independent runs found the same fixture bug**, which is worth keeping as evidence
   the surfaces check is real: `surfaces/invoices.html` never sets `data-product`, so the
   product accent never applies and the late-invoice marker renders in the family cyan.
   A page that uses `var(--...)` correctly, hardcodes nothing, and passes every honest
   self-check can still render entirely the wrong colour. That belongs in the surface
   skill as a named failure mode.

7. **The orchestrator's fan-out silently produced nothing, and the skill has no check for it.**
   From the run itself, stated plainly: *"I fanned out three subagents, one per surface, as
   the skill requires. They produced nothing and started no Codex process, and didn't answer
   a status ping. I ran the stage myself instead."*

   It recovered correctly — ran the surfaces sequentially, looked at every render before
   promoting — and recorded that the review's independence was lost as a result. But it had
   to discover the failure by noticing empty directories.

   Fan-out is the orchestrator's central mechanism and it can fail silently in any harness
   where nested delegation is unavailable or rate-limited. The skill must say: **after a
   fan-out, verify each worker actually produced its artifact before treating the stage as
   done, and fall back to running them yourself rather than proceeding with gaps.** A worker
   that returns nothing looks identical to a stage with nothing to do.

8. **The viewed-audit caught the orchestrator itself, which is the mechanism working.**
   *"The viewed-audit also caught me: six identity assets were promoted without being
   individually inspected. Rendering them properly turned up a real defect (both favicon
   SVGs had pinned width/height and couldn't scale)."*

   This is the contract earning its place. The rule was written after a batch of images
   shipped unviewed; here it caught the same drift in a fresh run, and inspecting the
   artifacts found a defect nothing else would have.

9. **Harness limitation, not a skill defect: parallel agents share one agent-browser session.**
   Three runs reported screenshots returning another agent's foreground tab. Each fell back
   to headless Chrome or to link resolution and said so. Worth knowing before reading any
   visual check in this sweep as authoritative.

10. **First non-discriminating eval: `append-without-dropping` scored 5/5 both ways.**
    Per the discriminating-or-delete rule it measures nothing and should be retired or
    rebuilt. The likely cause is that "read the existing manifest and append rather than
    regenerate" is what a careful agent does anyway when handed a manifest — the skill is
    stating a default, not adding a discipline. A version that discriminates would need a
    harder trap: an entry whose source moved rather than vanished, or a manifest whose
    ordering carries meaning.

11. **The fan-out failure reproduced, and the fix held.**
    The cold-start run hit it independently: *"The per-surface fan-out failed — three
    workers produced nothing — so I built all three surfaces in one context and reconciled
    the review there too. The blind reads are independent; my judgement about them isn't."*

    That is exactly the required behaviour — notice, fall back, and disclose what the
    fallback cost. Two independent occurrences confirm it is a real environmental limit
    rather than a one-off, which is what justifies the rule rather than a note.

    Caveat on the evidence: this run was given the limitation as a prompt hint, so it
    demonstrates that the *disclosure* behaviour is achievable, not that the SKILL.md text
    alone induces it. Iteration 2 should run this eval without the hint.

12. **`cold-start-no-authority`: 5/6 against a baseline 0/6 — the largest single-eval gap
    in the sweep.** The baseline, given the same empty directory, scored zero: it produced
    a design without bootstrapping an authority, without preflight, and without the arc.

    The one miss is worth reading carefully before treating it as a defect. The assertion
    was "announced which stages it would run and why, *before starting*". The run recorded
    the arc in its notes and stated the ~30-minute cost — but after the fact, because a
    single-shot non-interactive harness gives an agent exactly one user-facing message, at
    the end. **There is no "before" in that context.**

    So this is an eval-design problem, not a skill problem: the skill's text is already
    explicit ("Say which stages you're running and why, before starting"), and the
    behaviour it asks for is unobservable in the configuration the eval runs in. Either
    the eval needs a two-turn harness, or the assertion needs rewriting to something
    checkable from a single message — e.g. "stated which stages ran, which were skipped,
    and roughly what it cost".

13. **Correction to finding 7: I caused the fan-out failure, at least in this sweep.**
    The batch-discipline run got a specific error the earlier two did not surface:
    `no space for new pane`, confirmed by retry. Five of six workers could not spawn at
    all; the sixth ran sixteen minutes, wrote nothing, and never started a Codex process.

    The cause is concurrency exhaustion — I was running twenty subagents at once to get
    the sweep through, which left no room for the nested delegations these runs needed.
    So "nested delegation returns nothing" is **not** established as a general property of
    the environment. It is what happens when the parent has saturated the budget, which is
    exactly the condition a large sweep creates and a normal run does not.

    The rule added to the orchestrator stands on its own merits regardless: verify each
    worker produced, fall back loudly, and say what the fallback cost a later review. That
    is correct whether the cause is saturation, rate limiting, or anything else. But the
    *diagnosis* in finding 7 was overstated, and anyone reading it should know the
    confound. Iteration 2 must run the orchestrator evals with the rest of the sweep idle.

    Worth noting what the run did with the failure: it fell back to twelve prompts,
    generations and critiques by hand, one image at a time, wrote each product's notes
    before opening the next, and recorded in both `state.json` and `findings.json` that the
    independence a fan-out would have bought was gone. That is the behaviour the rule asks
    for, produced under a genuinely degraded environment.
