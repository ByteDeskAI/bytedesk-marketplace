# Bytedesk Goals

ByteDesk goal pipeline — goals board, run_goals, plan_goal/plan_epic, Jira/Confluence skills, named-agent dispatch.

This plugin works across Claude Code, Codex, and grok-cli. Claude Code loads it via `.claude-plugin/plugin.json`; Codex via `.codex-plugin/plugin.json`; grok-cli and other AGENTS.md-aware agents read this file.

## Skills & commands

- **bytedesk-confluence** (skill) — ByteDesk Confluence knowledge operations.
- **bytedesk-jira-task** (skill) — Full Jira task lifecycle manager for the ByteDesk Platform (BDP) project.
- **bytedesk-skill-sync** (skill) — Keep Codex/Grok skill state (.agents/skills) in parity with the canonical Claude skills (.claude/skills).
- **goals** (skill) — Front-door administrator for the goal pipeline.
- **plan_epic** (skill) — Plan a multi-task initiative as a Jira Epic whose child Tasks are each a runnable goal.
- **plan_goal** (skill) — Run a planning session that turns a fuzzy intent into a self-contained, goal-based spec saved at docs/goals/<theme>.md, then exits plan mode by handing off a runnable `/goal docs/goals/<theme>.md`.
- **run_goals** (skill) — Execute goal batches through run-goals — validate manifests, then drain the plan sequentially inline via /goal handoffs (exit 2 until each goal completes).
