# Result — new-project dialog translated to HTML

## What I would say to the user

Done — the surface is at `surfaces/new-project-dialog.html`, loading the vendored ByteDesk tokens
(`surfaces/tokens/design.css`, from design-system @ 9845b41, no hex/rgb of its own, every colour a
`var(--bd-*)`). It renders at 1280×800 and the run folder holds the ruler-grid measurements
(`translate/SPEC.md`), every Codex prompt, each round's screenshot, and the diffs.

One caveat on "exact match", up front: a pixel-identical match to this PNG is not attainable, and
I did not chase it. The mockup is an image-model render — its text is redrawn, its stage carries a
fog illustration and film grain, and its card widths are uneven (94/94/90px in one group,
102/106px in the next). What *can* be exact is the gap between this surface and your app once the
app loads the same stylesheet; that pixelDiff can reach zero, and I'll run that gate the moment you
give me a dev URL. Against the PNG itself the meaningful number is the layout score, which
converges at roughly 0.97 on a good translation — and that is where this landed.

Rounds (layoutScore against the mockup, higher is better; ceiling ≈ 0.97):

| round | layoutScore | top hotspot lumDiff | what changed |
|---|---|---|---|
| 1 | 0.964 | 0.060 | build from the spec |
| 2 | 0.965 | 0.059 | panel headers 34px (kimi row was clipped), inspector −6px, real transcript, thumbnail labels |
| 3 | 0.969 | 0.029 | modal + stage → `--bd-bg-subtle`, cards → `--bd-bg-surface`, input → `--bd-bg-subtle`, card titles medium weight |

(pixelDiff against the PNG went 0.080 → 0.071 → 0.070 — reported for completeness, not a gate; it
mostly counts the model's grain and redrawn glyphs.)

Round 2's score barely moved, which is the signal that a spec number was wrong rather than the
markup: sampling the luminance showed the mockup's modal and stage sit one token step darker than
I'd specified and the type cards two steps darker. Fixing those fills was round 3, and it is the
whole reason the modal now reads as the mockup does. What's left in the diff is text speckle and a
few 4–6px baseline offsets on secondary labels — the coin-flip territory the loop stops at.

Things the mockup shows that the surface deliberately does not: the stage's fog/amber-line
illustration and the thumbnails' images (flat panels at the same luminance instead), the film
grain, and any dimming scrim over the workbench (there isn't one visible in the PNG, so I built
none). The "Re-render" button is outlined orange with orange text as the PNG shows it, not filled
as the generation prompt asked for — the PNG wins over its own prompt.

Note on scoping: this authority uses `data-bd-product`, and there is no `designer-studio` profile,
so the root carries `data-bd-product="designer-studio"` and inherits the family default accent —
brand orange — which is correct for what the mockup shows. If you want the app's own accent later,
that's a profile in the design-system repo, not a change here.

Next step if you want the "exact" half: give me the Vite/dev URL for the Designer Studio window and
I'll shoot it against this surface with `--threshold 16` and fix the app's CSS until pixelDiff is
under 0.01.

## Stop reason
Round 3 is the ceiling. Top hotspot lumDiff 0.029 (< 0.04) and layoutScore moved 0.004 (< 0.005)
since round 2. No implementation URL was given, so the surface ↔ app pixelDiff gate did not run.

## Provenance
Codex codex-cli 0.146.0, text mode via scripts/codex-exec.sh; all three rounds succeeded on
attempt 1 ("direct"). Authority design-system @ 9845b41 (working tree had 1 uncommitted change).
Fonts: IBM Plex Sans / Mono are installed on this machine, so the render used the token families,
not a fallback.
