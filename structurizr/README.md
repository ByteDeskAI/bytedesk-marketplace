# Structurizr Plugin

Claude Code / Codex / Grok marketplace plugin for enterprise C4 modeling with the [Structurizr DSL](https://docs.structurizr.com/dsl).

## Install

```bash
/plugin marketplace add ByteDeskAI/bytedesk-marketplace
/plugin install structurizr@bytedesk
```

Codex:

```bash
codex plugin marketplace add ByteDeskAI/bytedesk-marketplace
codex plugin install structurizr@bytedesk
```

Local dev from this checkout:

```bash
claude plugin marketplace add .
claude plugin install structurizr@bytedesk
```

## What is included

- **32 skills** for C4 modeling, DSL authoring, views, deployment, validation, patterns, and enterprise governance
- **12 slash commands** (`/structurizr-*`)
- **Indexed reference data** — 30 DSL keywords, expressions, inspections, 11 patterns, 22 cookbook recipes
- **`structurizr` CLI** — lookup, lint, scaffold, validate/inspect/export (when official CLI installed)
- **MCP server** — `structurizr_lookup`, `structurizr_lint`, `structurizr_validate`, and more

## CLI quick start

```bash
structurizr doctor
structurizr lookup container
structurizr expressions element
structurizr pattern kubernetes
structurizr cookbook deployment-view
structurizr scaffold minimal -o workspace.dsl
structurizr lint workspace.dsl
structurizr validate workspace.dsl   # requires Structurizr CLI
```

## Deterministic workflow for agents

1. `structurizr lookup <keyword>` before unfamiliar syntax
2. Edit `workspace.dsl`
3. `structurizr lint workspace.dsl`
4. `structurizr validate` + `structurizr inspect` when Structurizr CLI is available

## Optional: Structurizr CLI

Install from https://github.com/structurizr/cli for `validate`, `inspect`, `export`, `list`, `push`, `pull`.

Without it, `lookup`, `lint`, `scaffold`, and MCP tools still work.

## Regenerate reference index

```bash
python3 scripts/generate-index.py
```

## License

MIT