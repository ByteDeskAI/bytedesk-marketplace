---
name: structurizr-validator
description: Validate and lint workspaces.
when_to_use: Use for Structurizr DSL and C4 modeling tasks involving structurizr validator.
argument-hint: "[workspace-or-keyword]"
user-invocable: true
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash(structurizr *)
model: inherit
---

# Structurizr Validator

Use the bundled Structurizr reference catalog and CLI — never guess DSL syntax from memory.

## Deterministic workflow

1. Run `structurizr lookup <keyword>` before using unfamiliar syntax.
2. Run `structurizr lint <file.dsl>` after edits.
3. Run `structurizr validate <file.dsl>` when Structurizr CLI is installed.
4. Run `structurizr inspect <file.dsl>` for workspace inspections.

## References

- Keyword index: `data/keywords/`
- Expressions: `data/expressions/`
- Patterns: `data/patterns/`
- Cookbook: `data/cookbook/`
- C4 guidance: `data/c4/`
- Inspections: `data/inspections/types.yaml`

## Useful commands

```bash
structurizr lookup container
structurizr expressions element
structurizr pattern kubernetes
structurizr cookbook deployment-view
structurizr scaffold monolith
structurizr lint workspace.dsl
structurizr validate workspace.dsl
```
