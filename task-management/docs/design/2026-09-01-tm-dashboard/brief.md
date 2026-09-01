# task-management dashboard — design brief

Provenance
Tool: codex exec (codex-cli 0.152.0), text mode — three framings; Claude chose and wrote this brief
Date: 2026-09-01
Requested by: Ryan Helms (via the marketplace rewrite plan)
Authority: ByteDeskAI/design-system @ f652565 — DESIGN.md §4 §10, profiles/task-management/{DESIGN,PRODUCT}.md, tokens/css/bytedesk.css
Profile: authority — /home/ryan/Documents/GitHub/ByteDeskAI/design-system/profiles/task-management/DESIGN.md
Status: exploration — not approved, not production source

## What it is
A live board over the git-tracked markdown store at `.bytedesk/task-management/`. Humans and
Claude / Codex / Grok sessions create, claim, block, park, prove and finish work here through
the same gates the `tm` CLI enforces. It is the **register** the plugin keeps when a session
compacts, dies or switches worktrees, shown as an **instrument** fast enough to beat typing
`tm board`, `tm next`, `tm why`.

## Who it is for, and in what state
The operator between prompts or between sessions: partial context, several claims open, one
question — *what changed, what is stuck, what moves next?* Agents are users too: they read the
same record through MCP and hooks, so nothing on screen may be true only in the browser.
Energy budget: low. This is a console read a hundred times a day, not a page visited once.

## The one thing
**Resume work from the record alone.** Any human, agent or subagent opening a task must see the
objective, the governing decision, the current claim and holder, the blockers to their root, the
permitted next action, the acceptance criteria and the evidence — without reading the session
that created it. Every surface's focal hierarchy derives from this: claim and status first, then
what stops it, then what proves it.

## Surfaces
| Surface | Route | What it is for | What dominates |
|---|---|---|---|
| Board | `/board` | durable state of all work; move tasks through the governed workflow | six status columns (backlog · todo · in progress · blocked · parked · done), optional epic lanes; **one lifted claimed card** among resting ones; every status dot + word |
| Backlog | `/backlog` | decide what enters execution; rank; commit to a sprint | an ordered queue: rank, readiness, epic, blockers, points; sprint boundary and `N/M pts` |
| Task | `/tasks/:id` | brief a human or agent completely enough to continue | sticky identity header (id · status · holder · epic · title); then acceptance criteria, blockers with the why-chain, evidence, worktree, history, live work stream |
| Epic | `/epics/:id` | preserve the plan and decisions that give tasks meaning | children with ownership, plan chip, ADRs, `done/total` progress |
| Graph | `/graph` | explain what must happen first and why | dependency DAG with status per node, cycle highlight, the selected node's why-chain beside it |
| Timeline | `/activity` `/standup` `/reports` | reconstruct what changed across sessions; measure flow | chronological events keyed by id · session · actor; standup (done / doing / stuck); cycle-time and throughput |
| Sessions | `/sessions` | coordinate concurrent agents without losing ownership or exceeding WIP | claims by session, WIP meter `3/3`, worktrees, subagents, parallel batches, stale-claim signals |
| Health | `/doctor` | decide whether the record can be trusted; bounded repair | doctor findings error/warning with `fixable`, fix-all-unambiguous, export, ntfy test, override |
| Settings | `/settings` `/help` | configure how participants navigate, create, interpret | catalog groups with dirty state, keyboard sheet generated from the handler, templates, skills catalog with copyable commands |

Shell: 48 px rail (`--bd-size-shell-rail`), 36 px command bar, canvas, one lifted 360 px
inspector (`--bd-size-shell-inspector`). Phone: bottom tab bar, inspector full-screen.

## Voice
Terse, imperative, the CLI's own refusal wording verbatim.
Would send: `TM-184 is blocked by TM-179: the schema decision is unresolved. Resume from the recorded why-chain.`
Would never send: `Something went wrong. Try again later.`

## Constraints that are real
- Tokens only (`var(--bd-*)`), dark default with light parity, IBM Plex Sans / Plex Mono (ids, SHAs, timestamps, paths, session ids, branch names in mono).
- Status, priority, liveness, claim, refusal, offline: never colour alone.
- The accent is the family interaction blue, inherited; orange is the mark's, never the board's.
- Every write on screen exists as a CLI verb and a gate; the board never invents a state the store cannot hold. Comments are append-only.
- Keyboard-first: `j/k/h/l`, digits move cards, `⌘K` palette, `?` sheet; roving tabindex; focus returns to the opening card.
- Zero `window.prompt`; gated writes (done, claim/steal, worktree rm, doctor fix, sweep, override) carry a consequence sentence and confirm.
- Installable PWA with an offline outbox: queued and refused writes are visible states on the card.

## What it must never look like
Not a Jira clone. Not a KPI-tile admin template: no hero metric grid, no progress rings without a number, no donut with invented percentages. No eyebrow labels, no pill-everything, no glass panels as the default surface, no gradient text, no icon soup, no fake terminal chrome, no avatar as the only holder indicator, no "Live" badge that says nothing, no right-hand "Recent activity" rail the IA never asked for, no invented product voice ("night shift", "operator checklist").

## Open questions
- Whether `/sessions` becomes the lead's home when more than one claim is live (framing B's case). Waiting on: the sessions route landing and a week of use.
- Light-theme richness: the profile runs the family default; whether the board wants `data-bd-richness` is undecided. Waiting on: dark/light parity screenshots from the surface stage.

## Framings considered
- **A — Prompt-Side Instrument** (precise instrument, competes with the CLI): grafted — its speed test and Board-as-home are kept.
- **B — Mission Control for Parallel Work** (team coordinator, Sessions as home, competes with Jira + spreadsheet): lost — it centres one role and makes coordination the product; kept as the Sessions surface's brief and the open question above.
- **C — The Register** (shared memory between humans and agents, competes with doing nothing): **chosen** — it names the plugin's actual reason to exist and produces the strongest focal hierarchy (resume from the record alone).
