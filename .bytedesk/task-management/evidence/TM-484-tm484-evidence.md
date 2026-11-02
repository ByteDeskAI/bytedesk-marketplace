# TM-484 evidence — commit 91f1d33c44a2b9f49066be2a1608b0963be9be87, PR #238

## New tests: pass on this commit, fail on the old code
- topology-persona-registry.test.mjs: 16/16 pass, including "two nodes with one checkout path ...".
  Against HEAD's persona-registry.mjs, the two-node test fails: 'ada' !== 'run-on-a', so the live holder was freed.
- topology-respawn.test.mjs: 8/8 pass. Against HEAD's launch.mjs and respawn.mjs, both TM-484 tests fail:
  - automated open: "Missing expected rejection" (TOPOLOGY_AGENT_ALREADY_LIVE)
  - multi-agent launch: "the idle agent's session was not ended" (actual false)
- Related files after the review fixes: respawn, persona-registry, agent-restart, launch, pass-env, observer, lead-liveness, supervision-transport — 110/110 pass.

## Required checks at 91f1d33c44a2b9f49066be2a1608b0963be9be87 (logs in /tmp/tm484-checks/)
| check | exit |
|---|---|
| agent-orchestration: npm ci | 0 |
| agent-orchestration: unit | 1 (killed: hung in mcp-contract.test.mjs) |
| agent-orchestration: build:check | 0 |
| task-management: unit | 1 (17 fail; task-management is unchanged by this PR) |
| agent-orchestration: plugin validate | 0 |
| task-management: plugin validate | 0 |

## The failures predate this change
- **mcp-contract.test.mjs hang:** it hangs at "TM-352: orchestration_mailbox_wait ..." on unchanged main ab2006bc too (timeout 180 s, exit 124). Session TM-427 sees the same hang.
- **10 agent-orchestration unit failures** (npm run test:unit, 1230/1244 pass): goal-loop-console, topology-management (record-landing, integrate), mailbox-send, prompt-modes and workflow-control. Every one also fails on unchanged HEAD in a clean worktree (167 pass / 10 fail there), and the set is identical.
- **task-management unit:** git diff ab2006bc..HEAD -- task-management is empty.

## Independent review (subagent)
- Fixed: automated launch paths defaulted to respawn → launchRunNative now defaults respawn=false.
- Fixed: the turn-end check could be stale at commit → commit() re-checks the turn.
- Fixed: a failed per-node presence put failed the whole publish → that put is now best effort.
- Accepted: a node-name mismatch leaves the holder unknown, so the persona is kept. This is safe.
