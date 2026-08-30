# ByteDesk Agent Browser — DESIGN.md

Design system for the marketing site (`src/styles/global.css` implements this).
Direction: **precision instrument**. The product is infrastructure that agents
drive — the site should read like a well-made tool: light paper, hairline
rules, one dark band, and real telemetry used as ornament instead of
decoration.

## Type — IBM Plex superfamily

One superfamily, three roles. IBM Plex was designed for the human⇄machine
relationship, which is literally the product.

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
- `--color-band` 15% — the **one** near-black band per page + the IDE
- `--color-accent` cyan-blue oklch(56% .15 250) — CTAs, links, active states, status dots. Keep total accent footprint ≤5% of the page.

## Signature elements

1. **Telemetry as ornament** — small IBM Plex Mono readouts with a pulsing
   status dot (`.tele`), showing *real* product numbers (warm claim 214ms,
   pool state). Used in the hero eyebrow and footer base bar. This replaces
   generic badge pills.
2. **Blueprint dot-grid** (`.hero-field`) — static radial-dot grid fading out
   under the hero, with one soft accent glow behind the console panel.
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
  panel and IDE.
- One dark band per page.
- Sentence case everywhere; uppercase only for `.label`/`.tag` (0.09em
  tracking).
- Buttons: solid accent, accent wash, or ghost. 44px min height.
- Focus visible (2px accent outline), keyboard reachable, reduced-motion
  respected — non-negotiable.

## Landing page signature (2026-07 redesign)

Final: **A · Pointer Proof is the signature** (hero) — `demo/features/useos.sh`
re-enacted: a drawn Xvfb desktop where the OS cursor travels to (321,222),
then a terminal verifies with `xdotool getmouselocation` and prints PASS.
Run-once choreography (~5s), not a loop.

Supporting, deliberately quieter: **C · Frame Splice** (section diagram —
sealed WebSocket frames passing the gateway hairline, `+0.5 ms`) and the
webhook-event-name section eyebrows (the surviving idea from candidate B).

**B · Wire Ledger** (fixed right rail showing one session's lifecycle,
lighting up per section) was built and then removed: it only fit viewports
≥1540px (1120px wrap + rail width), went illegible over the dark band, and a
signature most visitors never see isn't a signature.

Tried and rejected: infinite-looping the Pointer Proof (distracting; CSS vars
in keyframe selectors are also invalid so per-line delays run once); the
ledger below 1540px (overlap + illegible over the dark band); numbered 01/02/03
section markers (replaced with real webhook event names as eyebrows). All
landing-page copy uses the real wire contract (`agent-browser-api-key`,
`Agent-Browser-Signature: t=…,v1=…`, 175 endpoints, 16 events) — no legacy
vendor branding on this page. Primary CTA is the literal build command
(click-to-copy `go build ./cmd/server`).

## Hero pattern + chrome (2026-07 presence pass)

One reusable hero: `src/components/Hero.astro`. Props `eyebrow` (+`tele` for
the telemetry chip) and slots `title` / `lede` / `actions` / `extra` /
`aside` (index only — the Pointer Proof). Content varies per page; the
system never does. No page authors its own hero markup anymore.

**Background scene — "the session rack":** drawn hairline X-display frames
(3, receding right at falling opacity) on one horizontal CDP wire; a single
accent trace draws along the wire once on load (the hero's one motion
moment). Under it, the shared dot-grid. Pure inline SVG/CSS, ~3KB, zero
requests. Text protection: frames live in the right half; a left-anchored
paper scrim (fades ~38→68%) plus a bottom fade keep headline contrast ≥ AA.

Rejected: keeping the old `.hero-field` accent glow under the scene (reads
as fog — display:none'd inside heroes); frames drifting left of ~x600 (grazes
the headline column); CSS transform entrances on the SVG groups (a CSS
transform overrides the `transform` attribute — frames fade opacity-only).

**Header:** height compresses 64→56px on scroll; real mobile menu under
900px (hamburger, focus-trapped, Escape closes, aria-expanded, scroll lock).
**Footer:** designed close — wordmark + serif tagline row with a quiet
copy-command CTA, hairline, columns, Plex Mono telemetry base bar with
build-date stamp, dot-grid fading upward to bookend the hero.

## Audit pass (2026-07-18)

Site-wide audit against the product repo. What changed:

- **Anchor purge completed** — quickstart code samples, features/self-hosting/
  cloud cards, os-control ("Beyond the standard REST surface."), blog post 1,
  community credits, and `site.js` (tagline, oneLiner, stats). The name now
  appears only in the comparison matrix. Tagline is
  "The open-source cloud browser that gives agents a real display."
- **`[hidden] { display:none !important }` added to global.css** — author
  `display:flex` on `.waitlist-ok` was defeating the attribute, showing the
  cloud waitlist success state before submit. Root-cause guard, site-wide.
- **Index proof ladder gained row 3** ("Watch it. Or take the wheel.") — the
  hero's noVNC/HITL claim now has its artifact: the real `live_view_url`
  envelope + `agent/request-intervention` curl.
- **Features page de-templated** — the duplicate "OS-level control" title was
  actually two different groups; the first is now "Browser control (REST)".
  Numbered 01–12 eyebrows (order carried no information) replaced with real
  route prefixes in Plex Mono accent (`/v1/webhooks`, `useOs · xdotool ·
  noVNC`), and three dark terminal artifacts (webhook signature, pool
  metrics, xdotool verify) break the card-grid rhythm.
- **Comparison** gained rows for agent step streaming (`/ws`) and the 175-
  endpoint REST surface, plus a mobile-only "scroll for all six columns →"
  mono hint above the table.
- **Quickstart** tail cut from five next-step cards to the two that continue
  the journey (OS-control, self-hosting).

## Photography amendment (2026-07-18)

The "no stock photography" rule is amended: real photography is allowed in ONE
place only — the hero background scene — and only through the shared recipe
below. Everywhere else the rule stands.

**The recipe** (one block in `Hero.astro`, identical on every page; if a photo
fights the recipe, swap the photo — never loosen the recipe):

- `<picture>` layer painted first, under dot-grid → SVG session rack → scrim.
- `filter: grayscale(0.85) contrast(0.92) brightness(1.08)`; shown at
  `opacity: 0.34` desktop, `0.20` ≤640px (photo = atmosphere; drawn artifacts
  remain the subject). Hero scrim fades 38%→72%.
- Accent tint only via `oklch(56% 0.15 250 / 0.05)` + `mix-blend-mode: color`
  (token-sourced; never the photo's own palette).
- Progressive: headline renders on paper immediately; photo fades in onload
  (600ms). No-JS = paper hero. Explicit width/height (no CLS), eager +
  fetchpriority=high (it's inside the LCP viewport), 768w variant ≤768px.
- Budgets: 1920w ≤150KB, 768w ≤60KB WebP (0.5–0.8px pre-blur buys the
  headroom — invisible at 34% opacity). Assets in `src/assets/heroes/`,
  self-hosted, hashed by the build.
- Contrast is proven, not eyeballed, for BOTH text colors: worst-case
  composited pixel under the text zone ≥ AA at 1280 and 390 for ink headlines
  (11.3–14.4:1) AND the ink-2 lede (4.74–5.88:1 — the binding constraint; the
  0.20 mobile opacity and 72% scrim endpoint exist because of it).
- LCP guard: index median 496ms (before) → 464ms (after); regression >200ms
  kills the image, not the budget.

**Sourcing table** (all commercial-use, no attribution required, self-hosted):

| Page | Photographer | License | Source |
|---|---|---|---|
| index | Brett Sayles | Pexels | pexels.com/photo/4508751 |
| os-control | Igor Saikin | Unsplash | unsplash.com/photos/E840iJGN8_k |
| quickstart | Pixabay | Pexels/CC0 | pexels.com/photo/301703 |
| self-hosting | Brett Sayles | Pexels | pexels.com/photo/2881229 |
| cloud | Miha Meglic | Unsplash | unsplash.com/photos/p7Bfwn_VKRQ |
| comparison | Carlos Yanez | Pexels | pexels.com/photo/5290119 |
| community | Kim Stiver | Pexels | pexels.com/photo/909256 |
| use-cases | Nicolas Thomas | Unsplash | unsplash.com/photos/3GZi6OpSDcY |
| blog | Sven Mieke | Unsplash | unsplash.com/photos/fteR0e2BzKo |
| features | He Junhui | Unsplash | unsplash.com/photos/cMoE2tU_BbM |

**QA (two adversarial rounds, one reviewer per hero + a cohesion judge):**
round 1 failed three heroes. quickstart (gold tools on black) and features
(wall-to-wall circuit macro) both failed for the same root cause — large
dark/dense fields with no quiet zone compete with the headline at 34% — and
were REPLACED, not treated (dark-field photos are now a known-bad class for
this recipe). community had a legible "SEARS 30124" stamp on a pliers handle:
retouched out with a feathered blur in the source asset. Round-1 reviewers also
independently flagged the accent trace/wire striking through the wrapped lede
at 390px on five pages → the wire+trace are now display:none ≤640px (frames
stay), and the trace stroke fades at both ends via an SVG gradient so it never
hits a text column or the viewport bleed as a hard line. Inline code chips got
white-space:nowrap (mid-token wraps read as typos). Ghost-text/washed-section
reports from screenshots taken on the dev server were artifacts (scroll-reveal
mid-animation + the Astro dev toolbar); QA screenshots must come from the
production preview.

Rejected on inspection (30 candidates reviewed): legible "Mitutoyo" branding;
bare fingers in frame; branded power tools; construction-site props
(off-subject); portrait orientation (×2); reads-as-derelict control room;
subject-free minimal books; two cross-page duplicates (Saikin console → kept
for os-control only; Debiève PCB dropped for the gold-trace macro).

## Generated art

The family contract is [`DESIGN.md` §10](../../DESIGN.md) — read it first. It holds the
invariants: unlifted dark ground, exactly one lit element, accent as edge-light or
contained glow and never a fill, matte with fine grain, composition that breathes, and
the hard limit that generated art carries no logos, copy, controls, invented metrics,
functional icons, or rasterized UI.

This section supplies the half that must not be shared.

**Motif — A precision instrument's construction drawing — on paper.**

This profile calls for light paper and hairlines rather than the family dark. Fine construction lines, circles and dashed guides on warm off-white, with one short segment picked out in the accent.

**Accent:** product.agent-browser cyan, read live from `tokens/`. Never sampled from a rendered image.

**Watch for:** **The one deliberate exception to the dark ground.** It is profile-driven, not a mistake, and it does not license lightness anywhere else in the family.

A piece that would work equally well for another ByteDesk product has failed this
section, however good it looks.
