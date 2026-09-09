# Kimi transcript takeover checkpoint

Kimi marketplace %113 (TM-127) and Gateway %116 (TM-222) stopped on usage-limit 403, leaving incomplete uncommitted implementations. Existing sessions, conversations, composers and unrelated work were preserved. User authorized Codex continuation; task TM-127 ownership transferred through tm to codex-takeover.

## Saved implementation

Marketplace task branch commit f3f21e743bb7acf2237244fc5ca2589c42cf01d8; task worktree clean. 69 files, including inherited Kimi work repaired and missing runtime modules completed. No merge, push, deployment, cache refresh or cleanup of original task worktrees.

Implemented canonical repository leads; exact-incarnation ownership/enrollment; startup hook/watcher fencing; configurable shared prompt composition and acknowledged refresh; durable standing and workflow admission/forwarding/replies; presence producer; task lifecycle and restricted reviewer integration; supervision; CLI/docs. Fixed tmux timeouts falsely counted as readiness and isolated managed shell startup. Routine mailbox delivery no longer types into live terminal input.

Gateway portable presence parser/grouping is in TM-222's existing worktree under plugins/orchestration-terminals/presence. Shared host/SDK/UI files remain unmodified by this takeover.

## Verification

- Whole marketplace unit suite: 382 passed, 4 existing skips, 0 failed.
- Whole contract suite: 4 passed, 0 skipped/failed; includes packed plugin and actual private-server tmux launch, durable inbox receipt, provider fallback/failover, exact bindings and cleanup.
- build:all, build:check, design-system:check, roadmap:check, plain Claude plugin validate, git diff --check passed. Expected versionless warning retained.
- Independent focused review tests 37/37 and source approval. Exact source manifest hash 35fc1a008a42504b9a72dc976034ec5b1707df44f913d307aa5e1e40df124c1a verified against committed checkout.
- Two real scratch Git repositories and tmux bindings: snapshots accepted by frozen Python validator and Gateway Go parser. Registration metadata synthetic. Evidence /tmp/tm127-presence-integration-review/RESULT.md and FINAL-SOURCE-REVIEW.md.
- Actual restricted Claude read-only inbox smoke passed: /tmp/ao-reviewer-readonly-smoke-jzjl299y/SUMMARY.json. This is not proof of persistent idle polling/lead-reviewer operation.

## Remaining acceptance and explicit decision

Full work is NOT complete. Live persistent lead/reviewer readiness and cooperative safe-boundary inbox polling remain operational acceptance, separate from fixture contracts. Restricted reviewer implementation supports Claude; Codex is explicitly refused pending an enforceable scoped MCP/read-only launch.

Gateway generic terminal presentation is an SDK contract gap. Pending operator decision: add a generic contribution containing authorized terminal IDs, badges, group labels and freshness, with the host preserving terminal instances and withdrawing owner-scoped contributions when disabled. Existing SDK has no terminal grouping interface. Gateway AGENTS.md lines 80-95 explicitly says stop and raise SDK gaps with operator before changing SDK or using local duplicate types; prior coordinator GATEWAY-SEAMS-REVIEW.md withheld shared integration. Approved expansion requires SDK release chain, host adaptation, plugin assembly, browser acceptance for grouping/focus/scrollback/reconnect/disable, then owning-repo integration/cutover gates. Nothing has been silently waived.

No AC marked done and no task closed. This checkpoint preserves the full intended scope for continuation after the SDK decision.

## Additional live reviewer acceptance

Actual persistent restricted Claude reviewer startup passed in 23.67 seconds after normal scratch-workspace trust acceptance. Production reviewerProbeReady returned true after the model read its real challenge and emitted the exact nonce. No synthetic acknowledgement or peer interaction. Evidence /tmp/ao-persistent-reviewer-zcyjc51m/result.json and final-pane-0.txt. Private server cleaned up. This supersedes the earlier missing startup-readiness proof for the reviewer, but does not prove automatic wakeup after idle or persistent lead readiness.

## Additional live lead acceptance

Actual persistent Claude lead startup passed in 35.46 seconds. The model ran the intended ao-topology lead ack command for a real challenge; production leadState returned responsive with the exact registered binding. No synthetic acknowledgement. Evidence /tmp/ao-persistent-reviewer-px3sjdme/result.json and final-pane-0.txt. Private server cleaned up. Both lead and reviewer startup readiness are now proven; automatic wakeup after an idle turn remains untested and is not claimed.

The concrete pending SDK direction is GATEWAY-SDK-PROPOSAL.md, also attached to Gateway TM-222 through tm evidence.
