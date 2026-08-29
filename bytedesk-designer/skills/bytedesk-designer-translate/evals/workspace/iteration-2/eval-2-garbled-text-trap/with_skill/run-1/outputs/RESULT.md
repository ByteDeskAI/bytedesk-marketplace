# Result — new-project dialog surface

## What I'd say to you

The surface is built: `surfaces/new-project.html`, loading the design system's own token sheet (vendored at `surfaces/tokens/design.css`, pinned to design-system @ 9845b41) — no hex anywhere, `var(--bd-…)` only, `data-bd-product="platform"` on the root so the accent is the brand orange.

One caveat up front, because you asked for an exact match: **pixel-perfect against that PNG is not attainable, and I did not chase it.** The image is a Codex render — every glyph in it is the model's drawing of text, not text, and its grain and fog are never the same twice. What I can make exact is the *layout*: every column, card, row height, control size and inset was measured on a 20 px grid over the mockup and the surface is built to those numbers. The number that measures that is `layoutScore`, a coarse luminance comparison tolerant of text and grain; it tops out around 0.97–0.98 for a good translation and never reaches 1.0. It finished at **0.974**. The strict per-pixel number is meaningful only between this surface and the real app (both loading the same stylesheet) — you didn't give me an implementation URL, so that gate was not run; when the app's new-project dialog exists, shoot it against this surface and 0.0 is achievable.

What was deliberately not copied from the picture:
- The inspector behind the dialog. The mockup drew an image-file inspector (ID / Type / Dimensions / Size / Tags / Notes / History) — the model filling the column. The surface shows the product's project inspector as the rest of the app does (Solution · connected · path @ sha, Project, Brief prompts, Deliverables, Stages with the plugin's real stage names, Brief, Art direction, Project settings) in its no-project state, since the left column says "No projects yet" and the dialog is what creates one.
- The fog illustration and thumbnails (a flat ground placeholder; masked in every comparison so the chrome around it gets measured instead).
- Document icons beside r1-a.png / r2-a.png in the transcript.

Two measurements I got wrong in the first spec and corrected: the type-card description size (mockup is ≈9.5 px, not 11.5) and how much fits in the inspector's Project section. One residual I could not close: "Marketing sites and brochure pages" breaks to three lines where the mockup fits two — the mockup's glyphs are narrower than IBM Plex Sans at that size. That's a text residual, not a layout one.

## Per-round scores (surface ↔ mockup, masks on stage/thumbnails)
| round | layoutScore | pixelDiff (not a gate) | top hotspot | what changed |
|---|---|---|---|---|
| 1 build | 0.9789 | 0.062 | Send button, lum 0.174 | — |
| 2 patch | 0.9728 | 0.0715 | Send button, lum 0.056 | backdrop 72 % → 28 % dim; description 11 px; inspector overlaps removed; solution row / transcript columns |
| 3 patch | 0.9740 | 0.0687 | Send button, lum 0.056 | description 9.5 px, title 11.5 px (re-measured); Project settings rows −7 px |

Round 2's dip is the lighter backdrop lifting every non-dialog cell so the mockup's ungoverned text registers as speckle instead of being crushed by the dim; the top hotspot fell from 0.174 to 0.056 in the same round.

## Stop reason
Round 3 is the ceiling. Top remaining hotspot lumDiff **0.056** (Send button rect — text residual, not an edge); layoutScore moved **0.0012** since round 2 (rule: < 0.005). Remaining hotspots are text speckle inside blocks or the inspector region the mockup invented. Codex: 3 invocations, each succeeded on attempt 1 (direct), 135–144 s.

## Files
- `surfaces/new-project.html`, `surfaces/tokens/design.css`, `surfaces/.source-sha`
- `translate/SPEC.md`, `translate/grid-new-project.png`, `translate/prompts/new-project-r{1,2,3}.txt`, `translate/shots/new-project-r{1,2,3}.png`, `translate/diff/new-project-r{1,2,3}/`, `translate/notes.md`
- `state.json`
