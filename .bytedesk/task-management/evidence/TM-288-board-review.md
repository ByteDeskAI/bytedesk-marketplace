# TM-288 — board review after the EP-019 orchestration work

**Date:** 2026-10-02.
**State measured:** `fix/ao-local-nats-autostart` at e2e7fb8d (ao 0.15.0).
**Method:** three read-only reviewers checked every open, blocked and parked task and every open epic against the shipped code and git history. Nothing was changed while reviewing. Excluded: my own current tasks, TM-272–289. Most of those are waiting for a human to merge PRs #142–#149; the rest are TM-282 (macOS prep), TM-287, TM-288 and TM-289.

**Status: proposal. Nothing below has been applied.**

## 1. Close now — the work is already merged

Each of these is backed by merged PRs, a commit in HEAD, and file:line or test evidence.

| Task | Why it can close | Evidence |
|---|---|---|
| TM-217 | Reviewer ages out an incomplete verdict | PR #123 (8b26684); reviewer.mjs:1246/1280 `ageOutIncompleteReview`; test topology-reviewer-findings.test.mjs:310–331 |
| TM-240 | Ungoverned dispatch is refused | PR #129 (f20d03b); governance-check.mjs:63; governance.test.mjs:176,196; topology-management.test.mjs:151; docs/agent-first.md:172. AC2, AC3 and AC6 are covered by the merged PR and the existing evidence file |
| TM-241 | Review range over 8 MiB | PR #128 (44e9fd4, 537b5db); reviewer.mjs:802–808, :858; follow-ups already filed as TM-260 |
| TM-248 | Plan approval becomes a delegation | PRs #133 and #135 (2d42492); delegation.mjs:81–96; cli.mjs:139; topology-management.test.mjs:522,539,573 |
| TM-249 | `manage integrate` merges the PR | PR #135; management.mjs:683–729; test :1135; TM-263 refusal tests :1389 |
| TM-257 | Review of a branch that merged main | Landed through TM-258 (PR #132): reviewer.mjs:737 `effectiveBase`; management.mjs:538; topology-reviewer.test.mjs:477–546. PR #131 is closed, and the branch was superseded |

Five of these show "in progress" with abandoned worktrees: each sits at bb449843 (09-27) with 0 commits ahead. The store never ran `tm done`. TM-257's branch is also superseded.

## 2. Close after you merge the ao PRs (#142–#149)

The covering work exists only on PR branches, not on `origin/main`.

| Task | Outcome | Covered by |
|---|---|---|
| TM-256 | Close | c3888f80 (TM-264) plus TM-281's preflight (382a2f71); tmux-isolation.test.mjs |
| TM-184 | Duplicate of TM-281 | The helper and preflight. First add one run from inside tmux (with TMUX inherited) to TM-281's evidence, as TM-184's AC3 asks |
| TM-275 | Duplicate of TM-277 | 11d9afad; topology-supervision-transport.test.mjs:102, :193 |
| TM-270 | Duplicate (superseded) of TM-274 / ADR-0030 | session-names.mjs:78; `roleSessionName` removed in 0.13.0 |

## 3. Obsolete or duplicate — no merge needed

| Task | Outcome | Why |
|---|---|---|
| TM-266 | Obsolete; also close its PR #139 | 0.12.0 enrols every repo by default (repo-enrollment.mjs:16, :55). SessionStart runs `services ensure`. AC2 ("no supervisor before opt-in") now contradicts shipped behaviour |
| TM-262 | Duplicate of TM-254 | Same flaky test, topology-reviewer.test.mjs:38. Move its CI diagnosis (run 36291669173) into TM-254 as the AC1 cause |
| TM-192 | Duplicate of gateway TM-304 (PR #114, merged 09-12) | src/cli.mjs:72–78; service.mjs:283, :284, :523. AC5's plugin-rsync step was superseded by TM-284 |

## 4. Unblock — the blocker is done or no longer applies

| Task | What resolved it |
|---|---|
| TM-202 | Gateway TM-330 is done. The browser proof can run now, against the TM-274 session names |
| TM-239 | TM-235 is done. All three guard defects are still in worker-guard.mjs:113, :136 |
| TM-244 | TM-240 is merged. Update the body's line reference from 403–411 to 410–418 |
| TM-269 | ao now runs its own managed NATS when the gateway `orch.sock` is absent (orch-transport.mjs:434–440). Replace the block with "re-run AC1 against managed NATS; gateway TM-494 applies only when the orch listener exists" |
| TM-203 | Un-park. Still not addressed; it needs a live doctor run plus one turn |

## 5. Update scope or criteria — still valid

| Task | Proposed change |
|---|---|
| TM-182 | Tick AC2 and AC3 (met by 6466bfdd / SESSION-NAMES-HASHES.txt and its test). Keep only AC1. New title: "decide whether the D1 header-addendum amendment needs gateway re-countersignature" |
| TM-186 | The code fix landed in c0a66d6c, but no CLI-level test proves `supervise` exits. Add AC: "a CLI test removes the consumer and asserts the process exits", and link to TM-289 (the process-compose restart loop) |
| TM-189 | AC2 is partly met: our hash test pins role-icon-map.json. New AC2: "the registry is checked against the fixture, and the request document names the gateway notification step" |
| TM-195 | **Possible live break.** On NATS the collector waits for a verdict there, but the write-free reviewer cannot publish one with findings. `review publish` hardcodes `findings: []` and defaults to `approve`. New title: "reviewer verdicts have no findings-carrying path the write-free reviewer can use". New ACs: (1) one channel per transport; (2) findings arrive intact on both paths; (3) a malformed response is rejected |
| TM-206 | Tick AC1 (c0a66d6c, lead.mjs:247/252). AC2 becomes: "a cache miss and every TOPOLOGY_LEAD_PROBE_OWNER refusal name the failing field or condition" |
| TM-220 | Widen it: the new NATS collect path (reviewer.mjs:1266–1272) also lacks the failed-request guard |
| TM-247 | New AC10: "record-landing resolves the target against origin/<target> after a fetch". integrate already does (207e7e65) |
| TM-251 | Partly shipped. New ACs: (1) cleanup refuses develop, main and release/*, with a test for each; (2) remote branch deletion stays out of scope. Drop the stale TM-234 block |
| TM-253 | Change the blockers to TM-250 and TM-251, since TM-234, TM-243, TM-248 and TM-249 are done. Make AC1 cover both authorities: a live delegation, or the ADR-0027 server-side policy. AC2: refusals with no grant, an expired grant, a policy naming a different lead, or from a worker session |
| TM-259 | Tick AC1 (TM-263 pins the repo: repoid.mjs:82–104). Keep AC2 and AC3 |
| TM-261 | AC3 is met (.gitignore:83; CHANGELOG:199). Drop it or tick it |
| TM-242 | **Not shipped.** PR #130 is open with 4 failing checks and is built on the removed `roleSessionName`. Untick all its ACs and block it: "rework onto 0.15.0 openRoleSession" |
| TM-276 | **Needs your decision.** Its ACs contradict 0.12.0's deliberate fallback from an unreachable ambient `NATS_URL` to the managed local NATS. Decide which NATS is authoritative (record it as an ADR). Then the ACs become: (1) log the selected transport and its source at supervisor start; (2) log a named warning on fallback; (3) test each source |

## 6. Keep — still valid as written (42)

**Agent-orchestration defects confirmed still present at file:line:** TM-172 (reuse `callerRunsInPane` from TM-234), TM-181, TM-183, TM-194, TM-208, TM-209, TM-211, TM-216, TM-219, TM-222, TM-225, TM-226, TM-237, TM-252, TM-254, TM-260, TM-271, TM-278.

**Task-management or other plugins, untouched by this work:** TM-105, TM-173, TM-190, TM-191, TM-196, TM-197, TM-200, TM-205, TM-207, TM-212, TM-213, TM-223, TM-246, TM-255.

**Human or operator decisions:** TM-106, TM-109, TM-199, TM-210.

**Blocked by open work:** TM-227 and TM-228 (on TM-226); TM-229 and TM-230 (gateway EP-027 parked); TM-245 (on TM-244); TM-250.

## 7. Epics

- **EP-015:** coherent; keep it open.
- **EP-019 (65 tasks):** split it into three:
  - (a) ao 0.12–0.15 managed services and ADR-0030 naming: TM-272–289;
  - (b) governed landing autonomy: TM-243, TM-247–253, TM-257–263;
  - (c) ao hardening: the remainder.
- **EP-021:** its own scope is done (TM-174–180, TM-188).
  - Move the ao-only items to EP-019: TM-203, 216, 217, 219, 220, 222, 225, 270, 271, 275, 276, 278.
  - Give TM-226–230 (the gateway console) their own epic.
  - Close EP-021 when the tm-only items finish: TM-191, 199, 200, 205, 212, 213, 223, 239, 246, 255.
- **EP-022:** coherent; it closes with TM-269.

## 8. Other findings

- **Stale `blocked-by` links:** TM-216 and TM-219 (to TM-215 and TM-218); TM-217 (to TM-215); TM-248, TM-249, TM-250 and TM-251 (to TM-234).
- **Open PRs for tasks that are done:** #116 (TM-193), #126 (TM-238), #127 (TM-236), #138 (TM-265).
- **Comment spam:** `tm show` returns about 2.2–2.5 MB for TM-217, 240, 241 and 242 (the TM-238 symptom).
- **Silent fixes:** c0a66d6c (09-22) partly fixed TM-186 and TM-206 without updating either task. Other old tasks may have unrecorded partial fixes.
- **Stale hash file:** TM-136's HEADER-EXTENSION-HASHES.txt still lists 6f15b383, so `sha256sum -c` on that file fails.
- **Filed during this review:** TM-289. process-compose restarts a supervisor that exits on purpose (retired repo, lock loser) every 3 seconds. Confirmed in code; not triggered here yet.
