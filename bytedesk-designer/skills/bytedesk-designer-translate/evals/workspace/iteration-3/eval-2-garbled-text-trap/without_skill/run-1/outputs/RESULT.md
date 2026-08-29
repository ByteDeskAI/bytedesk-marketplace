# New-project dialog — HTML translation of r4-p4.png

## What I would say to the user

Built the New project dialog as a self-contained HTML page at 1586x992, matching the mockup's layout: three-column shell (sidebar 386 / stage / inspector 362), the modal at the same pixel position and size (450,135 → 687x648), the same type-card grid (Web 3 / Brand 2 / Marketing 3 / Product 2 / Content 2 / Custom dashed), the "3 types added by this solution" mono hint, and the Cancel / Create project actions. All colours come from `--bd-*` tokens in the design-system repo (`tokens/css/bytedesk.css`, vendored verbatim into the file's `<style>` so it opens anywhere); the page runs at `data-bd-richness="rich"` because the mockup's base is #090C0F, which is the rich preset. Three panel surfaces (#0E1216 cards, #161A20 modal, #0F1519 type cards) are sampled from the PNG because no token sits at those values — they are the only non-token colours and are called out at the top of the stylesheet.

Inspector: per your note, it shows the selected project rather than image-file details — Selection "Marketing site", Details (ID `prj_a91c4e02`, Type Website, Solution, Assets, Created, Agent claude, Status draft), Tags, Notes, History, and Project settings filled in from the dialog values. Those IDs/dates are placeholder sample data; swap for real bindings.

Not literally pixel-identical: text rasterisation differs from the mockup (it was rendered by an image model, not a browser) so glyph widths drift by a pixel or two, and wrap points in the 12px card descriptions had to be tuned by hand. Structural positions (columns, dialog box, cards, buttons, thumbnails, toolbar) are within ~2px. The hero artwork and thumbnails are cropped from the mockup itself (the dialog region of the hero is painted out because the modal covers it).

Verify: open `new-project-dialog.html` in Chrome at 1586x992, or look at `compare.png` (render on the left, mockup on the right).

## Files (all in this directory)

- `new-project-dialog.html` — the page (tokens inlined; references hero.jpg + the two thumbs)
- `hero.jpg`, `thumb-r1a.jpg`, `thumb-r2a.jpg` — artwork cropped from r4-p4.png
- `render.png` — headless Chrome screenshot of the HTML at 1586x992
- `compare.png` — render | mockup side by side
- `dialog-crop.png` — close-up of the dialog
- `RESULT.md` — this file

## Notes / deviations

- Font: IBM Plex Sans / Mono (installed locally; the token stack falls back to system-ui elsewhere).
- Non-token colours: `--panel #0E1216`, `--dialog #161A20`, `--card #0F1519`, note/input fill #0D1115, canvas #0A0C10 — sampled from the mockup.
- Left sidebar scrollbar rail and status dots are decorative, not functional. No JS.
