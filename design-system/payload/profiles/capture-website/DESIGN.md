# ByteDesk Capture — DESIGN.md

Design system for the **marketing site** (`src/styles/global.css`).

**Authority:** This file is the visual law for Capture marketing pages (tokens,
type, motion, rules). Product-specific signature and page notes below are for
**Capture** only.

Direction: **precision instrument.** Capture is desk software agents and humans
use for visual proof — the site should read like a well-made tool: light paper,
hairline rules, one dark band, and real product telemetry as ornament instead of
decoration.

## Type — IBM Plex superfamily

One superfamily, three roles. IBM Plex was designed for the human⇄machine
relationship.

| Role    | Face            | Usage |
|---------|-----------------|-------|
| Display | IBM Plex Sans 600/700, −0.02…−0.03em tracking | h1–h4, stat numbers, wordmark |
| Body    | IBM Plex Sans 400/500/600 | everything else |
| Serif   | IBM Plex Serif italic | one pull-quote per page, max |
| Mono    | IBM Plex Mono | code surfaces (dark IDE) **and** telemetry readouts (`.tele`, footer base bar). Never body text. |

Loaded from Google Fonts in `global.css`. Do not add other families.

## Color

Defined as oklch tokens in `:root`:

- `--color-paper` white / `--color-paper-2` wash — page ground
- `--color-ink` 18% / `--color-ink-2` 45% — text
- `--color-rule` 92% — hairlines (borders are 1px rules, never shadows-as-borders)
- `--color-band` 15% — the **one** near-black band per page + the IDE/console
- `--color-accent` cyan-blue oklch(56% .15 250) — CTAs, links, active states, status dots. Keep total accent footprint ≤5% of the page.

Product accent alignment (app UI uses `#0a84ff`): marketing accent is the oklch
token above — do not hard-code app hex into marketing CSS unless it maps to the
same oklch family.

## Signature elements

1. **Telemetry as ornament** — small IBM Plex Mono readouts with a pulsing
   status dot (`.tele`), showing *real* product numbers (e.g. hotkey reload
   ~1s, 30-day history retention, tray-only cold start). Used in the hero
   eyebrow and footer base bar. Replaces generic badge pills.
2. **Blueprint dot-grid** (`.hero-field`) — static radial-dot grid fading out
   under the hero, with one soft accent glow behind a product panel.
   Replaces animated aurora blobs.
3. **Drawn underline** on one headline word (`.mark`).

One signature moment per section; everything else stays quiet.

## Motion

- Ease `cubic-bezier(0.16,1,0.3,1)`, durations 180/240/320ms.
- Scroll reveals are progressive enhancement (visible without JS).
- Premium tier (magnetic buttons, panel tilt, band glow) only on fine
  pointers; everything respects `prefers-reduced-motion`.

## Rules

- Hairline rules over drop shadows; the only large shadow is under the hero
  panel and IDE/console mock.
- One dark band per page.
- Sentence case everywhere; uppercase only for `.label`/`.tag` (0.09em
  tracking).
- Buttons: solid accent, accent wash, or ghost. 44px min height.
- Focus visible (2px accent outline), keyboard reachable, reduced-motion
  respected — non-negotiable.
- No stock photography except optional hero atmosphere (grayscale wash,
  scrim, AA contrast proven). Prefer drawn capture UI chrome as the subject.

## Capture landing signature (planned)

Final direction (owner-ready): **A · Tray Proof is the signature** (hero) —
re-enact a real Capture flow: tray popover (A+B hybrid) → area selection with
size badge → quick overlay with Copy / Annotate / Pin. Run-once choreography
(~5–6s), not a loop. Prefer live product UI stills or vector mock of the
actual tray density over stock screenshots of unrelated apps.

Supporting, deliberately quieter:

- **B · Annotate rail** — monoline tool grid + accent copy CTA (section diagram)
- **C · Evidence path** — still → OCR/annotate → local share / evidence package
  (mission/ticket) as a three-step hairline ladder

Rejected for Capture marketing:

- Neon “screenshot SaaS” gradients and purple/pink CTAs
- Tall marketing button-stack tray mock (product rejected this; A+B hybrid only)
- Infinite-looping capture demos (distracting; reduced-motion hostile)
- Claiming hosted cloud teams as shipping (Deferred in product)

Primary CTA should be a **literal install/run command** (click-to-copy), e.g.
`cargo install --path crates/capture-app` or the release binary name
`bytedesk-capture`, not a vague “Get started” without a command.

## Hero pattern + chrome

Implementation pattern:

- `Hero` component: props `eyebrow` (+ optional `tele`), slots
  `title` / `lede` / `actions` / `extra` / `aside` (index only — the Tray Proof).
- Header compress on scroll; real mobile menu under 900px.
- Footer: wordmark + serif tagline, hairline, columns, Plex Mono telemetry base
  bar with build-date stamp.

**Capture-specific hero scene (when built):** drawn hairline frames suggesting
a multi-monitor desk + tray popover card on the right; left paper scrim for
headline contrast. No Electron/browser chrome in the mock — Capture is native
Rust (egui today).

## Anti-patterns

- Large primary button stacks in product UI mockups
- Glass blur marketing chrome
- Emoji-as-icon in product frames
- Accent >5% of the page
- Claiming ADE/gpui as the current shipping shell (v1 is egui; gpui is follow-up)
- Hosted cloud / teams as available (Deferred)

## Implementation notes

| Artifact | Location (when site lands) |
|----------|----------------------------|
| Tokens + type | `src/styles/global.css` |
| Copy / nav | `src/data/site.js` (or equivalent) |
| Product truth | `PRODUCT.md` (this repo root) |
| Feature claims | `FEATURES.md` + product repo `docs/` |

Do not invent latency SLAs or user counts. Prefer labeled targets or countable
product facts (CLI surface, hotkey matrix, retention days, local-first residency).

## Generated art

The family contract is [`DESIGN.md` §10](../../DESIGN.md) — read it first. It holds the
invariants: unlifted dark ground, exactly one lit element, accent as edge-light or
contained glow and never a fill, matte with fine grain, composition that breathes, and
the hard limit that generated art carries no logos, copy, controls, invented metrics,
functional icons, or rasterized UI.

This section supplies the half that must not be shared.

**Motif — A bright moment taken out of a calm field.**

The marketing surface for capture: one rectangular region noticeably brighter than the field around it, as though a light were switched on inside that rectangle alone.

**Accent:** product.capture bright blue, read live from `tokens/`. Never sampled from a rendered image.

**Watch for:** Marketing may be more striking than the tray. It may not invent controls or show a captured screenshot.

A piece that would work equally well for another ByteDesk product has failed this
section, however good it looks.
