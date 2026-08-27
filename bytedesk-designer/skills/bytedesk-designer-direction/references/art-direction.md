# Art direction

How to write an image prompt that produces what you actually pictured.

The model is a fast, literal, slightly generic collaborator with no memory of the conversation and no access to the user. Everything it needs has to be in the prompt. But more words is not the lever -- *decisiveness* is. A prompt with five committed choices beats one with twenty hedged adjectives, because every adjective the model can't reconcile it averages away toward the middle of its training distribution, which is where the stock-photo look lives.

## Structure

Write the prompt in this order. It matches how the model resolves an image: object, then arrangement, then surface, then exclusions.

1. **Artifact type.** What kind of object is this? "A flat vector logo mark." "A UI screenshot of a desktop settings page." "An editorial spot illustration." The model needs to know what category of thing it is making before anything else, because the category carries a hundred conventions you'd otherwise have to spell out.
2. **Subject and composition.** What is in it and where does it sit. Focal point, framing, crop, what occupies the negative space.
3. **Palette and light.** Hexes when brand matters, named colors and a light direction when it doesn't.
4. **Rendering style.** Flat vector / photographic / gouache / isometric line / risograph two-color. Name the medium, not a living artist.
5. **Exclusions.** What must not appear.

## The rules that actually change outcomes

**State figure and ground explicitly.** This is the single most common failure. "An indigo chevron in a rounded square on off-white" produced an indigo *tile* with an off-white chevron on a white field -- the model inverted the mark and dropped the background color. Write it as a sentence with both terms and a preposition: "an indigo (#3B3BD6) chevron mark sitting directly on a warm off-white (#F7F4EE) background, with no container, tile, or rounded rectangle behind it." If the background should be a plain field, say so and name what shouldn't be there.

**Negative space is a spec, not an absence.** "Generous margins, the mark occupying roughly 60% of the frame" is an instruction. "Minimal" is a mood, and the model will fill the frame anyway.

**Say what to leave out.** Image models add: shadows, gradients, reflections, borders, frames, watermarks, lens flare, tiny illegible captions. Each of these has to be excluded by name if you don't want it. A short exclusion list at the end of every prompt is cheap insurance.

**Text is a liability.** The model garbles anything long. Keep it to five words or fewer, quote it exactly (`the words "Ship it" and nothing else`), and say where it sits. If the type matters more than the image, omit it entirely and composite it afterward -- a clean image with real type beats a whole image with mangled type.

**Name the medium, not the artist.** "In the style of [named living illustrator]" is both unreliable and something to avoid on principle. Describe the structural qualities instead: line weight, edge quality, color count, texture, how forms are simplified. "Two-color risograph, visible grain, misregistered by a millimeter, chunky simplified shapes" gets you further than any name would.

**Give dimensions and crop.** Square, 16:9, 3:2 portrait, tall banner. The intended aspect changes composition, not just the frame. State the end use too when it's unusual -- "will be viewed at 32x32" or "will sit behind white body text" changes what the model should protect.

**Anchor color with hexes when it matters.** The model approximates hexes rather than hitting them, but a hex pulls it far closer than a color name. If exact color is non-negotiable, plan to correct it afterward rather than expecting round 1 to nail it.

**Prefer concrete nouns to abstract praise.** "Beautiful," "modern," "professional," "clean," "striking" are invisible to the model -- every image in its training set was described that way. "Three overlapping translucent planes, hairline rules, one accent color against neutrals" is visible.

## Register: aim at a specific kind of good

"Good" is not one thing, and a brief that doesn't name which good it wants gets the model's average of all of them -- which is the stock look. Decide the register before you write, and let it drive the concrete choices.

The register that most software and AI companies actually want, and rarely get, is **precision plus one striking move**. Everything disciplined -- tight geometry, restricted palette, real hierarchy, nothing accidental -- and then a single element that earns attention: a light behaviour, an unexpected material, one edge of accent doing something specific. That combination reads as confident. It's what people are reaching for when they say a thing looks *sharp*, or expensive, or like a real company made it.

Two ways this goes wrong, and they're opposite:

- **Austerity mistaken for sophistication.** Removing everything until nothing is left is not restraint, it's abdication. An image with no focal move doesn't read as disciplined, it reads as a failed load. If a variant could be mistaken for a placeholder, it has failed even if every rule was followed.
- **Richness mistaken for quality.** Gradients over gradients, glow on everything, texture everywhere. This is the model's default gravity and it reads as generic no matter how well executed.

Discipline everywhere, one deliberate move. Name that move in the brief, and name where it sits.

Register is also contextual. An operator's console and a launch announcement want different amounts of energy even inside the same brand -- and a design authority's restraint rules usually govern the former, not the latter. If you're unsure which room you're in, ask.

## Per-artifact notes

**Logos and marks.** Demand simplification: "reduces to a single silhouette," "no more than two colors," "legible at 32px." Ask for the mark alone on a plain field, not on a business card mockup, unless the mockup is the point.

Know the limit here: the model has a very strong **white-background prior** for marks and will put yours on white regardless of hexes, negatives, or restatement. Treat generation as concept exploration only -- judge silhouette and idea, ignore color and ground -- then redraw the winner as SVG and ship a real asset kit. This is why marks belong to a different stage: `bytedesk-designer-identity` generates to think and redraws to deliver.

**UI mockups and app screens.** Say which platform and which surface. Specify the state -- populated with realistic data, not empty and not lorem. Expect garbled microcopy; treat the mockup as a layout study, not a spec. If a real screenshot with real text is needed, building it in HTML and screenshotting is more reliable than generating it.

**Hero and header graphics.** Say what will overlay it and where, because that region has to stay quiet: "the left third stays low-contrast for white headline text." Composition matters more than subject here.

**Social and ad creative.** State the platform and ratio. Leave the safe margins clear. Keep the focal point off-center if a logo or caption will occupy the corner.

**Illustration and spot art.** Commit to a palette count -- "four colors total" produces a coherent image where "colorful" produces mud. Say how forms are simplified and how the edges behave.

**Diagrams and explanatory visuals.** Be honest that image models are weak here: labels garble and relationships drift. When the content is structural rather than aesthetic, SVG, HTML, or mermaid is the better tool, and it's worth saying so rather than producing a handsome diagram that's wrong.

**Packaging and product shots.** Name the material and the light: "matte uncoated card, soft directional light from upper left, shallow depth of field, neutral seamless background."

**Avatars and characters.** Specify framing (bust, three-quarter, full), gaze direction, and expression. For a set that must look related, generate them in one prompt as a grid, or fix the description of every shared attribute word for word across prompts.

## A worked example

Too vague:

> A modern logo for a developer tools company, clean and professional, blue.

Committed:

> A flat vector logo mark for a developer tools company. A single geometric glyph: an upward chevron with squared-off terminals, drawn in deep indigo (#3B3BD6), sitting directly on a warm off-white (#F7F4EE) field. No container, no tile, no rounded rectangle behind the mark. The glyph occupies about 45% of the frame width, optically centered, generous even margins. Uniform stroke weight, crisp edges, two colors total. Square 1:1 composition. No text, no shadow, no gradient, no outline, no border, no reflection.

The second one is longer, but almost none of the extra length is adjectives -- it's decisions.
