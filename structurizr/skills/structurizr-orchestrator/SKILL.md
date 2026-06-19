---
name: structurizr-orchestrator
description: Front door for Structurizr/C4 modeling — routes to specialist skills and enforces validate/lint gates.
when_to_use: Use when starting any Structurizr DSL or C4 modeling task, reviewing architecture diagrams, or unsure which Structurizr skill to invoke.
argument-hint: "[intent-or-workspace-path]"
user-invocable: true
disable-model-invocation: false
allowed-tools: Read Grep Glob Bash(structurizr *)
model: inherit
---

# Structurizr Orchestrator

Route Structurizr work to the right specialist skill. Never guess DSL syntax.

## Route map

| User intent | Skill |
|---|---|
| New workspace / bootstrap | `structurizr-workspace-scaffold` |
| C4 level / abstraction question | `c4-model-architect` |
| Add people, systems, externals | `structurizr-model-builder` |
| Containers & components | `structurizr-container-component-designer` |
| Relationships & archetypes | `structurizr-relationship-designer` |
| Static diagrams | `structurizr-view-composer` |
| Sequence / interaction flows | `structurizr-dynamic-view-author` |
| K8s / infra deployment | `structurizr-deployment-modeler` |
| DSL syntax lookup | `structurizr-dsl-language-reference` |
| include/exclude expressions | `structurizr-expression-builder` |
| K8s, microservice, AWS patterns | `structurizr-pattern-catalog` |
| Step-by-step recipes | `structurizr-cookbook-executor` |
| Pre-PR review | `structurizr-consistency-reviewer` |
| Validate / lint | `structurizr-validator` |

## Mandatory gate (every session)

```bash
structurizr lookup <keyword>    # before unfamiliar syntax
structurizr lint workspace.dsl  # after every edit
structurizr validate workspace.dsl  # when Structurizr CLI installed
structurizr inspect workspace.dsl   # optional quality gate
```

## Completion criteria

- DSL parses per `structurizr lint` (zero errors)
- View keys are explicit (not auto-generated)
- `!identifiers hierarchical` for multi-system workspaces
- Containers/components have technology tags in enterprise models