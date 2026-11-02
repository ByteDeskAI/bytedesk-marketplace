# Plan: reliable agent comms, cross-repo tickets, autonomous delivery

## Context

Ryan asked how to make agent-orchestration (AO) messaging, task queueing and cross-repo work easier, more reliable and more capable. Evidence comes from three code explorations and from mining about 190 recent transcripts in marketplace, agent-browser and remote-gateway.

**Ryan's answers to the interview:**
- **Pain points:** all four. Messages lost or stuck, finished work going unnoticed, cross-repo handoffs, and too many verbs and skills.
- **Cross-repo flow:** file a ticket on the target repo's board. Then message the target lead with the priority. High and critical tickets spawn a worker at once, in a worktree, which publishes as fast as possible and notifies the original sender.
- **Autonomy:** fully autonomous, through publishing.
- **Output:** this plan, then a new epic with tasks on the board. Existing open tasks are reused, not duplicated.

**What the transcripts show:**
1. **Mail does not arrive by itself.** Agents ran `mailbox inbox` 298 times and `sleep` 383 times. Ryan keeps typing "check your inbox".
2. **Mail gets held or refused:**
   - `unknown_recipient` 13 times in one agent-browser lead
   - `leads_not_ready` holds
   - `source_identity_required` for sessions that are not agents
   - slot grants with no sender (TM-314)
3. **Agents bypass the mailbox.** Their fallback is `tmux send-keys`, which once merged with Ryan's half-typed text.
4. **Lead liveness depends on the model's turn.** A 30-second probe-ack window makes a busy lead look "unresponsive" (TM-209, TM-222). Ryan asked for a lead to be spawned when mail arrives and no lead is available.
5. **Duplicate and uncoordinated dispatch.** `tm pool` started a second TM-010 worker without the lead knowing. Codex claimed tasks outside admission, and the review gate then refused them.
6. **Finished work is not noticed.** Ryan has to ask "check on TM-193, looks stuck" when it had already opened a PR. Nothing sweeps unreviewed work (TM-244), and dead workers cannot be replaced (TM-247).
7. **Review ranges break.** Empty patches (`X..X`), merge-base refusals, and no way to send a task back for rework (TM-347, TM-348).
8. **A guard hook blocks every worker commit.** `guard-project-install` refuses a commit when `.claude/settings.json` enables `task-management@bytedesk`, which AGENTS.md requires.
9. **Cross-repo queueing does not exist.** Each `tm` store and each pool covers one repository. AO's `ORCH_TASKS` stream exists but nothing calls it (TM-311, draft PR #179).
10. **Too many entry points.** There are about 37 skills, about 120 CLI verbs and about 60 MCP tools. Four of them all mean "run work on another agent", and "route", "cap" and "agent" each have three meanings.

## Design decisions

- **The target repo's `tm` board is the queue of record.** Cross-repo work becomes a real task in the target store, carrying an `origin` back-link. AO's `ORCH_TASKS` stream is used only as a wake-up signal: publishing to it makes the target pool tick at once, instead of waiting up to 30 seconds. This gives the stub a job without creating a second scheduler.
- **The two plugins stay independent.** They keep talking through each other's CLI and MCP only, as the existing knowledge note requires. Cross-repo `tm` calls run the target repo's own `bin/tm`, the same way `management.mjs` `taskStore()` does today.
- **High and critical tickets take an expedite lane.** They dispatch immediately, outside `poolWip` and subject to their own cap, and are never batched behind touches-disjoint grouping.
- **Autonomy is a per-repo policy, not a hardcode.** It is a new `autonomy` setting: `pr` | `merge` | `publish`, default `pr`. Ryan's machine sets `publish`. Publishing reuses each repo's own `/release` and TeamCity path, behind the EP-024 guardrails (green build, reviewer approval, rollback).

## Workstreams (new epic: "Cross-repo delivery and reliable agent comms")

### A. Messages that arrive (Phase 1)
Existing tasks to finish first: TM-314, TM-278, TM-327, TM-328, TM-271, TM-209, TM-222, TM-309.

New work:
1. **Push on arrival.** When the supervisor accepts standing mail for an agent, it rings the pane through the existing `ringMessage` (`topology/lib/delivery.mjs:613`). Today only run mail rings. The goal is that agents stop polling `mailbox inbox`.
2. **`mailbox wait`.** A blocking wait on the reply to a standing message, plus MCP `orchestration_mailbox_wait`. It reuses `waitForReplies` (`mailbox.mjs:616`), switching to KV watch once TM-311 lands.
3. **Session identity for any session.** SessionStart mints an AO identity for sessions that are not agents, so `mailbox send` stops failing with `source_identity_required`. Unregistered recipients, such as Codex panes, resolve through presence instead of `unknown_recipient`.
4. **Lead on demand.** When mail is held as `leads_not_ready` or `no_lead`, the target supervisor launches or recovers that repo's lead (Ryan, 09-30), then delivers.
5. **MCP parity.** Add MCP tools for `send`, `reply`, `wait`, `lead status` and handoff. Rename the misleading `orchestration_send` / `orchestration_wait` to `orchestration_run_followup` / `orchestration_run_wait`, keeping aliases.
6. **Verified sender.** `mailbox send` and the MCP mailbox tools derive `from` from the session identity rather than trusting the caller.

### B. Cross-repo tickets with priority (Phase 2)
1. **`tm ticket <repo|slug> "<title>" --priority <p> --ac ... [--from-task TM-n]`**, with MCP `tm_ticket`:
   - Resolves the target from AO `repos.json` or a slug.
   - Runs the target's `bin/tm task new` with `origin: {repo, task, agent}`.
   - Adds a cross-repo dependency to the originating task.
2. **Notify the target lead.** Send standing mail with the priority and the ticket id, and publish a wake to `orch.<repo>.tasks.ready`.
3. **Expedite lane in `pool.mjs`.** `high` and `critical` tickets bypass the poll wait and `poolWip`, under a separate `dispatch.expediteWip` cap (default 2). They always run in a worktree.
4. **Report progress back to the origin.** Events go to the origin lead as standing mail and as a comment on the origin task:
   - PR opened
   - review verdict
   - merged
   - published
   - failed
   
   Merging resolves the origin's cross-repo dependency.
5. **One duplicate-dispatch guard.** The pool consults AO assignments and the lead consults pool dispatch records, through one shared check, so no task gets two workers (the TM-010 incident). Per rule 3, both callers must go through that one implementation.

### C. Finished work never sits unnoticed (Phase 2)
Existing tasks: TM-244, TM-246, TM-247, TM-347, TM-348, TM-325 follow-ups.

New work:
1. **Review sweep.** The supervisor finds tasks that are done or in review with no reviewer verdict, or with an open PR left idle, and dispatches a review or notifies the lead.
2. **Claim heartbeat after a CLI dispatch.** The supervisor renews claims for live workers, because today renewal dies when a one-shot `tm dispatch` exits.
3. **Bounded automatic retry with backoff** for task-scoped failures, before a task is parked.
4. **`reviewer ensure` honours the requested provider and reuses the registered reviewer.** Today it created Claude reviewers when Codex was requested.

### D. Autonomous through publishing (Phase 3)
Existing tasks: EP-024's TM-250 (cutover and release verbs), TM-251 (cleanup) and TM-253.

New work:
1. **The `autonomy` policy** is read by the lead's landing path. At `publish`, after merge the lead runs the repo's release verb, waits for TeamCity, verifies the published artifact, then notifies the origin.
2. **Guardrails.** A red TeamCity build, a failed postflight or a missing reviewer approval stops the run and pages Ryan through ntfy.
3. **Update the memory** "ao-release-autonomy" from "still ask for deploy/tag/publish" to the new policy, once this plan is approved.

### E. Fewer, clearer entry points (Phase 4)
1. **One router skill, `/orchestrate`,** covering both plugins. It maps "I want X" to a skill or verb: dispatch, ticket another repo, message a lead, launch a team, run a goal, check status.
2. **Clean up the existing skills:**
   - Rename `roadmap-orchestrator` to `roadmap-governance`.
   - Merge `install-orchestration-host` into `setup-agent-orchestration`.
   - Mark `orchestration-conduct` internal.
   - Give `goal-feedback-loop` trigger phrases.
3. **`ao repos list|add|remove`.** Make repository registration explicit; today it is a SessionStart side effect.
4. **One combined `doctor`** that runs the AO, `tm` and services checks together.

### C2. Review that does not scrape screens (Phase 2), from the remote-gateway transcripts
1. **Reviewer verdicts travel over the mailbox or NATS reply as JSON.** Today the reviewer pane is screen-scraped, and `TOPOLOGY_REVIEWER_RESPONSE` is the most common error code. Existing: TM-216, TM-259, TM-260.
2. **The reviewer reads the worker's worktree,** not the main checkout.
3. **Findings get a severity.** `minor` findings no longer block an approval. Findings on CHANGELOG are allowed.
4. **`manage admit` recovers when the worktree exists but the claim is missing.** It re-claims instead of failing. Existing: TM-348.

### F. Friction fixes (Phase 1, small)
0. **Ship the autonomy permissions with the AO plugin, not as global rules** (Ryan, 09-24: "I dont want to have to approve anything… fix that at the orchestration level"). This covers lead and worker settings for `auto_approve`, spawning workers and reading a pane, so the safety classifier stops refusing routine lead actions.
0b. **Show identity plainly.** Agent name and role appear in the status line and tab title, to answer "who's the lead in this repo?". NATS subjects carry a readable repo slug next to the hash.
0c. **Add a broadcast audience to standing mail** (`@all-leads`).
0d. **Report plugin freshness.** `doctor` compares the installed plugin SHA with `origin/main`, so a stale cache is reported, not guessed at.
1. **Fix `guard-project-install`** so it allows the AGENTS.md-mandated `enabledPlugins` declaration. It should block only installs that are truly per-project.
2. **Replace sleep-polling with wait verbs:** `tm pool wait`, `services wait`, `mailbox wait`. These also fix the harness blocking `sleep N`.
3. **Pass declared secrets to workers.** The worker environment inherits keys listed in the repo's AO config, so nobody runs `tmux set-environment` by hand.

### G. Automatic issue, enhancement and optimisation finder (Ryan's follow-up request; built last)
Create the skill **`task-management:enhance-mine`**. It sits beside the existing `enhance-capture/-research/-propose/-track` and reuses their CAP backlog (`tm_cap_propose`).

What it does each run:
1. **Collects signals from five sources:**
   - **Transcripts.** It mines `~/.claude/projects/*<repo>*` from the last N days with the jq filters used in this plan: human corrections, `is_error` results, AO and `tm` error codes, and workaround counts (`tmux send-keys`, `sleep`, `mailbox inbox`). It never reads whole files and redacts secrets.
   - **The board.** Stale in-progress tasks, tasks done without a review, repeated failures from `pool.log`.
   - **Tests and CI.** Flaky or failing tests, and TeamCity failures via teamcity-mcp.
   - **Code.** `graft` hotspots and TODO/FIXME debt.
   - **Performance.** Slow verbs, such as `lead status` taking 30 seconds.
2. **Clusters** the signals into themes and scores each one by frequency × severity × user-pain.
3. **Deduplicates** against `tm find` and `tm cap list` before proposing anything. A match adds evidence, as a comment, instead of creating a new item.
4. **Files the output:**
   - bugs as `tm` tasks with acceptance criteria and evidence paths
   - enhancements and optimisations as CAP proposals
   
   It prints a short report with each theme's coverage, so a run that found nothing says so (rule 1).
5. **Can run unattended** on a schedule via `/loop` or the AO supervisor (default weekly), in each registered repo, filing into that repo's board.
6. **Ships with tests and an eval:**
   - **Fixture test.** A fixture transcript directory with known issues, and a test asserting every known issue is found.
   - **Dedupe test.** A test proving a re-run files nothing new.

## Sequencing
1. **Phase 1:** A and F. This fixes delivery first, since everything else depends on it.
2. **Decide TM-311 / PR #179's merge order.** ADR-0037's NATS-home migration locks out older clients.
3. **Phase 2:** B and C.
4. **Phase 3:** D.
5. **Phase 4:** E.

## Board changes after approval
- Create the epic with one task per numbered "new" item above, each with acceptance criteria and a `touches`.
- Link the existing tasks listed under each workstream into the epic with `tm move`, rather than duplicating them.
- Mark the stale ROADMAP AO-COL-001..006 entries for update.

## Critical files
- `agent-orchestration/topology/lib/standing-mailbox.mjs`, `mailbox.mjs`, `delivery.mjs`, `routing.mjs`, `lead.mjs`, `slots.mjs:441`, `supervision.mjs`, `management.mjs`, `services-client.mjs`
- `agent-orchestration/topology/cli.mjs`, `agent-orchestration/src/mcp.mjs`, `agent-orchestration/src/topology-api.mjs`
- `task-management/lib/dispatch/pool.mjs`, `index.mjs`, `collect.mjs`, `backend.mjs`; `task-management/bin/tm`; `task-management/lib/mcp.mjs`
- AO hook `guard-project-install.mjs`; the skills under both plugins' `skills/`

## Verification
- **Unit tests per change.** Run `node --test --test-concurrency=1`, with tmux isolated three ways per `.claude/rules/tmux-test-isolation.md`.
- **Live end-to-end in a sandbox pair of repos:**
  1. File a `critical` ticket from repo A to repo B.
  2. Assert that B's lead receives the mail without polling.
  3. Assert that a worker spawns within 5 seconds in a worktree, a PR opens, it merges and publishes (dry-run release).
  4. Assert that A's lead gets each status event and that A's dependency clears.
- **Record the commit and dirty state with every measurement** (rule 8). Each check must be able to report "nothing found" (rule 1).
