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
   Found by the add-product run, unprompted: `repo-layout.md` and the skill both say an
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
