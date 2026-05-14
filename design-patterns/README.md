# Design Pattern References

Claude Code and Codex plugin marketplace for reusable design-pattern guidance.

This repository is intended to be hosted at `ByteDeskAI/design-pattern-references` and added to Claude Code as a marketplace:

```bash
claude plugin marketplace add ByteDeskAI/design-pattern-references
claude plugin install design-patterns@bytedesk-design-patterns
```

It can also be added to Codex as a marketplace:

```bash
codex plugin marketplace add ByteDeskAI/design-pattern-references
```

For local development from this checkout:

```bash
claude plugin validate .
claude plugin marketplace add .
claude plugin install design-patterns@bytedesk-design-patterns
codex plugin marketplace add .
```

## What Is Included

- A Claude Code marketplace manifest at `.claude-plugin/marketplace.json`.
- A Codex marketplace manifest at `.agents/plugins/marketplace.json`.
- One installable plugin at `plugins/design-patterns`.
- A source-neutral Markdown catalog of reusable design patterns.
- Pattern domains for object design, integration design, messaging, transformation, endpoints, operations, construction, structure, and collaboration.
- Architecture playbooks for recurring pattern combinations.
- Architecture smells for detecting design risks before recommending patterns.
- Framework implementation packs for concrete stack guidance.
- Pattern application recipes for safe refactor steps.
- Decision scorecards for comparing architectural options.
- Architecture force taxonomy, synonym expansion, and language-specific implementation snippets.
- A generated searchable static catalog site inside the plugin bundle.
- A Python-backed dynamic catalog workbench exposed by the plugin CLI.
- A stdio MCP server for tools that can call pattern recommendations, scans, context packs, ADRs, graph queries, simulations, and migrations.
- Language profiles for C#, Java, TypeScript, Python, Go, Rust, and C++.
- A bundled `patterns` CLI that Claude Code and Codex can use after the plugin is installed.

## Plugin Capability

After installation, Claude Code or Codex can use the `design-patterns` plugin when the user asks for pattern selection, architecture tradeoffs, refactoring guidance, or language-specific implementation approaches.

The plugin contributes:

- `skills/pattern-advisor/SKILL.md`: general model-invoked pattern guidance.
- `skills/pattern-finder/SKILL.md`: discover and compare candidate patterns from a problem statement.
- `skills/architecture-decision/SKILL.md`: produce ADR-style pattern decisions, tradeoffs, consequences, and verification plans.
- `skills/architecture-issue-scan/SKILL.md`: find design and integration issues in code or architecture notes.
- `skills/pattern-application/SKILL.md`: plan and apply a pattern-oriented refactor safely.
- `skills/integration-flow-review/SKILL.md`: review message-driven and integration flows.
- `agents/pattern-architect.md`: deeper architecture and design-review agent.
- `bin/patterns`: local catalog lookup, architecture scan, ADR, graph, context-pack, decision-simulation, migration, MCP, and dynamic workbench helper.
- `.mcp.json`: Claude plugin MCP config that resolves from the installed plugin root.
- `.codex-mcp.json`: Codex plugin MCP config that resolves from the installed plugin root.
- root `.mcp.json`: project-scoped Claude MCP config so this repository shows `design-patterns` connected when opened as a Claude project.
- `data/patterns/*.md`: canonical Markdown pattern entries.
- `data/playbooks/*.md`: source-neutral pattern-composition playbooks.
- `data/smells/*.md`: source-neutral architecture smells and pattern responses.
- `data/frameworks/*.md`: stack-specific implementation packs.
- `data/recipes/*.md`: pattern application recipes.
- `data/scorecards/*.md`: architecture decision scorecards.
- `data/snippets/**/*.md`: language-specific implementation snippets.
- `data/taxonomy/*.md`: force and synonym maps used by recommendation intelligence.
- `data/languages/*.md`: canonical Markdown language profiles.
- `site/index.html`: generated searchable catalog site packaged inside the plugin.
- `docs/classic-object-pattern-coverage.md`: source-neutral coverage audit for the classic 23 object-design patterns and Python language support.
- `skills/*/references/{usages,examples,implementation,catalog}.md`: detailed skill documentation loaded on demand.
- `commands/patterns-*.md`: Claude slash-command wrappers for copyable MCP-backed requests such as `/patterns-recommend`, `/patterns-scan`, and `/patterns-context`; each command supports `help`.

Each skill declares fully qualified skill frontmatter: `name`, `description`, `when_to_use`, `argument-hint`, invocation controls, conservative `allowed-tools`, and `model: inherit`. Slash commands and agents also expose `argument-hint` frontmatter where supported, and every MCP tool input property includes a description so clients can show argument helpers. MCP tools infer safe optional arguments from request text, project paths, and codebase markers, then return structured missing-argument detail when required intent cannot be inferred.

## Catalog Model

The catalog is intentionally source-neutral. Patterns are organized by domain, category, group, and language applicability rather than by origin. New patterns can be added from any useful tradition, codebase, architecture review, or language ecosystem by adding a Markdown file under `plugins/design-patterns/data/patterns`.

Each pattern file uses frontmatter for machine filtering and Markdown sections for Claude-readable guidance. Pattern entries include decision metadata such as quality attributes, tradeoffs, failure modes, testing focus, observability focus, typed relationships, and implementation notes:

```text
---
slug: strategy
name: Strategy
domain: behavior-and-collaboration
category: Behavior and Collaboration
groups:
  - object-design
languages:
  - csharp
  - typescript
related:
  - state
relationships:
  - alternative:state
references:
  - skills/pattern-advisor/references/implementation.md
---

# Strategy

## Intent
...
```

Use the CLI to inspect the catalog:

```bash
plugins/design-patterns/bin/patterns domains
plugins/design-patterns/bin/patterns list object-design --language typescript
plugins/design-patterns/bin/patterns search router --scope integration-design --language typescript
plugins/design-patterns/bin/patterns recommend "duplicate delivery repeats side effects" --scope integration-design --language csharp
plugins/design-patterns/bin/patterns recommend "provider selection leaks into domain code" --risk operability --explain
plugins/design-patterns/bin/patterns compare strategy state template-method
plugins/design-patterns/bin/patterns adr "duplicate delivery repeats side effects"
plugins/design-patterns/bin/patterns graph --format mermaid
plugins/design-patterns/bin/patterns graph --query "what mitigates naive exactly once" --json
plugins/design-patterns/bin/patterns explain strategy
plugins/design-patterns/bin/patterns why "provider selection leaks into domain code"
plugins/design-patterns/bin/patterns scan ./src --pack integration --min-confidence 0.7 --json
plugins/design-patterns/bin/patterns context ./src --query "messages can redeliver" --language python
plugins/design-patterns/bin/patterns simulate "duplicate delivery repeats side effects" --language python
plugins/design-patterns/bin/patterns migrate provider-switch-sprawl --to bridge
plugins/design-patterns/bin/patterns snippets idempotent-receiver --language python
plugins/design-patterns/bin/patterns mcp
plugins/design-patterns/bin/patterns serve --port 8766
plugins/design-patterns/bin/patterns playbooks event-fanout
plugins/design-patterns/bin/patterns smells naive-exactly-once
plugins/design-patterns/bin/patterns frameworks dotnet-masstransit
plugins/design-patterns/bin/patterns recipes strategy-refactor
plugins/design-patterns/bin/patterns scorecards standard-architecture-decision
plugins/design-patterns/bin/patterns show strategy --language csharp
plugins/design-patterns/bin/patterns languages go
```

## Architecture Guidance Model

The plugin now supports three layers of guidance:

- Patterns: individual reusable design responses.
- Playbooks: source-neutral combinations of patterns for recurring architecture situations.
- Smells: detectable design risks with pattern or no-pattern responses.
- Framework packs: stack-specific implementation, testing, and operations guidance.
- Recipes: step-by-step refactor and hardening paths.
- Scorecards: consistent architecture decision criteria.
- Taxonomy: architecture-force and synonym maps that improve matching.
- Snippets: small language-specific implementation references tied to catalog patterns.

Skills should use the catalog progressively: detect smells, select patterns or playbooks, compare alternatives, then produce decision-ready output with consequences, tests, observability, and rollback signals.

The CLI can also generate ADR-style decision drafts, export and query the typed catalog graph, explain catalog entries, explain why recommendations matched, scan a repository for pattern-relevant architecture smells, build context packs, score options through a decision simulation, produce migration plans, list snippets, and run a stdio MCP server.

## Slash Command Examples

For user-facing MCP requests, prefer the plugin slash commands. Ask for `/patterns-examples` to get the full copyable list.

```text
/patterns-help
/patterns-scan help
/patterns-recommend "add a new SCM provider without changing rule execution code" --limit 5
/patterns-scan backend/app/workflow_engine --min-confidence 0.45
/patterns-context backend/app/providers/ai --query "adding a new AI provider safely"
/patterns-simulate "Strategy vs Chain of Responsibility for AI provider failover" --risk operability
/patterns-migrate "hardcoded if/elif provider selection" --to strategy
/patterns-snippets strategy,idempotent-receiver
/patterns-adr "durable event storage for SSE replay: Redis vs PostgreSQL"
/patterns-graph "what patterns mitigate naive exactly once"
```

Omit `--language` and `--scope` unless you want to override inference. The plugin infers both from prompt terms, command paths, stack markers, and nearby project files. The MCP server also exposes `patterns_examples` and `patterns_help`; they return these slash commands, help forms, corresponding MCP tool names, inferred-context behavior, and JSON arguments for agents that inspect schemas before answering.

## MCP Auto-Start

The repository includes three MCP configurations:

- [plugins/design-patterns/.mcp.json](/Users/kon1790/GitHub/design-pattern-reference/plugins/design-patterns/.mcp.json): packaged with the Claude plugin. It starts `design-patterns` through `${CLAUDE_PLUGIN_ROOT}/bin/patterns-mcp`, so global and project installs launch from the actual installed plugin directory.
- [plugins/design-patterns/.codex-mcp.json](/Users/kon1790/GitHub/design-pattern-reference/plugins/design-patterns/.codex-mcp.json): packaged with the Codex plugin. It uses the same install-root-aware launcher with Codex plugin-relative paths.
- [.mcp.json](/Users/kon1790/GitHub/design-pattern-reference/.mcp.json): project-scoped config for this repository checkout. Opening Claude in this project should show `design-patterns` as connected automatically.

Claude verification:

```bash
claude mcp get design-patterns
claude mcp list
```

Codex compatibility is declared through `plugins/design-patterns/.codex-plugin/plugin.json` with `mcpServers: "./.codex-mcp.json"`, while the repository root `.mcp.json` remains project-scoped for local Claude development.

## Dynamic Catalog Workbench

Run the Python-backed catalog app locally:

```bash
plugins/design-patterns/bin/patterns serve --port 8766
```

Open `http://127.0.0.1:8766/`.

The workbench is backed by live Markdown catalog data and includes:

- full-text search across patterns, playbooks, smells, frameworks, recipes, scorecards, and languages;
- kind, domain, group, language, and quality filters;
- entry detail inspection with forces, tradeoffs, tests, observability, and related tags;
- compare tray for selected entries;
- scenario radar recommendations with matched terms and decision paths;
- paste-in architecture scan for smell detection and pattern responses;
- ADR draft generation from a decision prompt;
- implementation brief generation from selected entries or compare sets;
- relationship graph view plus API support for graph questions;
- coverage matrix for languages, quality attributes, domains, risk, and complexity;
- API endpoints for context packs, decision simulations, migration plans, and snippets;
- Python and classic object-pattern coverage checks.

## Validation

Run the local validation script:

```bash
python3 scripts/validate_catalog.py
```

Regenerate the static catalog site after catalog changes:

```bash
python3 scripts/generate_site.py
```

If Claude Code is installed, also run:

```bash
claude plugin validate .
```

Codex marketplace metadata is validated by `scripts/validate_catalog.py`.

Unit tests cover the catalog loader and CLI behavior:

```bash
python3 -m unittest
```

Golden eval checks verify expected architecture-output sections and terms:

```bash
python3 scripts/run_evals.py
```

## Repository Layout

```text
.
├── .claude-plugin/
│   └── marketplace.json
├── .agents/
│   └── plugins/marketplace.json
├── plugins/
│   └── design-patterns/
│       ├── .codex-mcp.json
│       ├── .mcp.json
│       ├── .claude-plugin/plugin.json
│       ├── .codex-plugin/plugin.json
│       ├── agents/pattern-architect.md
│       ├── bin/patterns
│       ├── commands/patterns-*.md
│       ├── data/
│       │   ├── languages/*.md
│       │   ├── patterns/*.md
│       │   ├── playbooks/*.md
│       │   ├── smells/*.md
│       │   ├── frameworks/*.md
│       │   ├── recipes/*.md
│       │   ├── scorecards/*.md
│       │   ├── snippets/**/*.md
│       │   └── taxonomy/*.md
│       ├── lib/pattern_catalog.py
│       ├── lib/pattern_context.py
│       ├── lib/pattern_graph.py
│       ├── lib/pattern_intelligence.py
│       ├── lib/pattern_mcp_server.py
│       ├── lib/pattern_scanner.py
│       ├── lib/pattern_workbench.py
│       ├── lib/workbench_api.py
│       ├── lib/workbench_assets.py
│       ├── lib/workbench_views.py
│       ├── site/index.html
│       └── skills/
│           ├── architecture-decision/SKILL.md
│           ├── architecture-issue-scan/SKILL.md
│           ├── integration-flow-review/SKILL.md
│           ├── pattern-advisor/SKILL.md
│           ├── pattern-application/SKILL.md
│           └── pattern-finder/SKILL.md
├── docs/catalog-authoring.md
├── docs/classic-object-pattern-coverage.md
└── scripts/
    ├── generate_site.py
    ├── run_evals.py
    └── validate_catalog.py
```

## Versioning

The marketplace and plugin versions move together. Bump both versions when publishing catalog or capability changes that users should receive through marketplace updates.
