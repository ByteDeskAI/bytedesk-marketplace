# The contract between the driver and the six specs

This file is the interface. `bin/rebrand` and `workflows/*.json` are written against it, and a
change here is a change to both.

## Stage ids and folders

| # | stage id | folder | produces (the artifact set the digest covers) |
|---|---|---|---|
| 1 | `discovery` | `01-discovery/` | `brief.md`, `audit.md`, `pages.json`, `assets/**` |
| 2 | `identity`  | `02-identity/`  | `IDENTITY.md` |
| 3 | `direction` | `03-direction/` | `notes.md`, `concepts/**`, `prompts/**`, `contact-sheet.html` |
| 4 | `theme`     | `04-theme/`     | `tokens.json`, `PALETTE.md` |
| 5 | `brand`     | `05-brand/`     | `*.png` only |
| 6 | `mockups`   | `06-mockups/`   | `*.png` only |

Order is fixed and serial. A stage may not start until the one before it is `complete` AND
approved AND its approval digest still matches what is on disk.

## What every spec receives

Every workflow takes exactly one required input the driver supplies:

- `client_dir` — absolute path to the case file. Everything else the agents need is inside it:
  `state.json` holds the brief, and every earlier stage's folder holds its output.

Specs may declare their own additional inputs with defaults (rounds, page list, provider chains).
The driver passes any `--input k=v` given on its own command line straight through.

## What every spec must do

1. Read `<client_dir>/state.json` for the brief, and the earlier stage folders for their output.
   **Refuse and name the missing stage** if an input artifact is absent — the `bytedesk-designer-*`
   skills already behave this way and the specs must not undercut it.
2. Write only into its own stage folder, and only the artifacts in the table above.
3. Write `artifacts/GATE-<stage>.md` in the run directory and stop, rather than proceeding.
4. Never edit `state.json`. The driver owns it; `rebrand collect` is what records a stage.

## One artifact a later stage reads as DATA

`01-discovery/pages.json` is stage 1's third deliverable and stage 6's input:

```json
{"source": "existing" | "proposed",
 "pages": [{"slug": "home", "title": "...", "url": "...", "why": "..."}]}
```

Stage 6 fans out one agent per page, and `for_each` expands when the spec is materialized — before
any agent runs — so stage 6 cannot read this file itself. `rebrand next` reads it and passes
`--input pages=<slugs>`; an explicit `--input pages=` on the command line wins. Four to six pages,
and never more than the fan-out cap of 8.

`source` is `existing` when the pages come from a site the client actually has, `proposed` when
discovery is arguing for the pages a client without one needs. `why` is one sentence on what the
page is for, and it becomes that page builder's brief.

Everything else moves between stages as prose, read by an agent. This one is read by a machine,
which is why its shape is pinned here.

## What the driver guarantees the specs

- The stage folder exists before the run starts.
- `runs/<stage>` in the case file symlinks to the run directory, so the mailbox, journal and
  per-round artifacts stay findable after the tmux session is gone.
