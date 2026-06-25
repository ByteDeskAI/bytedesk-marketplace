# Platform Dev

ByteDesk core implementation lifecycle — TDD engineer, feature start, PR-ready, worktree operator, architect, grounding, integration branches.

This plugin works across Claude Code, Codex, and grok-cli. Claude Code loads it via `.claude-plugin/plugin.json`; Codex via `.codex-plugin/plugin.json`; grok-cli and other AGENTS.md-aware agents read this file.

## Skills & commands

- **bytedesk-architect** (skill) — ByteDesk senior architect plan reviewer.
- **bytedesk-feature-start** (skill) — ByteDesk feature kickoff orchestrator.
- **bytedesk-ground** (skill) — Ground yourself on recent ByteDesk activity before acting.
- **bytedesk-integration-branch-operator** (skill) — ByteDesk integration-branch operator for multi-agent fan-out/fan-in work where many feature branches are merged into one integration branch and conflict resolutions must be preserved.
- **bytedesk-pr-ready** (skill) — ByteDesk PR creation workflow.
- **bytedesk-session-start** (skill) — Session start briefing for ByteDesk Platform — surfaces In Progress Jira work, current git state, open PRs, and the single most important next action.
- **bytedesk-software-engineer** (skill) — ByteDesk software engineer — TDD-first, full development lifecycle for the bytedesk-platform repo.
- **bytedesk-transcript-retrospective** (skill) — Analyze recent Claude/Codex/Grok transcripts, rollout summaries, and project memory to find repeated developer-workflow friction and recommend or implement worktree-operator / skill / rule / tooling i
- **bytedesk-worktree-operator** (skill) — ByteDesk worktree lifecycle operator.
- **README** (agent) — see source
- **architecture-modeler** (agent) — Structurizr C4 modeling, partition decomposition, diagram co-commit with code.
- **goal-orchestrator** (agent) — Goal docs, plan.json manifests, run_goals batches, Jira epic hygiene.
- **grounding-analyst** (agent) — Session catch-up — recent commits, PRs, Jira In Progress, recommended next action.
- **integration-reviewer** (agent) — Pre-implementation architect review and pre-PR integration gates.
- **lifecycle-operator** (agent) — Worktree lifecycle, localDev, ship, land, cleanup — scripts/dev/workflow.mjs only.
- **platform-builder** (agent) — TDD-first ByteDesk Platform implementation — backend, frontend, migrations, tests.
- **ui-proof-runner** (agent) — Browser smoke for ByteDesk.Web via bytedesk-browser-test (agent-browser).
- **workflow-runtime-verifier** (agent) — End-to-end Office workflow runtime proof — DB, /sources, harness, UI.
