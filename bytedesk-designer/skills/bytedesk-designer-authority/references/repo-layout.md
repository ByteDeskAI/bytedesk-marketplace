# Authority repo layout, file by file

What each file is for, what goes in it, and — for the validator — what each gate actually
checks. Templates live in `../assets/`.

## `DESIGN.md`

The reasoning. Not the values.

Sections, in this order, because each depends on the one above it:

1. **Ground** — light or dark first, and why. Everything else hangs off this.
2. **Light** — where light comes from, how elevation reads, whether shadow exists at all.
3. **Colour** — the roles (ground, surface, text, muted text, border, accent) and what
   each is *for*. Roles, not hexes; hexes are in the token file.
4. **Type** — the family, the scale ratio, and which steps exist for what.
5. **Space** — the base unit and the ratio. One sentence beats a table nobody reads.
6. **Motion** — durations and easings, and the cases where motion is banned.
7. **Generated art** — the contract. See `../../../references/authority-contract.md`.

A rule of thumb that keeps this file useful: **if a line would still be true if you changed
every hex, it belongs here. If it changes when a hex changes, it belongs in the tokens.**

## `tokens/<name>.tokens.json`

The canonical values, DTCG-shaped:

```json
{
  "color": {
    "ground":  { "$type": "color", "$value": "#0B0D10" },
    "accent":  { "$type": "color", "$value": "#C9683B",
                 "$description": "edge-light and focus only, never a fill" }
  }
}
```

Per-product accents are authored here too, under `product.<id>.accent`, and generated
into their `[data-product]` scope rather than into `:root`:

```json
{ "product": { "quiet-ledger": { "accent": { "$type": "color", "$value": "#c9683b" } } } }
```

`$description` earns its keep on any token whose *use* is constrained. A token named
`accent` with no description gets used as a background fill within a week.

This file is the only place a value is authored. Everything else is generated from it.

## `tokens/css/<name>.css`

Generated, and it says so in a header comment. Two blocks:

```css
:root { --ds-color-ground: #0B0D10; }
[data-product="quiet-ledger"] { --ds-color-accent: #E0723A; }
```

The per-product scope is how one stylesheet serves a family. A product that owns an accent
overrides exactly the tokens it owns and inherits the rest — which is also why the accent
gate below checks four places rather than one.

## `profiles/<product>/DESIGN.md`

Per product. Narrows the foundation; never contradicts it.

- **What it is** — one paragraph, plain.
- **Voice** — how it talks, with an example of a message it would and wouldn't send.
- **Restraint** — how decorative this product's *surfaces* are allowed to be. Note that
  this governs the product, not its marketing.
- **Accent** — one of `own` / `inherits` / `none` / `undecided`, plus the value if `own`.
- **Motif** — the image language for generated art. This is the field the direction stage
  reads, and it is the hardest one to write well: it wants a *thing seen*, not an
  adjective. "Light that does not escape its own boundary" gives a renderer something to
  make; "trustworthy and calm" gives it nothing.
- **Rejected directions** — what was tried and didn't work, and why. The most valuable
  section and the one always left out. It is what stops the same wrong idea being
  regenerated every quarter.
- **Bans** — what this product specifically must not do.

## `catalog.json`

```json
{
  "products": [
    { "id": "quiet-ledger", "name": "Quiet Ledger",
      "profile": "profiles/quiet-ledger/DESIGN.md",
      "accent": { "mode": "own", "value": "#E0723A" } }
  ]
}
```

The inventory the validator iterates. If it isn't here, no gate covers it.

## `scripts/validate.mjs`

Node, no dependencies, exit non-zero on failure. Print every failure, not just the first —
a validator that stops at the first error makes fixing ten problems take ten runs.

### The gates

**Token parity.** Every token in the JSON has a CSS custom property; every custom property
traces to a token. Catches a hand-edited stylesheet, which is the single most common way
these repos rot.

**Contrast.** Every text/ground pairing the foundation declares, computed, against its
stated threshold. Compute — do not trust the swatch.

**Profile completeness.** Every catalog product has a profile file that exists and parses;
every profile directory appears in the catalog. Both directions, because each catches a
different half-finished edit.

**Accent parity.** For every product: the declared mode is one of the four legal values,
and if it is `own`, the value agrees across the token JSON (`product.<id>.accent`), the
catalog entry, the `[data-product]` scope in the CSS, and the README table. Four places,
one truth — and the token file is the one that makes it a *source* rather than three
hand-maintained copies agreeing by luck.

That fourth arm is easy to leave out, and leaving it out is worse than not claiming it: a
sweep of this suite found the gate documented as checking four places while checking
three, because per-product accents never reached the token file at all. A gate documented
wider than it checks is the dangerous kind, since people stop looking where it says it has
looked.

**Check `inherits`, not just `own`.** It is tempting to skip every product that doesn't own
an accent, and that was a real bug in this template until a run caught it. A product
inheriting from a **sibling** needs its own `[data-product]` scope, because `:root` carries
the *family* accent, not the sibling's. Without that scope the page renders the family
colour while using `var()` correctly, hardcoding nothing, and passing every other gate —
the same silent-wrong-colour failure the surface skill warns about, one layer up.

Inheriting from the family (no `from`) is the different case: `:root` already applies, so
no scope is wanted and none should be demanded.

Print open decisions every run rather than passing silently:

```
Open accent decisions (1): marketplace
```

An undecided accent that scrolls past in green is an undecided accent forever.

**Shared-accent report.** Not a failure — several products legitimately share a family
accent. But two products with `mode: own` on the same hex is almost always an accident, and
naming it costs one line.

### Proving the gates

For each gate: break the repo in exactly the way it exists to catch, run the validator,
confirm it fails with a message naming the file, and undo. Do this when you write it. A
gate nobody has seen fail is a gate you are guessing about.

## `README.md`

How to consume it, in this order: install/clone, which file to import, how to scope a
product, and the accent table. Then the contribution rule — values are authored in the
token JSON and the CSS is generated — because that is the rule newcomers break.
