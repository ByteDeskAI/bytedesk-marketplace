# Failed-render state — build from mockup r3-s5

## Files (all in this directory)

| File | What it is |
|---|---|
| `failed-render.html` | The deliverable. Self-contained 1280×800 page for the studio's failed-render ("exhausted") state. |
| `bytedesk.tokens.css` | Verbatim copy of `design-system/tokens/css/bytedesk.css` (the authority's canonical `--bd-*` token file). Linked by the HTML; the authority repo was not modified. |
| `build-1280x800.png` | Screenshot of `failed-render.html` at exactly 1280×800 (headless Chromium). |
| `mockup-r3-s5.png` | Copy of the approved mockup for side-by-side comparison (original is 1586×992, i.e. the 1280×800 window at ~1.24× scale). |

## What I did

1. Read the mockup and measured it against the stated 1280×800 window (scale ≈ 1.239): 12 px outer padding, three columns ≈ 320 / 1fr / 300 with 8 px gutters; left column stacks agents → runs → log → composer; centre stacks preview → variant strip → action row; right stacks Brief / Art direction / Critique.
2. Read the design authority: `DESIGN.md` (token-first, Black Glass + Optical Layering, IBM Plex Sans/Mono, 8 px rhythm, hairlines, "colour never carries state alone", status = dot + word) and `tokens/css/bytedesk.css`. There is no `profiles/designer-studio` profile, so only the shared family foundation applies.
3. Built the HTML with layout-only CSS; every colour, font, radius, spacing and control size resolves to a `--bd-*` token:
   - ground `--bd-bg-base`, panels `--bd-bg-surface` + `--bd-border-dimmer` hairline + `--bd-material-top-light` inset,
   - failed / exhausted / `failed` runs → `--bd-danger`; ok → `--bd-success`; selected run row → `--bd-bg-elevated`,
   - Re-render and Send → `--bd-brand-orange` with `--bd-text-on-brand` and `--bd-shadow-attention-glow`; selected variant thumb → `--bd-brand-orange` 2 px (`--bd-stroke-active`),
   - all identifiers, timestamps, versions, log bodies, run ids, attempts table, critique → `--bd-font-mono`; prose (brief, labels, buttons) → `--bd-font-sans`,
   - statuses rendered as dot + word, buttons carry `:focus-visible` rings via `--bd-focus-ring`, live regions on log/preview.
4. Rendered and compared. Two iterations: first pass clipped the last log entry (`system 10:36:35 Render failed.`); tightened log line-height/entry gap and agent-row/composer heights by a few px so every entry the mockup shows is visible without scrolling.

## Known deviations from the mockup

- Font rendering: mockup appears to use a slightly wider mono; build uses IBM Plex Mono per the authority (loaded from Google Fonts — offline it falls back to `ui-monospace`).
- Mockup's attempt table is ~20 px narrower; row/column spacing otherwise matches.
- Colours are the token values, not eyedropped from the PNG (authority rule: tokens win when pixels are ambiguous).

## Verification notes

- agent-browser navigated the file fine but its screenshot came back in an unreadable format, and `google-chrome --headless` hung on the `file://` URL, so the screenshot was taken with Playwright's `chrome-headless-shell` at `--window-size=1280,800` (fallback stated per the browser-tool rule).
- No git commands were run; nothing outside this directory was edited.
