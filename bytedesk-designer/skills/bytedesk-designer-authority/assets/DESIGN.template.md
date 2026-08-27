# <System name> — design foundation

> The reasoning lives here. The values live in `tokens/`. If a line would still be true
> after you changed every hex, it belongs in this file; if it changes when a hex changes,
> it belongs in the token file.

## Ground

<Light-first or dark-first, and why. This decides everything below it, so answer it
plainly. "Dark-first because the console is watched for hours in a dim room" is an answer;
"a mix" is a deferral.>

## Light

<Where light comes from. Whether elevation is expressed by shadow, by surface value, or
by border. If shadow is banned, say so here.>

## Colour

Roles, not hexes.

| Role | What it is for | What it must never be |
|---|---|---|
| ground | the page behind everything | |
| surface | raised or inset regions | |
| text | body copy | |
| textMuted | secondary and metadata | used for anything that must be read |
| border | separation where surface value isn't enough | |
| accent | <state exactly what the accent is for> | <state exactly what it is not for> |

<The accent's "never" cell is the most valuable line in this table. An accent with no
stated limit becomes a background fill within a week.>

## Type

<Family, scale ratio, and which steps exist for what. Name the steps you actually use;
a scale with an unused step invites someone to use it.>

## Space

<Base unit and ratio, in a sentence. A table nobody reads is worse than a rule everybody
remembers.>

## Motion

<Durations, easings, and where motion is banned. Reduced-motion behaviour.>

## Generated art

<What generated raster art may and may not be under this system. A default worth starting
from:>

Generated raster art is **exploration** — abstract visuals, moodboards, identity boards,
non-critical texture. It must not contain logos or identity-critical marks, product copy,
fake controls, invented metrics, functional icons, or rasterised application UI.
Interfaces and icons are built in HTML/CSS against real tokens; a generated screenshot is
not implementation source.

**Never read a colour value off generated art.** Renders carry compression, blend, and
model-side colour priors; a teammate who eyedroppers one gets the wrong number.

<Then the family's visual invariants — the things every generated piece must hold, whatever
its subject. Keep these few and physical.>
