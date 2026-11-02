# TM-427 (+TM-462B) evidence — commit 4d87b43a4b95d87fdf84a9c26d45066fae6c890f (PR #235)

Brief section A implemented. Sections B-E (TM-428, TM-445, TM-488, TM-430) NOT done; see TM-427 comment 15.

## Checks at 4d87b43a4b95d87fdf84a9c26d45066fae6c890f
| check | exit | notes |
|---|---|---|
| npm ci | 0 | |
| build:check | 0 | dist rebuilt |
| roadmap:check | 0 | |
| plugin validate agent-orchestration | 0 | |
| plugin validate task-management | 0 | |
| AO unit, brief form (env -u TMUX -u TMUX_PANE -u AO_SESSION_* -u TM_DISPATCH_WORKER timeout 1500 npm run -s test:unit) | 0 | 1243 tests, 1239 pass, 0 fail |
| AO unit, required_checks argv (env -u TMUX node --test ... tests/unit/*.test.mjs) | 124 | hangs after mcp-contract test 109 without --import register-file-transport, identically on clean main 0110e0b7; bounded by timeout 1500 |
| task-management unit | 1 | 17 failures, identical set on clean main (TM-306: worker-session env) |

## Security checks (each mutation-verified)
- forged AO_AGENT_ID reviewer caller refused: library, MCP tool, CLI (review submit removed), reviewer ack
- unsealed / guessed / tampered verdict file ignored by collectReview and restart guard
- env-only lead claim refused: send, receive, inbox, dispose, @all-leads, run send
- ao-supervisor / ao-management / tm-dispatch refused from any process
- proven lead accepted by env name and by census binding
