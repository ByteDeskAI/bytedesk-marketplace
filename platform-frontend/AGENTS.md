# Platform Frontend

ByteDesk Web design system, atomize, browser smoke gate, SignalR realtime.

This plugin works across Claude Code, Codex, and grok-cli. Claude Code loads it via `.claude-plugin/plugin.json`; Codex via `.codex-plugin/plugin.json`; grok-cli and other AGENTS.md-aware agents read this file.

## Skills & commands

- **bytedesk-atomize** (skill) — ByteDesk UI componentization skill using atomic design.
- **bytedesk-browser-test** (skill) — Drive the ByteDesk web app through real Chrome via the `agent-browser` CLI to prove frontend changes actually render and behave correctly before they ship.
- **bytedesk-design** (skill) — ByteDesk design system expert and source of frontend design truth.
- **bytedesk-realtime-engineer** (skill) — ByteDesk browser realtime engineer for SignalR and ByteDesk.Realtime.
