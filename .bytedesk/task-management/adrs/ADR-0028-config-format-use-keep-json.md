---
id: "ADR-0028"
kind: "adr"
status: "proposed"
created: "2026-09-30T20:31:40.728Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Config format: use Keep JSON"
epic: "EP-021"
decisionKey: "9c7f984b8b08"
date: "2026-09-30"
updated: "2026-09-30T20:31:40.735Z"
---

## Context

Captured from an AskUserQuestion during a Claude Code session on 2026-09-30.
The question asked was: The repo config today is JSON (`.bytedesk/agent-orchestration/config.json`), with no YAML parser in the plugin. How should the opt-out file work?

## Decision

**The repo config today is JSON (`.bytedesk/agent-orchestration/config.json`), with no YAML parser in the plugin. How should the opt-out file work?** → chose **Keep JSON**.

Rejected:
- **Accept both (Recommended)** — Read config.yaml as well as config.json for the whole repo layer, with YAML winning if both exist. Adds the `yaml` package, bundled into dist. Existing JSON configs keep working.
- **YAML only** — Move the repo layer to config.yaml and stop reading config.json. Needs a migration and breaks repos that already have a JSON config.

## Consequences

_TODO: what this makes easy, what it makes hard, and what would have to be true to revisit it._