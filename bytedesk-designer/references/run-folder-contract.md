# The run-folder contract

Stages couple through **files on disk**, never through each other's internals. No member
of this suite reads another member's directory, imports another member's reference, or
assumes another member is installed. They all read and write one run folder.

This is what lets a stage be run alone, out of order, or twice, and lets the orchestrator
fan out to parallel subagents without them stepping on each other.

## Layout

```
<design-root>/runs/YYYY-MM-DD-<slug>/
  state.json          stages complete, artifacts produced, authority sha
  brief.md            discovery output — audience, surfaces, constraints, voice
  identity/           mark.svg, PNG ladder, favicon.ico, 16px proof sheet
  direction/
    prompts/          exactly what Codex was handed, one file per invocation
    images/           r1-a.png, r1-b.png … round + variant
    notes.md          provenance header, then critique per round
  surfaces/
    *.html            token-accurate implementations
    tokens/           vendored copy of the authority's CSS adapter
    .source-sha       the authority commit those tokens came from
  review/
    findings.json     blind-critic reads reconciled against the brief
    screenshots/
  contact-sheet.html  every variant side by side, dark ground
```

Run folders are named `YYYY-MM-DD-short-slug`. Keeping the prompt next to the artifact it
produced is what makes a good result reproducible three months later; an artifact with no
prompt beside it is a dead end.

## `state.json`

The substrate every member reads and writes.

```json
{
  "slug": "2026-08-27-quiet-ledger",
  "product": "quiet-ledger",
  "authority": {
    "path": "/home/me/Documents/GitHub/my-design-system",
    "sha": "9f3c1a7",
    "read_at": "2026-08-27T14:02:11Z"
  },
  "codex": { "version": "codex-cli 0.147.0", "verified_at": "2026-08-27T14:01:58Z" },
  "profile": {
    "source": "project",
    "path": "/home/me/solutions/acme/projects/quiet-ledger/DESIGN.md"
  },
  "stages": {
    "discovery": { "status": "complete", "artifacts": ["brief.md"] },
    "direction": {
      "status": "complete",
      "artifacts": ["direction/images/r2-a.png"],
      "rounds": 2,
      "viewed": ["direction/images/r1-a.png", "direction/images/r1-b.png",
                 "direction/images/r2-a.png"]
    },
    "surface": { "status": "blocked", "needs": "direction" }
  }
}
```

Four fields carry weight beyond bookkeeping:

- **`authority.sha`** — which commit of the design authority governed this run. Without it
  a run folder six months old cannot be explained, and a token that has since changed
  looks like a mistake rather than history.
- **`codex.version`** — provenance. An artifact's header claims Codex made it; this is the
  record that it did.
- **`profile`** — which profile governed this run, and where it was read from. `source` is
  `project`, `authority`, or `none`; `path` is absent when it is `none`. Resolution is the
  three-layer rule in the authority contract, and `authority-doctor.sh --product <id>`
  reports it. Without this field a run under a solution and a run under the authority look
  identical afterwards, though they may have been directed by different files.
- **`viewed`** — every artifact this stage actually inspected. A stage may not list an
  artifact in `artifacts` that is absent from `viewed`. This is the look-before-promoting
  rule made checkable rather than merely stated, and it is what the review stage and the
  orchestrator's evals assert against.

  **Record the content, not just the name.** Each entry carries the artifact's path and a
  hash of it at the moment it was looked at:
  `{"artifact": "surfaces/index.html", "sha": "sha256:309ac48aafe198b3"}`. A name list says
  a file with that name was seen once; it cannot say the file still holds what was seen. That
  distinction is not academic — a run whose `viewed` list passed on names shipped a verdict
  screen whose colour had been changed after the only render of it, and the check that should
  have caught it reported green. A hash that no longer matches means the artifact was edited
  after it was viewed, and it must be viewed again before it is promoted.

  **Hash what decides the render, not only the artifact.** A surface's markup is not what
  determines how it looks: its stylesheet, its script and its vendored tokens all do. A record
  covering only the `.html` files closes half the hole — observed on a run where the stylesheet
  changed by twenty-six lines, taking the landing's entire background treatment with it, while
  that page's own hash stayed byte-identical and the record read clean. A stage whose artifacts
  share render-affecting files records those too, as `renders_with`, and may carry a single
  `surface_tree_sha` over the whole set so one comparison catches any of them.

## Rules

**A stage refuses to run when its inputs are absent, and names the stage that produces
them.** `{"status": "blocked", "needs": "direction"}` plus a plain sentence — "no
`brief.md` in this run; run discovery first" — beats inventing a brief and proceeding.

**A stage never edits another stage's artifacts.** It appends its own. Re-running a stage
overwrites only that stage's subtree and resets only its own `state.json` entry.

**Nothing is cached from the authority except the vendored tokens**, and those carry
`.source-sha` so drift is detectable. Values are read live, every run. A palette copied
into a skill file is drift waiting to happen.

**Provenance headers open every notes file.** Under a governed authority this is required;
everywhere else it is still what stops a generated draft being mistaken later for an
approved decision.

```
Tool: codex exec (codex-cli 0.147.0), native image_gen
Date: 2026-08-27
Requested by: <name>
Authority: <repo> @ <sha> — <profiles and token files read>
Profile: <project|authority|inherited> — <path, or "foundation only">
Status: exploration — not approved, not production source
```

## Where the run folder lives

`<design-root>` resolves in this order:

1. an explicit `--design-root` argument
2. `runs/` inside the resolved design authority, if it is writable
3. `~/Pictures/claude-design/` as the fallback for a read-only or remote authority

Say which one was chosen the first time a run folder is created. An operator who cannot
find their output assumes the run failed.
