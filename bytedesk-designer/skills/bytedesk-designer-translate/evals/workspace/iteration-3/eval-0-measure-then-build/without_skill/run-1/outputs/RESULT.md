# Studio failed-render state — build from mockup r3-s5.png

## Files

- `studio-failed-render.html` — the page. Open directly (file://); fonts load from Google Fonts, fall back to the token stack.
- `bytedesk.tokens.css` — verbatim copy of `design-system/tokens/css/bytedesk.css` (vendored beside the page, the way a consumer vendors `.context/design-system`). Authority repo untouched.
- `screenshot-1280x800.png` — headless Chromium render at 1280x800.

## What I did

1. Measured the mockup. It is 1586x992, i.e. 1.239x the stated 1280x800 window. Scanned rows/columns for edge transitions and sampled fills.
   Result in CSS px: 14px outer margin, 10px gutters, columns 322 / 610 / 304. Left shell blocks: agents 156, runs 180, log ~300, composer 125. Center: stage, thumbnail strip, action row. Right: brief / art direction / critique.
2. Read the authority: `DESIGN.md` (Black Glass shell, Plex Sans + Plex Mono, 8px rhythm, 1px hairlines, orange as restrained spark, blue for interaction, semantic colours for status) and `tokens/bytedesk.tokens.json`. There is no `profiles/studio/`, so only the shared foundation applies.
3. Mapped sampled colours to tokens instead of copying hexes (the authority forbids reading colour off generated art): canvas -> `--bd-bg-base`, shells -> `--bd-bg-subtle`, attempts table -> theme.dark.inset, selected run -> `--bd-bg-surface`, buttons -> `--bd-bg-elevated`, primary buttons and thumb border -> `--bd-brand-orange`, ok/failed/exhausted -> `--bd-success` / `--bd-danger`, focus -> `--bd-shadow-focus-glow`.
4. Type: mono is the body voice (`type.console` 12.5px in the center, `console-sm` 11px in the sidebars, which is what makes the mockup's log lines fit at 322px); Sans for headings, agent names, buttons, and the brief.
5. Rendered at 1280x800 with chrome-headless-shell and compared against the mockup; one iteration to tighten sidebar type so all five log entries show.

## Known deltas from the mockup

- The Retry button and Connect buttons are a few px shorter than the mockup's; controls use the 28px `size.control.compact` token.
- The thumbnail's underline separator and the attempts table use token hairlines, not the mockup's slightly heavier lines.
- Status text uses token semantic red/green rather than the mockup's sampled values.
