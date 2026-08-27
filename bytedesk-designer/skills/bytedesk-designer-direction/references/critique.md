# Critique and revision

Read the returned PNG so it enters context as an image, then judge it. This is the step that distinguishes this skill from piping a sentence at an image model, so give it real attention rather than glancing and re-rolling.

## The pass

Work through these in order. The early ones are disqualifying; the later ones are polish.

**1. Is it the right kind of object?** A logo mark that came back as a logo *on a business card*, a UI mockup that came back as an illustration *of* a UI. Category errors are round-1 casualties and are fixed by naming the artifact type harder, not by adjusting the description.

**2. Does it survive the squint test?** Blur it mentally, or look at the thumbnail. What still reads? That's your actual composition. If everything turns to grey mush, the value structure is flat and no amount of color adjustment fixes it -- you need real contrast between the focal element and its surroundings.

**3. Figure and ground.** Did the model invert them? Add a container, tile, or frame you didn't ask for? Swap the background to plain white when you specified a tint? Check this every single time; it's the most frequent miss.

**4. Palette.** Compare against the hexes. Drift of a few percent is normal and usually fine. Wholesale substitution -- your warm off-white came back pure white, your indigo came back royal blue -- is a real miss worth a round, especially on brand work.

**5. Focal hierarchy.** Is the eye going where you intended, first? Models tend to center-weight and to give every element equal emphasis. If three things compete, none of them wins.

**6. Artifacts and errors.** Garbled or invented text. Warped geometry, broken symmetry where symmetry was implied. Extra fingers, limbs, or duplicated features on figures. Melted or nonsensical hardware and typography. Unrequested borders and frames. Watermark-like smudges.

**7. Does it look generated?** The tells: everything glossy and over-lit, a shallow depth-of-field haze on things that shouldn't have it, perfect bilateral symmetry, gradient-on-gradient, a teal-and-orange cast, hyper-detail with no hierarchy, the subject dead center at exactly 50% scale. Call this out when you see it -- users often can't name it but can feel it, and "this looks like AI made it" is the most common unspoken objection.

**8. Is it on-brief, or merely pretty?** These come apart constantly. A gorgeous image that doesn't leave room for the headline is a failure. Judge against the brief, not against your own taste.

**9. Does anyone want to look at it?** The inverse failure, and the easier one to miss because it passes every other check. A compliant, correct, restrained image with no focal move reads as a placeholder. If a variant could be mistaken for a failed image load, it has failed -- say so rather than shipping it as the disciplined option. Correctness is the floor, not the goal.

## What to say to the user

Lead with the verdict, then the reason. "B is the strongest -- it's the only one that still reads at thumbnail size. A has better color but the mark dissolves below about 60px." That's more useful than a paragraph of description of images the user is looking at.

Be specific about flaws and don't soften them into nothing. If all the variants missed, say so and diagnose why. A user who trusts your eye will let you spend another round; a user who suspects you're being agreeable will take over the prompting themselves, which defeats the purpose.

## Revision discipline

**One axis per round.** Palette, or composition, or rendering style, or subject -- not several. If you change three things and it improves, you've learned nothing you can carry to the next image, and if it gets worse you can't tell which change hurt.

**Hold the winners verbatim.** When something worked, copy that clause across word for word rather than paraphrasing. Rewriting a sentence that was already producing the right result is how a good round 2 becomes a worse round 3.

**Say what to change, not just what's wrong.** "Too busy" gives the model nothing. "Remove the background pattern entirely and let the mark sit on a flat field" is actionable. Every critique point should convert into a specific edit to the prompt text.

**Diverge in round 1, converge after.** Round 1 should explore genuinely different directions so the user has something to react against -- people identify what they want far faster by rejecting than by describing. Rounds 2 and 3 narrow toward one winner.

**Stop when it's good.** Three rounds is a ceiling, not a quota. An image the user is happy with at round 1 is a success, and spending two more rounds on it risks losing what they liked.

**Know when the brief is the problem.** If round 3 still misses, more prompting won't help. Say what you'd change about the approach -- a different artifact type, a different medium, HTML instead of a generated image -- rather than quietly rolling again.

## Recording it

Append each round to `direction/notes.md` in the run folder: what you asked for, what came back, what you judged, what you changed and why. Two or three lines per round. This is what makes the next run on the same brand start ahead of where this one started, and it's the raw material for a style profile.
