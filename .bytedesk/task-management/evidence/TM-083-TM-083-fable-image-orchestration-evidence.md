# TM-083 verification

- Integration commit: `0c8eab8` (`agent-orchestration: expose exact Fable 5.1 routing`)
- Focused tests: 42 passed, 0 failed (`/tmp/tm083-focused-old-adapter.log`)
- Roadmap source manifest refreshed; `npm run roadmap:check` reported `ROADMAP OK`.
- Existing unrelated suite failures remain in `platform-runtime.test.mjs` PATHEXT fixture and `roadmap.test.mjs` symlink canonicality assertion.
- Existing contract fixture reports `bootstrap_credentials_exposed`; dependency versions were restored to baseline and no Claude Agent SDK dependency was added to task-management.

## Live Fable ACP probe

- Run: `run_4fbff3c0-9e0c-4e85-a199-ad48f9b7c398`
- State: `succeeded`
- Provider: `claude`
- Exact model: `claude-fable-5-1`
- Effort: `high`
- Permission: `read`
- Agent output reported no changed files.

## Live Codex image-generation probe

- Run: `run_16d590c8-761d-4206-bcc5-b315bda61319`
- State: `succeeded`
- Provider/model: `codex` / `gpt-5.6-sol`
- Native image-generation output: `bytedesk/designer/mockups/_capability-probe.png`
- PNG: 1672x941 RGB, 1,498,274 bytes
- SHA-256: `1c36bb944ad4c1e3a44f6797e5da023bc4f01c3d697dfacd23a710dd542e059a`
- The agent explicitly reported native image generation and no SVG/HTML/local drawing substitute.

## MCP host path

Both probes were spawned and monitored through `orchestration_*` MCP calls over stdio from this Pi session. Spawned session URLs were printed verbatim to the operator.
