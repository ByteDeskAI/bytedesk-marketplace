# TM-427 rework at 55f68a718b86e6a1f3bdb01e5f2cf9d5e1d31b39

This revision addresses the lead's review-235 (task comment of 2026-10-09 04:29). The fix commit
is f1000dfd. 55f68a71 merges current main (26 commits) on top of it, with the `dist/` bundles
regenerated.

## Review findings

| # | Finding | Change | Test (each mutation-checked: removing the guard turns it red) |
|---|---|---|---|
| 1 | `recordReview` is exported and trusts `AO_AGENT_ID` | The exported `recordReview` requires `requireReviewerCaller` (live pane plus ancestry). `collectReview` writes through the unexported `writeReview`. `AO_AGENT_ID` is not consulted. | topology-reviewer "review record rejects impersonation…": a non-reviewer process naming the reviewer is refused; no live pane is refused; no review is written |
| 2 | The HMAC seal is false assurance | Seal, `sealVerdict`, `verdict.key` and `submitter_pid` removed (lead decision). The per-request nonce still binds a verdict to its request. | topology-reviewer: a verdict file for another request is ignored; the proven channel is collected |
| 3 | `sessionIdentity` trusts `AO_AGENT_ID` for non-lead agents | `requireBoundAgentCaller` (delegation.mjs): an agent with a census row or reviewer record must descend from that pane (`TOPOLOGY_SENDER_MISMATCH`). Only an agent with no recorded pane falls back to env. Unreadable ancestry fails closed. | topology-mailbox-send TM-462B test: forged reviewer and observer ids refused, in or out of a pane; reviewer-record-only binding; unreadable ancestry; the real bound agent and an unbound agent pass |
| 4 | Document the same-user residual | CHANGELOG "Known residual" entry, plus `docs/repository-leads.md`, both naming TM-508. CHANGELOG also notes the second-terminal refusal (minor finding). | — |
| 5 | Stale `review submit` docs | README.md and docs/repository-leads.md updated. | — |

Acceptance criterion 2 is un-ticked; see TM-427 comment 31.

## Required checks (exact `management.required_checks` argv; `summary.json`)

| Check | Exit | Notes |
|---|---|---|
| agent-orchestration: npm ci | 0 | `1.txt` |
| agent-orchestration: unit | **1**, then 0 | Run 1 (`2.txt`) reached the check's 900 s limit at test 1278 of 1339 on a host with load average about 11. It also recorded one teardown failure (`ENOTEMPTY` removing a temp dir) in topology-supervision-transport, which passes 2/2 alone; the branch does not touch supervision. Rerun (`2-rerun.txt`): 1339 tests, 1335 pass, 4 skipped, 0 fail, 559 s. |
| agent-orchestration: build:check | 0 | `3.txt` |
| task-management: unit | 0 | `4.txt` |
| agent-orchestration: plugin validate | 0 | `5.txt` |
| task-management: plugin validate | 0 | `6.txt` |
| plugin-rsync: tests | 0 | `7.txt` |
| contracts (not a required check) | 0 | 18/18, `contracts.txt` |
| GitHub CI run 37908923766 | success | headSha 55f68a71: unit-build-contracts, TM-111, test-build-install, check |

Also run: `npm run -s roadmap:check` passed before the merge commit.
