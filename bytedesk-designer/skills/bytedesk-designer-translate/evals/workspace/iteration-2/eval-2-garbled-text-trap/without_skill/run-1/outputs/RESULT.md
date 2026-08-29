# New project dialog — HTML build

Files (all in this directory):

- `new-project-dialog.html` — the page. 1280×800 workbench, self-contained (tokens inlined from
  `design-system/tokens/css/bytedesk.css`, IBM Plex from Google Fonts with local fallback, artifact
  images embedded as data URIs). Open it directly in a browser.
- `render-1x.png` — screenshot of the page at 1280×800 (Chromium via Playwright).
- `side-by-side.png` — left: my render; right: the mockup scaled to 1280×800 for comparison.

## What I'd say to you

Built the new-project dialog and the workbench behind it as HTML against the `--bd-*` tokens. Layout,
geometry, copy and hierarchy follow the mockup: 313 / fluid / 292 columns with hairline dividers,
Solution row, Agents block (dot + word status, mono versions, Connect), Projects block, conversation
timeline with mono file rows, composer with orange Send; canvas stage, r1-a / r2-a strip (r2-a outlined),
Re-render / New variant / Ask agent / Blind read toolbar; and the modal — Name field, the six family
groups with the card widths measured off the mockup (Web 94/88/89, Brand 102/106, Content 101/102,
dashed "Define your own" 269), Website outlined in orange, mono footnote "3 types added by this
solution", Cancel / Create project.

Two things I deliberately did not copy pixel-for-pixel, because the authority says not to:

1. **Colours come from `tokens/css/bytedesk.css`, not the PNG.** The mockup is generated art
   (DESIGN.md §10: exploration, never implementation source; never read a colour off it). Its ground is
   near-black and its orange is warmer than brand; the page uses `--bd-bg-base #101316`, `--bd-bg-surface
   #1D2125`, `--bd-brand-orange #EC4E02`, `--bd-success/--bd-danger/--bd-warning`, and
   `--bd-overlay-backdrop` for the scrim. So it will not diff to zero against the PNG — by design.
2. **Inspector shows the selected project**, per your note and the app's own inspector pattern (r4-p5):
   Solution (connected, mono path, `@ 9f3c1a7`) → Project name + `type · active · created` → Brief
   prompts checkboxes → Deliverables as mono paths with dots → Stages strip using the real stage names
   (discovery / direction / surface / identity / review / publish, not the mockup's build / launch) → Brief
   → Art direction. The mockup's image-file inspector (ID / Type / Dimensions / Tags) is gone.

One consequence: the mockup's Projects block says "No projects yet", which can't coexist with a
selected project in the inspector. I populated it with two rows (E-commerce platform · active, selected;
Internal docs · active) so the two panels agree. If you'd rather keep the empty state, the inspector
would need an empty state too — say which.

Other notes:
- Conversation prose is set in Plex Sans, not mono (the r2-a nit in the run notes); mono is kept for
  timestamps, versions, paths and the footnote.
- The stage image is a crop of the r2-a artifact from r4-p5 (the one in r4-p4 is under the dialog);
  thumbnails are crops from r4-p4. They are content, not chrome, so embedding them is fine.
- Card descriptions at the mockup's ~10px wrap to three lines in two cards ("Website", "Illustration
  set"); the mockup fits them in two with a slightly narrower face. Not worth fighting — it is a
  generated-type artefact.
- The scrim dims the stage more than the mockup does; that is `--bd-overlay-backdrop` (72 % base).
- No garbled text in this mockup's dialog; all labels transcribed as shown ("IOS" corrected to "iOS").
- Nothing outside this outputs directory was touched; the authority repo was read only.
