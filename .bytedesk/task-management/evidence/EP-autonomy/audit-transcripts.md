# Transcript audit: where agents could not finish autonomously

Read-only audit, 2026-10-09. 15 distinct problems, ranked by how much autonomous work each blocks.

Path key: `P/` = `~/.claude/projects/-home-ryan-Documents-GitHub-ByteDeskAI-`. `:N` is the JSONL line number. Times are UTC.

## Coverage and method

- **Claude transcripts scanned:** 83 files modified in the last 48 hours (190 MB, subagents included).
  - marketplace: about 50 (lead `fd2b831f`, reviewer `c164bf8b`, 10 worker worktrees, subagents)
  - design-system 5, agent-fabric 4, passport 4, infrastructure 4, remote-gateway 4, Bastion 3, agent-browser 3
  - other 6 (842-massachusetts, `~`, `/tmp`)
- **Codex sessions scanned:** 6 under `~/.codex/sessions`.
- **What was searched:**
  1. Every `tool_result` with `is_error: true` (318 hits), clustered by message and paired with the command that produced it.
  2. Assistant text matching: permission, denied, not allowed, requires approval, PreToolUse, No such tool, not available, no shell, cannot run, outside the allowed, please run, Ryan must, paste, send-keys, guard, held, unread, restricted, deadlock, refus* (487 hits).
  3. Every `TOPOLOGY_*` / `TM_*` code printed as `error CODE:` or `"code": "CODE"`. Bare mentions such as source greps and environment variable names were excluded.
  4. How each worker-worktree transcript ended: last `stop_reason`, and any pending `run_in_background` or Monitor.
  5. For each code or problem, `tm find <words>` (read-only).
- **Excluded:** this audit's own lines in `fd2b831f` after 05:10 on 2026-10-09.
- **Scratchpad scripts:** `scan.py`, `pair.py`, `codes.py`, `end.py` and `hits.jsonl` are in this audit's scratchpad (`…agents-fd2b831f/64f709ec-…/scratchpad/`), so any search can be rerun.

### Searches that found nothing

- **Typing into another agent's pane:** I searched assistant text for `send-keys`, "typed into" and "type into". The only hits were agents saying they did NOT type into a pane. A raw `tmux send-keys` that the agent never described in text would not have been caught.
- **Codex sessions:** only problem 6 and one design-system worker that could not merge PR #126 ("Lead must merge #126").

---

## 1. A reviewer's `blocked` verdict deadlocks the task

- **Role:** reviewer, then lead.
- **Exact errors:**
  - Lead, rework: `TOPOLOGY_MANAGEMENT_REWORK_REVIEW: rework needs an independent changes_requested review of the current finish revision 4f366ec6ff51f00bb1f9f421e9b17682f1e777fa; the review is blocked.`
  - Lead, rework (before stop-worker): `TOPOLOGY_MANAGEMENT_REWORK: Stop the finished worker with manage stop-worker before rework; findings never go to a live writer.`
  - Reviewer, resubmit: `TOPOLOGY_REVIEWER_RESPONSE: This review request was already collected; its verdict cannot change.`
- **Evidence:**
  - `P/bytedesk-marketplace--bytedesk-agent-orchestration-agents-c164bf8b/6632eb20…jsonl:371` (2026-10-09 03:14): `blocked` verdict for TM-478, citing a failed required check (`agent-orchestration: unit` exit 124).
  - Same file, `:578`, `:589` and `:591` (04:32–04:33): three `changes_requested` resubmits refused, and the summary at `:593`.
  - `P/bytedesk-marketplace--bytedesk-agent-orchestration-agents-fd2b831f/253de95a…jsonl:6972` and `:6986` (04:31): the lead's rework refused.
- **Count:** 3 tasks (TM-478, TM-484, TM-427) stuck in 1 reviewer session. `TOPOLOGY_REVIEWER_RESPONSE` appears 7 times in 4 sessions. Passport reviewer `ebf01b80` `:399` returned changes for "No run evidence", the same lack of checks.
- **Root cause:**
  - `agent-orchestration/topology/lib/reviewer.mjs:1532`: the request text says that if required checks are unsatisfied, "do not approve: submit blocked".
  - `agent-orchestration/topology/lib/management.mjs:682`: rework accepts only `changes_requested`.
  - `reviewer.mjs:1607`: a collected verdict can never change.
  - `start-worker` also refuses, so no verb moves the task forward.
- **Tracked:** TM-509 (open) and TM-488 (open).
- **Deliberate part:** the reviewer has no Bash. TM-150 showed that a deny list does not stop Bash from writing files (`reviewer.mjs:195–219`). Keep that.
- **Fix (code):**
  - (a) `manage rework` accepts a `blocked` review of the current finish revision as well as `changes_requested`.
  - (b) Or add a lead verb that withdraws a collected `blocked` review and reissues the request with a fresh nonce.
  - (c) Host-run checks: before requesting review, the supervisor runs the task's required checks in a sandbox and writes the exit codes and logs into the packet's `checks.json`. The reviewer then never lacks check evidence and never needs a shell.
- **Fix (config):** none.

## 2. Restricted reviewers cannot read standing mail

- **Role:** reviewer.
- **Exact error:** `/home/ryan/.local/state/bytedesk/agent-orchestration is outside <agent dir>, <repo>, <reviewer inbox>; --restricted confines the file tools to the working directory.` Reviewers then report that the message "asks me to run `ao-topology mailbox inbox`, but this role can't run commands."
- **Evidence:**
  - `P/bytedesk-marketplace--bytedesk-agent-orchestration-agents-c164bf8b/6632eb20…:421` (refusal), `:445`, `:515`, `:531` (2026-10-09 04:10–04:29): `faro-queue-2026-10-09a`, `…09b` and `faro-235-context` unread.
  - `P/bytedesk-passport--bytedesk-agent-orchestration-agents-ebf01b80/65a268df…:179`, `:182`, `:399`, `:512` (2026-10-06 to 2026-10-09).
  - `P/design-system--bytedesk-agent-orchestration-agents-e16d04f0/dca5745e…:99`, `:116` (2026-10-05): TM-144 and TM-145 were never reviewed.
  - Also `P/Bastion--…agents-e9753d68/db22b476…:245/:257` and `P/agent-fabric--…agents-bf039c07/771dcaa6…:49/:65`.
- **Count:** at least 12 messages unread, 6 reviewer sessions, 5 repos.
- **Root cause:**
  - `reviewer.mjs:224`: the reviewer gets only `add_dirs: [consumer, inboxRoot]`. The standing mailbox lives in `~/.local/state/bytedesk/agent-orchestration`, outside those grants.
  - The mail pointer that the mailbox rings tells the reviewer to run a CLI it does not have.
- **Tracked:** TM-509 (open).
- **Deliberate part:** no Bash; keep it.
- **Fix (code):**
  - Add a read-only `mailbox_inbox` / `mailbox_read` tool to the existing `ao-review` MCP server. The server fixes the reviewer's identity; the tool takes no identity argument.
  - Or have the host deliver mail addressed to a reviewer into `reviewers/inboxes/<id>/mail/`, which the reviewer can already read.
- **Fix (convention):** senders put review context in the review-request packet, not in standing mail.

## 3. Files the harness writes leave worktrees dirty, so the finish report is refused, and the stash guard blocks the obvious recovery

- **Role:** worker.
- **Exact errors:**
  - `TOPOLOGY_MANAGEMENT_DIRTY: Commit or preserve outstanding changes before readiness for review.`
  - `task-management dispatch guard (worker for TM-427): the stash stack is shared by the main checkout and every worktree, so dropping, clearing or popping an entry can destroy another session's work. Set work aside with a temporary WIP commit on your own branch instead (git commit -m WIP), and undo it later with git reset --soft HEAD~1.`
- **Why the guard's advice does not work here:** a WIP commit moves `HEAD` off the revision the finish report names.
- **Dirty files (not the worker's):** `.claude/helpers/graft-hooks.cjs`, `.claude/helpers/graft-statusline.cjs`, `.claude/settings.json`, `.claude/skills/graft/SKILL.md`, `.grok/config.toml`, `.grok/skills/graft/SKILL.md`, `.mcp.json`, `opencode.json`.
- **Evidence:**
  - `P/bytedesk-marketplace--bytedesk-worktrees-TM-427-security-agent-orchestration-reviewer-any-proces/3d8f60cb…:524` (DIRTY), `:536` (git status), `:542` (stash blocked), `:546–555`: the worker copies the files to `/tmp`, reports, then restores them.
  - `P/bytedesk-marketplace--bytedesk-worktrees-TM-417-…/24496a08…:771` (DIRTY).
  - `P/-passport-worktrees-notification-sink-plugins/7b3cad45…:316` (TM-258, stash blocked); `P/bytedesk-marketplace--bytedesk-worktrees-TM-413-…/6d582eb9…:132` (stash blocked).
  - agent-browser TM-010 worker transcripts: DIRTY twice.
- **Count:** 8 DIRTY refusals in 8 sessions, plus 3 stash blocks.
- **Root cause:**
  - `agent-orchestration/topology/lib/management.mjs:710` runs a bare `git status --porcelain`.
  - Its sibling checks at `:1004` and `:1075` already filter through `foreignDirtyPaths`. One predicate, two behaviours.
  - Stash rule: `task-management/lib/worker-guard.mjs:193–198`.
- **Tracked:** no.
- **Fix (code):**
  - Make `:710` use one shared filter (extend `foreignDirtyPaths`) that ignores a declared list of files the harness writes.
  - Or have worktree provisioning mark those files `--skip-worktree`, or list them in the worktree's `.git/info/exclude`.
  - Change the stash-guard message to suggest copying files aside when `HEAD` must not move.
- **Fix (config):** stop graft and the provider setup rewriting tracked files inside `.bytedesk/worktrees/*`.

## 4. Subagents launched with `isolation: "worktree"` cannot edit or build through Bash

- **Role:** subagent.
- **Exact errors:**
  - `This agent is isolated in the worktree <path>, but this command is too complex to verify that it stays inside the worktree. Refusing to run it — a worktree-isolated agent's git operations must target its own worktree. Split it into plain, separate commands…`
  - A variant: `…this command names git in a form too complex to verify…`
- **Evidence:**
  - `P/bytedesk-marketplace/d82e2db7…/subagents/agent-a8a5279aabf195587.jsonl:76`, `:81`: even `npm ci --silent > /dev/null 2>&1; echo npm $?` was refused. `:89`: a python heredoc edit was refused.
  - `P/design-system--bytedesk-agent-orchestration-agents-d04c2baa/04f25c3d…/subagents/agent-a6b0aa74708d0a19d.jsonl:28`, `:35`, `:42`, `:46` (2026-10-07): four edit attempts refused.
  - `…/subagents/agent-a152a4468d038da65.jsonl:48`: the retry was denied by the auto-mode classifier as `[Auto-Mode Bypass]`.
- **Count:** 88 refusals, 10 subagents, 2 parent sessions.
- **Root cause:** built into Claude Code; the string is in the `claude` binary, not in repo code.
- **Tracked:** no.
- **Fix (prompt / convention):**
  - Subagent briefs say: use Edit/Write for file changes and one plain command per Bash call.
  - Or give subagents a tm-provisioned worktree instead of `isolation: "worktree"`.
- **Fix (upstream):** report the `npm ci` false positive as Claude Code feedback.

## 5. The dispatch guard forces a stale integration base and also matches text inside quoted arguments

- **Role:** worker.
- **Exact errors:**
  - `task-management dispatch guard (worker for TM-262): a dispatch worker opens its PR against tm/TM-189-boards-staging-evidence, this repo's configured integration branch — not the repository default.`
  - Then the worker's own `$TM block TM-262 "PR creation refused by dispatch guard: …"` was itself refused by the guard. The guard read the quoted reason text as a command.
  - Earlier, at `:161`: `a dispatch worker pushes only its own branch, … and only HEAD while that branch is checked out.`
- **Evidence:** `P/bytedesk-passport--bytedesk-worktrees-TM-262-enable-bastion-access-context-from-durable-passp/d82729f9…:161`, `:179`, `:192` (2026-10-08 23:46–23:47).
- **Detail:** the real PR base was `feature/bastion-access-context`. A PR against TM-189 "would carry 582 files / 128 commits of unrelated lineage". The session ended with the task blocked and no PR.
- **Count:** 3 refusals, 1 session.
- **Root cause:**
  - `task-management/lib/worker-guard.mjs:238` uses `ownBase(ctx)`, the repo-wide configured integration branch, not the task's own base.
  - Command classification does not respect quoting.
- **Tracked:** no.
- **Fix (code):**
  - Use the base recorded at admission or dispatch.
  - Do not classify text inside quoted arguments as a command.
  - Always allow `tm block`.
- **Fix (config):** passport's integration-branch setting is stale. It points at `tm/TM-189-boards-staging-evidence`, recorded in passport `.bytedesk/task-management/index.json`.

## 6. Gaps in governed ownership and rework recovery

- **Role:** lead, Codex worker.
- **Exact errors:**
  - `TM_GOVERNED_ADMISSION_REQUIRED: TM-010: admitted ownership or working state does not match the task; run ao-topology manage admit --task TM-010 before dispatch` (7 occurrences, 3 sessions)
  - `TOPOLOGY_MANAGEMENT_WORKER: Only a currently live registered worker can establish a new ownership binding.` (6 occurrences in Codex rollout `2026-10-05T03-27-54`)
  - `TOPOLOGY_MANAGEMENT_OWNERSHIP: Task claim is missing, unknown, or held by another session; reconcile ownership without stealing.` (9 occurrences, 4 sessions)
  - `TOPOLOGY_MANAGEMENT_DISPATCH: tm dispatch TM-478 failed: TM_GOVERNED_ADMISSION_REQUIRED…`
- **Evidence:**
  - `P/bytedesk-agent-browser--bytedesk-agent-orchestration-agents-c1b0c1fd/4095d405…:1214`, `:1276`: no route back to "working" after `changes_requested`. A manual worker was then denied as `[Create Unsafe Agents]` at `:1272`.
  - `P/bytedesk-marketplace--bytedesk-agent-orchestration-agents-fd2b831f/253de95a…:6999` (2026-10-09 04:31).
  - `P/bytedesk-passport--bytedesk-agent-orchestration-agents-a01e40af/…:1208`, `:1223` (2026-10-08 23:35).
- **Tracked:**
  - TM-347 (done; agent-browser `:2570` confirms rework now works).
  - In progress: TM-412 (Codex terminal ownership), TM-413, TM-417, TM-426.
  - Open: TM-401.
- **Fix:** already in flight. Confirm the Codex delegation path (TM-412) and the TM-478 dispatch-after-rework path are both covered.

## 7. Mail held or undeliverable

- **Role:** lead to worker, lead to lead.
- **States seen:**
  - `unknown_recipient` for dispatched workers and the Codex session
  - `leads_not_ready`
  - held until a readiness probe is answered
  - `TOPOLOGY_LEAD_PROBE_UNKNOWN: No pending probe <id> for this repository — it may already have timed out.` (8 occurrences, 4 sessions)
  - `TOPOLOGY_MAILBOX_RECEIPT_MISSING: No accepted obligation exists for this message.` (3 occurrences, 2 sessions)
- **Evidence:**
  - `P/design-system--bytedesk-agent-orchestration-agents-d04c2baa/04f25c3d…:528` (2026-10-05): a reply to a dispatched worker was held as `unknown_recipient`.
  - `P/bytedesk-agent-browser--bytedesk-agent-orchestration-agents-c1b0c1fd/4095d405…:1064`: the lead fell back to task comments.
  - `P/bytedesk-remote-gateway--bytedesk-agent-orchestration-agents-d60f0608/5d4c6e17…:1440` (2026-10-09 02:37): `leads_not_ready`.
  - `P/Bastion--bytedesk-agent-orchestration-agents-dc778cb2/2d38b07f…:591`: held because the infrastructure lead read as unresponsive.
- **Tracked:** TM-431 (open; worker recipient), TM-478 (in progress; probes expire), TM-384 (done; pane-ring fallback).
- **Fix (code):** TM-431. Resolve `task:<TM-id>` to the worker's registered session. TM-478 for probes.

## 8. Actions only a person can take

- **Role:** lead.
- **8a. Delegation grant.**
  - Text: "It needs only your plan grant; `delegate list` still shows none. … Please run: `ao-topology delegate grant --to c1b0c1fd --repo "$PWD" --scope integrate,record-landing --epic EP-004 …`"
  - Evidence: `P/bytedesk-agent-browser--…c1b0c1fd/4095d405…:2284` (2026-10-05 16:03). An approved PR with green checks sat unmerged.
  - Root cause: the ADR-0027 / TM-263 lifetime authority covers the marketplace lead. Other repo leads still need a per-plan operator grant, which conflicts with the 2026-10-05 standing autonomy in `~/.agents/AGENTS.md`.
  - Tracked: TM-422 (open, related); TM-263 and TM-368 (done, marketplace scope).
  - Fix (config / policy): apply the autonomy policy (`pr|merge|publish`, TM-368) to every enrolled repo lead.
- **8b. No TeamCity access.**
  - Text: "Publishing 3.2.1 now needs one TeamCity rerun that I can't trigger, because this session has no TeamCity API access. **Needs you:** in TeamCity, run `ByteDesk_DesignSystem_ReleasePublish`…"
  - Evidence: `P/design-system--…d04c2baa/04f25c3d…:1000` (2026-10-06 12:57). The attempt to find a token at `:971` was denied as `[Credential Exploration]`.
  - Tracked: no.
  - Fix (config): give leads a TeamCity trigger path with a scoped token, through the `teamcity-mcp` plugin or `infrastructure/bin/infra run teamcity-prod`, which the infrastructure lead already uses. Do not use secret lookups.

## 9. Auto-mode classifier denials of actions the standing autonomy allows

- **Role:** lead.
- **Exact errors:** `Permission for this action was denied by the Claude Code auto mode classifier. Reason: [<category>].` Instances:
  - `[Merge Without Review]` on `gh pr merge 184 --merge --match-head-commit …` after review: `P/bytedesk-marketplace--…fd2b831f/253de95a…:642` (2026-10-05 11:15).
  - `[CI Bypass]` posting an independent-review approval comment on PR #128: `P/design-system--…d04c2baa/04f25c3d…:1728`.
  - `[Modify Shared Resources]` moving retired agent directories: `P/bytedesk-agent-browser--…c1b0c1fd/4095d405…:2808` (2026-10-09 01:47).
  - `[Self-Modification]`: `…c1b0c1fd/4095d405…:746` (editing project `.claude/settings.json`) and `:1016` (adding a permission rule).
  - `[Instruction Poisoning]` editing a memory file: `…fd2b831f/253de95a…:486`.
  - `[Create Unsafe Agents]` starting a worker by hand: `…c1b0c1fd/4095d405…:1272`.
  - `[Credential Materialization]` and `[Credential Leakage]`: `…c1b0c1fd/4095d405…:958`, `:986`.
- **Count:** about 12 denials, 6 sessions.
- **Deliberate:** these are Claude Code safety checks, not repo code. The credential, self-modification and unsafe-agent denials are correct and should stay.
- **Tracked:** partly. TM-494 adds `ao-topology agent retire`, which replaces moving directories by hand.
- **Fix (code):** route merges and agent retirement through governed verbs (`ao-topology manage land`, `agent retire`). Agents then never issue a raw `gh pr merge` or `mv agents/…`.
- **Fix (config):** possible allow rules for those verbs; see the recommendations section below.

## 10. `guard-project-install` blocked every commit (resolved)

- **Role:** all roles in the affected repos.
- **Exact error:** `FAIL <repo>/.claude/settings.json: enables task-management@bytedesk; enable it in ~/.claude/settings.json instead Commit blocked: remove the entry named above…`
- **Evidence:**
  - `P/agent-fabric/83f65be5…:100` (2026-10-05 11:27)
  - `P/bytedesk-agent-browser--…c1b0c1fd/4095d405…:733`: the lead stopped all of EP-004 at `:755`.
  - `P/agent-fabric--bytedesk-worktrees-TM-016-…/7e453e7e…:458`, `:499`
- **Count:** 7 refusals, 4 sessions, all on 2026-10-05.
- **Tracked and resolved:** TM-370 and TM-392 (done). No instances after 2026-10-05. Listed as a regression to watch.

## 11. Headless `claude -p` workers end their turn while a background job is still running

- **Role:** worker.
- **Signal:** last assistant entry `stop_reason: end_turn`, with background commands or a Monitor started and not finished.
- **Evidence:**
  - `P/bytedesk-marketplace--bytedesk-worktrees-TM-478-…/abeefc74…`: last text "Waiting on the check run at `1840383b`." (2026-10-09 05:06; 5 background jobs, 1 Monitor).
  - `P/…worktrees-TM-484-…`: "The checks are rerunning at `02b4a748`. When they finish, I'll compare…" (05:08).
  - `P/…worktrees-TM-485-…`: "The agent-orchestration unit suite is still running, with a 15-minute limit." (05:11).
  - `P/…worktrees-TM-478-…/f990fb62…`: "A leftover background waiter was stopped at its time limit" (03:29).
- **Count:** 3 sessions ending this way, plus 1 earlier leftover waiter.
- **Unverified:** these sessions were seconds to minutes old when scanned. I did not confirm whether the process exited or was re-invoked.
- **Tracked:** TM-292 (open).
- **Fix (code):** TM-292. The dispatch harness keeps the `-p` process alive, or re-invokes it, until its background jobs finish. Alternatively, the worker brief forbids ending a turn with background work pending.

## 12. A reviewer verdict refused for format kills the request

- **Role:** reviewer.
- **Exact error:** `TOPOLOGY_REVIEWER_REQUEST_FAILED: This review request already failed (The reviewer's response was refused: Finding 4 must state its evidence.); request the review again for a fresh nonce.` `TOPOLOGY_REVIEWER_FINDINGS` appears 5 times in 4 sessions.
- **Evidence:**
  - `P/Bastion--…agents-dc778cb2/…:803` (2026-10-05 13:58).
  - `P/bytedesk-agent-browser--…c1b0c1fd/4095d405…:2141` (2026-10-05 14:05).
  - Related: `P/Bastion--…agents-e9753d68/db22b476…:197`. The reviewer re-sent an identical verdict because "the host says it never received my last answer".
- **Root cause:** verdicts were printed in the pane as `AO_REVIEW` lines and validated only on collection, so the reviewer could not correct one.
- **Tracked:** TM-195 (done). `review_submit` now validates when the verdict is submitted. No instances after 2026-10-05.
- **Fix:** probably already fixed. Confirm `review_submit` returns a validation error the reviewer can retry, instead of failing the request.

## 13. `SendMessage` refuses shutdown requests sent as JSON text

- **Role:** lead.
- **Exact error:** `message text must not be a teammate protocol frame (permission/mode/plan/shutdown JSON) — to respond to a plan or shutdown request, use the structured object form ({"message": {"type": ...}}); otherwise send plain text`
- **Evidence:**
  - `P/agent-fabric/83f65be5…:668`, `:679` (2026-10-05 13:59).
  - `P/bytedesk-marketplace/d82e2db7…:2693`, `:2706`.
  - `P/agent-fabric--bytedesk-worktrees-TM-016-…/7e453e7e…:785–793`.
- **Count:** 8 refusals, 3 sessions. The subagents were left running until the agents retried in object form.
- **Root cause:** `~/.agents/AGENTS.md` ("Always shut subagents down…") tells agents to send `{"type": "shutdown_request", "reason": "..."}`. They pass it as a JSON string.
- **Tracked:** no.
- **Fix (docs):** add to that rule: "pass `message` as an object, not a JSON string."

## 14. Prompt acknowledgement refused

- **Role:** lead.
- **Exact error:** `TOPOLOGY_PROMPT_ACK_INVALID: Only the exact started process can acknowledge its current staged prompt.`
- **Evidence:**
  - `P/bytedesk-agent-browser--…c1b0c1fd/4095d405…:67` (2026-10-05 08:13)
  - `P/agent-fabric--bytedesk-agent-orchestration-agents-c2c984bc/95dc235f…:85` (11:21)
  - `P/agent-fabric--bytedesk-worktrees-TM-016-…/7e453e7e…:72` (13:47)
  - `P/infrastructure--…agents-aad9e97d/d47a6bcf…` (12:32)
- **Count:** 4 sessions, all on 2026-10-05.
- **Root cause:** the refusal is raised at `agent-orchestration/topology/lib/prompt-lifecycle.mjs:75`. **Unverified:** I did not check whether the ack came from the wrong process (a worktree worker using the lead's command, or a relaunched pane) or whether the identity check was too strict.
- **Tracked:** TM-172 (open) covers only the opposite, security side: an ack trusted too easily.
- **Fix:** investigate `reason` in the error details first. If the cause is a relaunch, ack against the new incarnation automatically at start.

## 15. Low impact; agents worked around these

- **`sleep` blocked:** `Blocked: sleep N followed by: …` (about 13 times, about 10 sessions). This is a Claude Code harness rule; agents switched to Monitor.
- **ReadNotifications switched off:** `No such tool available: ReadNotifications … switched off in this session` (2 times): `P/infrastructure/daa70b0a…:629` and `…fd2b831f/253de95a…:6900`.
- **Write disabled:** `No such tool available: Write. Write is disabled for this session` (1 time): `…c1b0c1fd/4095d405…:208`, in plan mode.
- **Infrastructure lead refusals:** a TeamCity API mutation was rejected by the user (`P/infrastructure--…aad9e97d/d47a6bcf…:994`), and a cluster decommission script was denied by the classifier (`:1936`). Both were plausibly correct refusals of external or production actions.
- **`infra-guard`:** `GitHub Actions workflows are not allowed here` (1 time). Intended policy.
- **Tracked:** no; none needed.

---

## Recommended settings.json and permission changes

I recommend **no** edits to settings.json or to permission allow/deny lists to fix problems 1–7. Those need code changes (listed above), because the security intent is enforced by code paths and launch flags, not by permissions.

The only permission-shaped options I raised are optional, for problems 9 and 8b. Each one widens what runs without the classifier, so each is your call:

1. **Problem 9, allow the governed landing verb.** Add `Bash(ao-topology manage land:*)` to `permissions.allow` in each repo lead's `.claude/settings.json`. Only after merges are routed through that verb, which enforces the review and checks gates in code. I do **not** recommend allowing raw `Bash(gh pr merge:*)`; the classifier's `[Merge Without Review]` denial on raw merges is useful.
2. **Problem 9, allow agent retirement.** `Bash(ao-topology agent retire:*)`, once TM-494 lands. It refuses live agents in code.
3. **Problem 8b, TeamCity access.** I recommend a scoped TeamCity token delivered through the `teamcity-mcp` plugin config, not a Bash allow rule and not credential lookups. No allow rule is proposed.

**Not recommended, and kept denied as they are:**
- Reviewer Bash.
- `Bash(tmux set-environment …)` for API keys (asked for at agent-browser `:1016`).
- Any rule letting an agent edit its own settings or permissions.
- Any change to `reviewer.mjs:223`'s `--restricted`, `--allowed-tools` or `--disallowed-tools`.

**Launch flags:** problem 2's fix adds a tool to the existing `ao-review` MCP server, which `--allowed-tools` already admits. It is a code change in that server. It needs no new launch flag or allow entry, apart from listing the new tool name next to `REVIEW_SUBMIT_TOOL` in `--allowed-tools`.
