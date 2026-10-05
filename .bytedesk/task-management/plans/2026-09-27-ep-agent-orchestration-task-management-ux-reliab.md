# EP: agent-orchestration ↔ task-management UX/reliability pass (10-day issue sweep + aside→modal)

## Coordination with the parallel Codex audit (read this first)

A Codex CLI session (tmux `bytedesk-emote-gateway-codex-OGo8cnsn7N7i`) is running the
same 10-day-sweep prompt you gave me, scoped to **server-side only**, across all 25
ByteDeskAI repo roots registered in the Gateway's project registry (vs. my UI-only
scope, single-repo transcript sweep). It is also in plan mode and has not yet executed
or filed anything — its proposed plan produces an issue register + a cross-plugin
recommendation "as recommendations only," explicitly making no code/task-state changes
yet.

**Decision (confirmed with you):** wait for Codex's server-side audit to finish before
filing the epic or the server-side/cross-plugin items below, to avoid duplicate or
conflicting tasks on the board. The only piece safe to execute now is the **aside→modal
UI fix** (section 2) — it's pure dashboard-frontend, zero overlap with Codex's
explicitly server-only scope.

Also checked TM-482 (a pane titled "TM-482 server work committed" in a different
`bytedesk-remote-gateway` session): unrelated feature work (hierarchical plugin
navigation, fully shipped), but it surfaced one more real, distinct server-side defect
worth folding into the joint issue register once Codex's audit lands: **`record-landing`
allows only one landing per task**, so a task shipped across two PRs can't have its
second PR's review recorded, and `tm done` refuses to close it even though both are
live. Not filing this myself — letting it come out of Codex's audit, which is already
scoped to catch exactly this kind of thing.

## Context

You asked for a full sweep of the last 10 days of Claude/Codex/Grok transcripts, the
task board, and the knowledge store for every issue tied to `agent-orchestration` and
`task-management` (workflow, autonomous-activity, and record-keeping failures), plus a
UI fix: task-management dashboard "asides" can't be scrolled and should become modals.
You also want ideas for how these two **deliberately independent** plugins (no imports,
no manifest dependency — see `.bytedesk/knowledge/architecture/task-management-and-agent-orchestration-stay-ind.md`)
can cooperate better inside the remote-gateway product, without breaking that rule.
Everything lands in **one epic** on the marketplace board, per your answer.

Three research passes (transcripts/board/knowledge-store, dashboard CSS, and the
integration seam) are complete. Below is the deduplicated finding, grouped by what's
already tracked vs. net-new, then the aside/modal fix, then the gateway-cooperation
proposal.

## 1. Issue catalog (22 distinct issues found, evidence-backed)

**Already tracked as task-management tasks (19 of 22)** — no new tasks needed, just
attach them to the new epic and, where still open, prioritize:

| # | Issue | Instances | Status | Task |
|---|---|---|---|---|
| 1 | Dispatch skips governance when `dispatch.governed` unset → unreviewable work | 2 (TM-136, TM-235) | in_progress (ACs done, stuck in retry loop — see below) | TM-240 |
| 2 | Finished task sits with no review, nothing notices | 2 | blocked on TM-240 | TM-244 |
| 3 | Worker worktree branched from wrong HEAD (shared checkout contamination) | 3 workers | done | TM-201 |
| 4 | Worker PR opened against wrong base branch (`gh pr create` no `--base`) | 1 (real prod impact, PR #227) | done | TM-235 |
| 5 | Dead governed worker can't be restarted or replaced (every recovery path refuses) | 2 (TM-240, TM-242) | open | TM-247 |
| 6 | Review range stale after branch merges `main` → false "smuggled work" verdicts | 3+ PRs | in_progress | TM-257 |
| 7 | Diff >8MiB fails with cause-hiding generic error | 1 | in_progress | TM-241 |
| 8 | `manage integrate` unusable (policy/checkout/close-governed-task gaps, no override-disarm) | 1 (blocked 3 landed tasks) | done | TM-224 |
| 9 | Worker misreads its own worker-bound event as a rival worker, exits | 1 | done | TM-236 |
| 10 | Worker hands off to background subagent then ends its turn → orphaned work | 2 (TM-240, TM-242) | open | TM-246 |
| 11 | Standing-agent pane starts in wrong dir → `CLAUDE_PROJECT_DIR` hooks fail | recurring | in_progress | TM-242 |
| 12 | Prompt-ack trust boundary spoofable via `TMUX_PANE` | 1 reproduced | open | TM-172 |
| 13 | Ad-hoc-launched worker session can't be closed by governed tooling | 1 | done | TM-218 |
| 14 | Lead can't self-authorize its own merge/landing (correct safety refusal, no delegation path) | 1 + policy churn | in_progress | TM-234 |
| 15 | Agents launched with permission prompts by default | fixed | done | TM-214 |
| 16 | Reviewer verdict stuck "incomplete" forever, no escalation | 1 | in_progress | TM-217 |
| 17 | Raw internal error/pane text leaks into gateway UI | 1 | open | TM-237 |
| 18 | Presence header schema had no key whitelist (drift risk) | 1 | done | TM-136 |
| 19 | Independence-rule enforcement itself (no cross-import, capability-check+skip) | — | doc | architecture note, cites TM-236/240/244/245 |

**Net-new, not yet filed (3 of 22)** — file these under the new epic:

- **Pool auto-pause from readiness flapping between probe acks** — self-diagnosed and
  patched ad hoc in the gateway lead session (added a Monitor to auto-resume) but never
  filed as a task, so the fix isn't tracked or generalized. File a task to make the
  auto-resume-on-flap behavior a real, tested feature rather than session-local code.
- **Rapid-fire standing-delegation approval chain** (2026-09-25, 4 decisions in ~3
  hours, relayed lead→operator via `AskUserQuestion` rather than direct confirmation)
  — not a bug, but a record-keeping/trust-chain pattern worth a follow-up: should
  broad delegation grants (merge, cutover, release, branch-deletion) require a single
  consolidated confirmation rather than a fast sequence of incremental ones? File as a
  process/ADR-review task, low priority.
- **TM-240 currently stuck in a park/retry loop** (worker exits, reposts "independent
  review and integration remain required" every ~33s since 02:20 UTC 2026-09-27,
  despite all 5 ACs marked done) — this needs a person to intervene (`tm collect
  TM-240` / inspect the parked worker) rather than more automation; flag as immediate
  action, not a new task.

## 2. Aside → Modal conversion (task-management dashboard)

Location: `task-management/dashboard/src/` (Vite/React SPA).

Root cause of "can't scroll": only **one** of the two aside patterns is actually
broken.

- `components/ui/Inspector.tsx:16` (shared drawer used by Task/Epic/Sprint/
  Decision/Capability panels) is correctly built — fixed positioning, CSS grid with
  `min-height:0`, and `.tm-inspector__body { overflow:auto }` (`styles/shell.css:86-106`).
  **Not broken.** Converting it to a modal is a bigger, unrequested UI change to
  something that already works — skip unless you want it for consistency, not for
  the scroll bug.
- `features/graph/Graph.tsx:104` (`.tm-graph__side`, the "why"/blocker-chain panel
  on the dependency-graph screen) **is** the actual bug: `styles/graph.css:8` gives it
  `position: sticky` inside a CSS grid but no `max-height`/`overflow-y: auto` of its
  own, unlike every other scrollable panel in this codebase. A long blocker chain
  simply runs off-screen with nothing to scroll it into view.

A working, idiomatic `Modal` component already exists and is reused elsewhere
(`components/ui/Modal.tsx`, wraps native `<dialog>`, handles Escape/backdrop/focus
trap, `.tm-modal__body { overflow:auto; max-height:70vh }` in `styles/ui.css:173-181`,
already used by `KeysSheetModal` and `CreateModals.tsx`). No new modal machinery
needed.

**Design system**: confirmed `task-management/dashboard` is already fully wired to
ByteDesk's design system — `@bytedesk/design-tokens`/`@bytedesk/design-ui` installed,
`.design-system.json` pinned to `2.2.1`, `.context/design-system/` vendored, and every
`--tm-*` variable in `styles/tokens.css` aliases a `--bd-*` foundation token (none are
hardcoded literals — enforced by a `design:check` script that fails the build on raw
hex/`rgba()`). This is the same setup used by `bytedesk-remote-gateway`'s login/other
pages. `Modal.tsx`/`ui.css` already resolve through this token layer, so the
`Graph.tsx` conversion needs no separate design-system adoption step — just keep using
`--tm-*` classes/vars in whatever new markup replaces the hand-rolled `<aside>`, and
let `design:check` catch any regression.

**Plan**: convert `Graph.tsx`'s hand-rolled `<aside>` to use the existing `Modal`
component (matches your "convert asides into modals" ask and fixes the real bug in
one move), rather than adding ad hoc `overflow-y:auto` to a component destined for
replacement. Leave `Inspector.tsx` as-is — it isn't broken, and per the ladder,
touching working code beyond what's asked is scope creep. If you'd rather have visual
consistency across *all* panels, say so and this becomes a second, explicit task
(bigger diff, touches 5+ feature files); default is the targeted fix.

## 3. Cross-plugin cooperation for the remote gateway (respecting independence)

Current state (verified): agent-orchestration shells out to the `tm` binary
(`management.mjs`); task-management's dispatch backends shell out to `ao-topology`/
speak MCP as a stdio client (`dispatch/topology.mjs`, `dispatch/orchestration.mjs`);
correlation today is a single one-way, best-effort field — agent-orchestration's
`discovery.mjs` regexes a run's workflow name against `tm-TM-\d+` and stamps a
`taskId` into its own `workflow-index/v1` — which the gateway's `RunDetail.tsx:156`
displays as plain text. There is **no task-board UI in the gateway at all**, and no
webhook/event bridge between the two plugins' event logs.

Both TM-240 and TM-244 are already scoped as *within-boundary* hardening (each plugin
fixing its own half of the existing shell-out/capability-check seam) — neither
proposes a shared schema or service. Any gateway cooperation must follow the same
shape: no imports, no manifest dependency, capability-checked, silent-skip when the
other plugin is absent.

Proposed additions (all additive, all optional-dependency, filed under the epic):

- **Gateway task-board surface**, read-only initially: a new gateway tab that shells
  out to `tm board`/`tm show <id>` (same pattern agent-orchestration already uses)
  to render the board, and cross-links each task to its correlated run using the
  `taskId` field agent-orchestration already publishes — this closes the "no task UI
  in the gateway" gap using the existing correlation field instead of a new one.
- **Promote `taskId` correlation from best-effort regex to explicit, bidirectional
  tag**: when `tm dispatch` launches via the `topology`/`orchestration` backends, have
  it pass the task ID explicitly as the workflow name/tag (it already knows it) rather
  than relying on agent-orchestration's regex reconstruction. Small, backward-
  compatible change on the task-management side only (it already owns the dispatch
  call); agent-orchestration's discovery code needs no change.
- **Surface TM-244's "review needed" doctor predicate in the gateway UI**: TM-244
  already defines "does this task's current revision have an outstanding or missing
  review" as a testable predicate with a documented three-fixture contract. Once
  TM-244 lands, the gateway board surface (above) can shell out to the same doctor
  check to render a "needs review" badge per task — reusing TM-244's work instead of
  inventing a second notion of review state.
- **Generalize the ad hoc pool-auto-resume-on-flap fix** (item above) into a real,
  documented Monitor so the gateway (or any consumer) sees pool pauses/resumes as a
  normal event rather than a silent stall.

None of this requires a shared library, event bus, or new cross-plugin schema — it's
the existing shell-out-and-capability-check pattern, extended in three small,
independently-shippable places (task-management's dispatch call, agent-orchestration's
nothing changes, and a new gateway-side read-only surface).

## 4. Execution

**Now (this pass):**

1. Implement the `Graph.tsx` → `Modal` conversion in `task-management/dashboard/src/`
   (touches `features/graph/Graph.tsx`, removes now-dead `.tm-graph__side` rules from
   `styles/graph.css`).
2. Flag TM-240's stuck park/retry loop for your manual intervention
   (`tm collect TM-240` or inspect the parked worker) — this is an active stuck worker,
   worth acting on regardless of the epic timing.

**Deferred until Codex's server-side audit completes:**

3. Create epic `EP-nnn` "agent-orchestration + task-management: reliability sweep &
   aside→modal" via `tm epic new`, reconciling my catalog (§1) with Codex's issue
   register and cross-plugin recommendation into one pass — not two separate filings.
4. `tm move` the already-tracked tasks under it (no content changes to those tasks
   themselves).
5. File net-new tasks (pool-auto-resume-on-flap, delegation-approval-chain review,
   the TM-482 single-landing-per-task defect, plus whatever Codex's audit adds) under
   the epic in that same reconciliation pass.
6. File the gateway-cooperation additions (board surface, explicit taskId tagging,
   review-needed badge reusing TM-244) as tasks under the epic, informed by Codex's
   cross-plugin recommendation so the two don't propose conflicting interface changes.

## Verification

- `tm board` shows the new epic with all 19+2 tasks reparented.
- Dashboard: open the Graph screen, focus a node with a long blocker chain, confirm
  the "why" panel now opens as a modal and its content scrolls (`max-height:70vh`,
  `overflow:auto` from the existing `.tm-modal__body` rule) — check in a real browser
  via the dev server (`task-management/dashboard`), not just a visual diff.
- No changes to `Inspector.tsx` — confirm existing inspector panels are pixel-identical
  before/after (regression check, since it wasn't touched).
