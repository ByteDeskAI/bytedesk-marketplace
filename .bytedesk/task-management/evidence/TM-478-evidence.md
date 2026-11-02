# TM-478 / TM-402 evidence — revision 4f366ec6ff51f00bb1f9f421e9b17682f1e777fa

Tree: clean at the revision (only the session's graft wiring files outside agent-orchestration were dirty, untracked by this work).
Env: run through /tmp/tm478-clean-env.sh, which removes this dispatched worker's markers (TM_DISPATCH_*, TM_SESSION_ID, TM_ACTOR, TM_ROOT, AO_SESSION_*, CLAUDE_CODE_SESSION_ID, TMUX*). With them present, 10 AO tests and 17 task-management tests fail on TM_DISPATCH_WORKER guards; 177/177 of the AO ones pass with them removed.

## Required checks (management.required_checks)
| check | exit | note |
|---|---|---|
| agent-orchestration: npm ci | 0 | |
| agent-orchestration: unit (exact argv) | 124 | hangs in mcp-contract.test.mjs after "TM-352: orchestration_mailbox_wait ..." (109 ok, 0 not ok). Pre-existing: TM-491; same stop at base ab2006bc in /tmp/tm484-mcp-base.log. Rerun with a 2700s timeout stalled at the same test. |
| agent-orchestration: unit via npm run test:unit (preloads) | 0 | 1248 tests, 1244 pass, 0 fail |
| agent-orchestration: build:check | 0 | |
| task-management: unit | 1 | 1657 pass, 2 fail: lock.test.mjs assumes pid 999999 is dead; on this host process.kill(999999,0) succeeds. task-management is untouched by this branch (git diff ab2006bc..HEAD -- task-management is empty). Filed TM-506. |
| agent-orchestration: plugin validate | 0 | expected "No version specified" warning only |
| task-management: plugin validate | 0 | same |

## Acceptance criteria → tests (tests/unit/topology-lead-probe-stacking.test.mjs unless noted)
1. Second probe does not stack in a non-empty composer: "a second probe does not stack in a non-empty composer..." (real wakeForProbe, sticky-composer stub: 1 send and 1 probe file across 4 callers). Mutation (reuse disabled) fails it.
2. Undelivered/unsubmitted probe expiry does not mark unresponsive: "an undelivered or unsubmitted probe leaves the lead unproven..." (leadState status unproven for rang:false and submitted:false; unresponsive for delivered).
3. Interval backs off while answering: "the probe interval backs off while the lead keeps answering..." (TTL 1x/2x/4x cap; no ring at an age a 1-answer proof would have re-probed; reset after a delivered unanswered probe).
4. Withdraw: topology-standing-mailbox.test.mjs "TM-478: the sender withdraws held mail..." (identity-proven; ring count stays 1 after withdraw even when forced; resend does not revive; unknown and foreign ids answer identically).
TM-402: "the lead ring addresses the binding's tmux server" (argv recorded via shim: -S <serverKey>). Mutation (withServer removed) fails it.

## 2026-10-09 — CI fix, merges with main, required checks at 1840383be073c66572afc1cd6da7dda917fecce0

- CI failure on 4f366ec6 (`lead assign and role assign lead answer a failed supervisor identically`): the
  test's fake acker acked every `*.json` in `leads/probes/`, including TM-478's `<agent>.last-probe.json`
  memo, writing a second ack for the same nonce that names no repo. Fixture now matches probe filenames
  only (8e662ef5). Locally 2/3 red before, 6/6 green after. Production readers (`pendingLeadProbes`,
  `lateAck`, `lead ack`) already filter the memo by repo/agent.
- Merged origin/main twice (e9cdc90d, 1840383be073c66572afc1cd6da7dda917fecce0); dist rebuilt; cli.mjs help fixed so `withdraw` no longer splits
  `dispose` from its continuation line.
- GitHub CI at 1840383be073c66572afc1cd6da7dda917fecce0: unit-build-contracts, test-build-install, strict installed-cache, check all pass.
- Required checks at 1840383be073c66572afc1cd6da7dda917fecce0 (TM-478-required-checks-exits.txt): npm-ci 0, build-check 0, both validates 0.
  Unit checks run verbatim from this dispatched worker exit 1 (ao 9, tm 15 failures, all on
  TM_DISPATCH_WORKER/TM_ROOT gates). The same commands with the dispatch env unset: ao 1299/1299,
  tm 1677/1677. Filed TM-511 for the leaking check definitions.
