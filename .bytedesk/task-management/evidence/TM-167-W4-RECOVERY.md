# TM-167 criteria 3, 4 and 5: receiver-owned lead recovery and held-mail backoff (W4)

**Result.** All three criteria are delivered at `497bbe8` on `tm/TM-167-recovery`, after
`b44f86a`. The branch is merged into `tm/EP-019-leads-icons`. Across 13 files it adds 1,053
lines and removes 42.

## Criterion 4: what the supervisor does with its own lead

`recoverLead` in `topology/lib/lead-recovery.mjs` runs once per reconcile, just before held mail
resumes.

| Situation | Action | Effect on retries |
|---|---|---|
| Repository not enrolled | `not-enrolled` | None. No probe, tmux listing, lock, state file, journal line or report key. |
| Inside the retry wait | `backoff` | None; nothing is observed. |
| Lead responsive | `reused` | Attempts, last error and alert reset. Wakes the mail that asked for proof. |
| Lead alive but unresponsive | `kept-unresponsive` | Counts as an attempt only when someone asked for proof. Never restarted, killed or duplicated. |
| Lead dead, owned externally | `held-dead-external` | One attempt. The alert names the `lead assign` command, is journalled once, and nothing replaces the lead. |
| Lead dead, managed | `restarted` | One attempt. Only after `ensureLead` re-reads the record and re-observes the recorded pane incarnation under the registration lock. |
| Lead missing | `created` | One attempt, through the `ensureLead` create path. |
| Any error | `failed` | One attempt; `last_error` is the error code and message. |

A restart fails closed:
- A failed tmux observation is `failed`, never "dead".
- A record without a recorded binding cannot be restarted unattended (`TOPOLOGY_LEAD_OWNERSHIP_UNKNOWN`).
- If the lead turns out to be alive when re-observed under the lock, nothing is opened.
- An inherited `AO_LEAD_ID` is removed before recovery runs.

## Criterion 5: visible failures and retry timing

- **Retry timing.** Retries wait 10 s, 30 s, 2 min, then 10 min per consecutive attempt. The count
  resets only once the lead proves responsive.
- **Launches count.** Each launch counts as an attempt, so a crash-looping provider is not relaunched
  on every reconcile.
- **Where the state lives:**
  - recovery state: `<state>/leads/<key>.recovery.json`
  - pending requests: `leads/recovery-requests/<key>/`
  - journal: `<key>.recovery.jsonl`
- **Where people see it.** `lead status` shows action, attempts, last error, next retry time, alert
  and pending requests. `doctor` reports `LEAD_DEAD_EXTERNAL` and `LEAD_RECOVERY_FAILING`.

## Criterion 3: durable cross-repository mail

- **Stored before anything else.** The message envelope is saved before any recovery is scheduled.
- **Readiness never rings a lead.** It is read from cached proof only (`ackTimeoutMs: 0`).
- **Recovery for sides that aren't ready.** A message held for `leads_not_ready` gets a durable
  recovery request for each side that isn't ready, then `activateRepository` for that side, after the
  message lock is released.
- **The repository does the work.** Its own supervisor sends at most one active probe per retry
  window. Once the lead responds, the supervisor wakes the waiting messages.
- **Unenrolled sides.** A side that is neither ready nor enrolled holds as
  `destination_not_enrolled` or `source_not_enrolled`. It gets no recovery request and no
  activation, and the hold retries on the same backoff, because enrollment can change.
- **Accepted decision.** A lead already proven responsive still receives mail even if its repository
  is not enrolled.
- **Backoff per message.** Each held message records `attempts`, `last_error` and `next_retry_at`.
- **Holds that never retry.** These are marked permanent: `hop_limit`, `loop`,
  `coordinator_not_worker`, `source_identity_required` and `repository_identity_changed`.
- **Exactly once.** Delivery takes a per-message lock and re-checks under that lock that the message
  is still due and not yet delivered. In the unit test, 8 resumers ran while the lead was down, then
  8 more plus 2 re-sends of the same message after the wake. Result: 1 delivery and 1 inbox item.

## Probe held inside the lock: fixed

`ensureLead` now decides under the lock and probes a live lead after releasing it. `recoverLead`
also probes outside every lock.

## Evidence at `497bbe8` (clean tree)

| Check | Result |
|---|---|
| Topology unit suite | 413/413, exit 0 (baseline at `4d76a60`: 397/397) |
| Stability, 5 direct runs per file (tests / pass / fail / exit, identical every run) | `lead-recovery` 10/10/0/0, `standing-mailbox` 16/16/0/0, `shared-admission` 8/8/0/0, `mailbox` 6/6/0/0, `lead` 2/2/0/0 |
| Contract `topology-lead-recovery-tmux` | 3/3 pass: an unenrolled destination starts nothing; a dead managed lead is restarted by its own supervisor and held mail then arrives exactly once; a live unresponsive lead is left alone |
| Leak check before and after, with a planted decoy as positive control | 0 supervisors, 0 leftover test directories |

**Unit red runs.** All 27 guards were broken one at a time on a synced scratch copy, and each
produced a failing test:
- R1–R21: the probe back inside the lock, a restart without a binding, `AO_LEAD_ID` kept, an
  observation failure read as dead, no re-observation, the alert repeated every tick, backoff
  ignored, a probe with no request, no wake, a readiness probe that rings under the message lock, no
  permanent holds, due-ness not re-checked, message backoff ignored, recovery run inside the message
  lock, recovery requested for ready sides, a side not activated, enrollment not checked, an
  external lead replaced, no reset, a launch not counted, an unresponsive lead not backed off.
- E1–E6: the enrollment gates.

**Contract red runs:**

| Run | What was broken | Result |
|---|---|---|
| CR1 | the supervisor never calls recovery | 2 of 3 tests fail |
| CR3 | both live-lead guards removed | 1 fails; the lead was restarted |
| CR4 | the mailbox's destination gate removed | 1 fails; a recovery request appeared for an unenrolled destination |

## Read, not run

- behaviour on the merged tree (it runs now as part of integration);
- real providers;
- a probe reaching an idle agent (the contract test answers with `lead ack` in the agent's place);
- `doctor` with a real failing recovery.

## Follow-ups noted

- After `supervise` retires because its consumer is gone, its `watchServer` promise may keep the
  process alive. Filed as a task.
- Without a binding, `defaultAlive` and `defaultPane` still call `listPanes(session)` on the default
  server. That covers legacy records only; recovery refuses to restart them.
