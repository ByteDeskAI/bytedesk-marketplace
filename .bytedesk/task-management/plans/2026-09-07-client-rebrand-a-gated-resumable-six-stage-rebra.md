# `client-rebrand` — a gated, resumable six-stage rebrand workflow

## Context

Viking Power Washing (Cincinnati, owner Chris Sulzer, trading since 2014) is renaming to
**Viking Surface Care**. That is the first job, but the deliverable here is the *machine*: an
abstract workflow that takes any client's details at the start, carries them through six stages,
stops for human approval between each, and can be put down for a week and picked back up.

Two findings from the codebase shape the whole design.

**There is no resume in the orchestration layer, and there cannot usefully be one.** `stop` is a
one-way door: `run.state = "stopped"` is the only thing written, and `killSession` takes the panes
with it (`topology/cli.mjs:773-793`, `lib/tmux.mjs:233`). `launchRun` refuses an existing run
directory outright — `invariant(!(await exists(join(spec.run_dir, "run.json"))), "TOPOLOGY_RUN_EXISTS", …)`
at `lib/launch.mjs:556`. Crucially, **each agent's model context dies with its pane**, so a
"resumed" conductor would have to be re-briefed from files regardless. Resume and *launch the next
stage from durable files* are therefore the same operation, and the second is simpler and needs no
weakening of that guard. Gates and stages are likewise **prose only** — `describeGates`
(`lib/launch.mjs:60-63`) renders Markdown into the conductor's BOOTSTRAP.md and nothing ever reads
`run.gates` back. A gate today is a sentence asking a model to stop.

**`bytedesk-designer` already solves the durable half.** Its run-folder contract
(`bytedesk-designer/references/run-folder-contract.md`) defines a resumable folder with a
`state.json` carrying per-stage `status` / `artifacts` / `needs` and a `viewed` list that records
**`{"artifact": …, "sha": "sha256:…"}`** — content hashes, not names, precisely so "this was
approved" cannot come to describe a file that changed afterwards. Its SKILL.md has a *Resuming*
section: read `state.json`, continue from the first incomplete stage, and cross-check artifacts on
disk because "a stage whose files have been deleted is incomplete regardless of what the JSON says."
Nine stage skills exist locally and each refuses to run without its predecessor's artifact.

So: **do not build a new state machine.** Extend that contract with approvals, drive it with the
orchestration layer, and let "stopped between stages" mean what it already means — nothing running.

One trap to avoid: the two shipped brand specs (`workflows/logo-design.json`,
`brand-identity-tournament.json`) reference `brand-brief`, `brand-concept`, `brand-judge`,
`brand-explore` and `design-system-assets` — **all five are absent** from every skill directory, so
those workflows launch with three of four skills missing and an agent told to carry on without.
Verified. The new specs must use the `bytedesk-designer-*` skills, which resolve.

## What gets built

A new plugin, `client-rebrand/`, because this is a capability with a CLI, six specs and a skill —
too much to bolt onto `agent-orchestration` (which stays domain-neutral) or onto
`bytedesk-designer` (whose suite stays intact and is consumed here).

```
client-rebrand/
  .claude-plugin/plugin.json        versionless, per .claude/rules/version-enforcement.md
  bin/rebrand                       the driver — gate enforcement, state, launching
  workflows/
    client-rebrand-1-discovery.json
    client-rebrand-2-identity.json
    client-rebrand-3-direction.json
    client-rebrand-4-theme.json
    client-rebrand-5-brand.json
    client-rebrand-6-mockups.json
  skills/client-rebrand/SKILL.md    how an agent drives this for an operator
  tests/test-rebrand.sh             gate + state logic, bash, self-isolating via mktemp
  CHANGELOG.md  README.md
```

Plus a registration line in `.claude-plugin/marketplace.json`.

### The case file

Per the answers: a **sibling client repo**, `~/Documents/GitHub/ByteDeskAI/clients/<slug>/`, its own
git repo, created by `rebrand new`. It is `bytedesk-designer`'s run folder with one addition:

```
clients/viking-surface-care/
  state.json          the bytedesk-designer contract + an `approval` block per stage
  01-discovery/  brief.md, audit.md, assets/ (harvested logo, screenshots, palette, sitemap)
  02-identity/   IDENTITY.md
  03-direction/  concepts/, prompts/, notes.md, contact-sheet.html
  04-theme/      tokens.json, PALETTE.md
  05-brand/      *.png only  (no SVG — operator's rule)
  06-mockups/    <page>.png only
  runs/          symlinks to each stage's AO run dir, so the trail survives
```

`approval`, mirroring `viewed`'s existing hash discipline so an approval is bound to bytes:

```json
"stages": {
  "discovery": {
    "status": "complete",
    "artifacts": ["01-discovery/brief.md"],
    "viewed": [{"artifact": "01-discovery/brief.md", "sha": "sha256:…"}],
    "approval": {"by": "ryan", "at": "2026-09-07T…Z", "digest": "sha256:…", "note": "…"}
  }
}
```

`digest` is over the stage's full artifact set, sorted. `rebrand next` recomputes it and **refuses
to advance if it no longer matches** — an approval that has drifted from what was approved is not an
approval. This is the same rule `task-management/lib/planner-ops.mjs` already applies to board
mutations, and the same rule the run-folder contract applies to `viewed`.

### The driver, `bin/rebrand`

Plain bash + `python3` for JSON, matching `task-management/bin/tm` and the plugin's test idiom.

| Command | Behaviour |
|---|---|
| `rebrand new <slug> --name "…" --input k=v…` | git-init the client repo, write `state.json`, record the brief |
| `rebrand status` | which stage is next, what is approved, what drifted |
| `rebrand next [--dry-run]` | refuse unless the previous stage is `complete` **and** its approval digest still matches; then `ao-topology launch` that stage's spec with `--input client_dir=…` |
| `rebrand approve <stage> [--note]` | record `by`/`at`/`digest` over the stage's artifacts |
| `rebrand reject <stage> --why` | mark `revise`, keep the round, feed the reason into the relaunch |
| `rebrand collect <stage>` | copy the AO run's artifacts into the stage folder, hash them, mark `complete` |

Stopping between stages needs no command: when a stage's run is stopped, nothing is running.
Resuming is `rebrand next`.

### The six specs

All abstract. Every one takes `client_dir` plus its own inputs, reads prior stages from disk, and
writes only into its own stage folder. Structure lifted from `workflows/logo-design.json` (stage
list, `loop_until` + `max_rounds` revise loop, human gate); blind two-designer judging lifted from
`showcase-design-tournament.json`; the corrected raster/vector tooling paragraph lifted verbatim from
`showcase-astra-image-pipeline.json`, which is the only instruction text in the repo already fixed
against a real failure.

| # | Stage | Roster | Produces |
|---|---|---|---|
| 1 | discovery | conductor, 2× researcher (one auditing the live site via agent-browser, one on market/competitors), synthesist | `brief.md`, `audit.md`, harvested `assets/` |
| 2 | identity | conductor, strategist, challenger on a different family | `IDENTITY.md` — positioning, personality, motif, voice, what survives the rename and what dies with it |
| 3 | direction | conductor, designer-a, designer-b (different families, blind), judge | 2–3 genuinely different directions as simple SVG/PNG, prompts kept beside each, `notes.md` |
| 4 | theme | conductor, token author, contrast auditor | `tokens.json` + `PALETTE.md` covering web, print, vehicle wrap, signage, embroidery, dark/light |
| 5 | brand | conductor, `codex:gpt-6-astra` illustrator (`auto_approve`), critic | **PNG only**, high-quality: primary mark, dimensional treatment, size ladder, ground variants |
| 6 | mockups | conductor, N× surface builder **fanned out one per page** via `for_each`, judge | **PNG renderings only**, 4–6 pages |

Stage 6 is the first real use of the `for_each` fan-out shipped last night — one child run per page,
addressed collectively as `pages`, capped at 8.

Each spec's `gates` block declares the human gate, and the conductor is told to write
`artifacts/GATE-<stage>.md` and stop — but the **enforcement is the driver's**, not the model's,
because gates are prose. That is the point of putting the gate in `rebrand next` rather than trusting
`describeGates`.

### Viking, seeded not run

Per the answer, the workflow ships and nothing runs. But the discovery I have already done gets
written into `clients/viking-surface-care/` as the starting brief, so stage 1 begins with facts
rather than a blank page:

- Name today **Viking Power Washing** → **Viking Surface Care**. Owner Chris Sulzer, since 2014,
  513-995-1800, 6725 Montgomery Rd, Cincinnati OH 45236, Mon–Sat 7–7.
- Area: Greater Cincinnati + Northern Kentucky, **16 location pages** (Blue Ash, Mason, West Chester,
  Montgomery, Indian Hill, Loveland, Hyde Park, Mariemont, Madeira, Terrace Park; Covington,
  Florence, Newport, Fort Thomas, Villa Hills, Union).
- Services: power washing (driveway, patio & deck, sidewalk, commercial) + concrete (crack & joint
  repair, patching, sealing). Proof: 250–300+ projects, 75+ commercial, 10+ yrs, 4.9★.
- **Logo** `viking-logo.svg`, 65 paths, a navy badge with an ice-blue outline, a horned helm, and
  **two pressure-washer wands flanking the wordmark** — name-specific hardware that the rename
  invalidates, since "Surface Care" is broader than washing. Lockup tagline *"IT'S ALL ABOUT THE
  DETAILS"*; site tagline *"Strength. Quality. Results."*
- **A live inconsistency worth naming in discovery:** the logo is navy `#1C2940` + ice blue
  `#62B3E6`, while the website's tokens are navy `#1c2636` + **amber/rust `#d4561a` / `#e06520`**.
  Two different brands are already in play.
- Type: IBM Plex Sans for both display and body. Stack: Next.js.
- **`vikingconcrete.com` — the "sister company" — is a parked HugeDomains for-sale page**, and
  `vikingsurfacecare.com` does not resolve. Both are business facts the client should hear.

## Verification

1. `for f in client-rebrand/workflows/*.json; do ao-topology validate --spec "$f"; done` — all six.
2. `ao-topology launch --spec <each> --dry-run --json` — argv, granted dirs, and **zero missing-skill
   warnings**, which is the check the shipped brand specs would fail today.
3. `bash client-rebrand/tests/test-rebrand.sh` — new, self-isolating via `mktemp -d` + `HOME`
   override like `task-management/tests/*.sh`. Asserts: `next` refuses an unapproved stage; `next`
   refuses when a deliverable changed after approval (mutate one byte, watch the digest fail);
   `approve` records by/at/digest; `status` reports drift; a stage marked complete whose files are
   missing is reported incomplete; the whole six-stage walk completes with the `generic` adapter and
   `cat` as the CLI, so it runs with no model and no credits — the pattern in
   `agent-orchestration/tests/live/nested-workflow.sh`.
4. `claude plugin validate ./client-rebrand` — passes with the expected "No version specified" warning.
5. `rebrand new viking-surface-care …` then `rebrand status` — shows stage 1 ready, nothing run.

## Deliberately not doing

- **Not building `ao-topology resume`.** It would mean relaxing `TOPOLOGY_RUN_EXISTS`, preserving
  the `sequence` counter, re-minting agent tokens and re-briefing every agent from `journal.jsonl` —
  and would still not restore a single model's context, because that died with the pane. The case
  file achieves the same outcome without touching a guard that is doing its job.
- **Not enforcing gates inside the orchestration layer.** Worth doing one day (it is why TM-122 was
  filed), but this workflow does not need it: the driver holds the gate, and between stages there is
  no process to gate.
- **Not touching `logo-design.json` / `brand-identity-tournament.json`'s ghost skills.** Real, and
  worth a task, but not this change.
