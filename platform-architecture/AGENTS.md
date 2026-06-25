# Platform Architecture

Structurizr C4 drift gate, partition decomposition facade, ADR authoring.

This plugin works across Claude Code, Codex, and grok-cli. Claude Code loads it via `.claude-plugin/plugin.json`; Codex via `.codex-plugin/plugin.json`; grok-cli and other AGENTS.md-aware agents read this file.

## Skills & commands

- **bytedesk-adr** (skill) — Architecture Decision Record (ADR) creation for the ByteDesk Platform.
- **bytedesk-architecture-decompose** (skill) — Application decomposition → Structurizr C4 modeling orchestrator.
- **bytedesk-architecture-sync** (skill) — Structurizr C4 drift gate for ByteDesk Platform.
