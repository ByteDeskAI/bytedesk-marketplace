---
name: bytedesk-architecture-decompose
description: >-
  Application decomposition → Structurizr C4 modeling orchestrator. Use for
  partition-scoped codebase analysis (C1–C3), incremental diagram growth,
  ADR-constrained modeling, and indexed progress across iterations. Uses
  graphify + architecture-sync for platform work.
user-invokable: true
argument-hint: "partition <name> [--max-iterations N] | status | resume"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
---

## Mission

Turn a code partition into validated Structurizr DSL incrementally. This is the
**planning/analysis** path — distinct from the **drift gate**
(`bytedesk-architecture-sync`) which keeps diagrams aligned per commit.

## When to use

- New service or major boundary change needs C2/C3 modeling before implementation.
- Epic asks to "decompose" a domain (Sales pipeline, Office workflows, DevProjects).
- After `/bytedesk-architect` flags missing C4 coverage.

## Procedure

### 1. Choose partition

```bash
# List partitions from anchors
grep -E '^  [a-z]' docs/architecture/anchors.yaml | head -20
node scripts/dev/workflow.mjs graph explain "<partition concept>"  # optional
```

### 2. Iteration loop (default max 3 unless user sets higher)

Per iteration:

1. **Evidence** — read partition globs; use `graphify-out/` wiki or
   `workflow.mjs graph query` for cross-module edges.
2. **ADR constraints** — read matching `docs/architecture/adr/*.md`; note
   superseded decisions for architect follow-up.
3. **Model** — edit the minimal Structurizr DSL fragment or partition section.
4. **Validate** — `architecture-sync --mode audit`.
5. **Record** — append progress note to Jira task or goal doc; stage DSL if green.

Stop when: validator clean, audit passes, and partition containers match code
boundaries within stated iteration budget.

### 3. Promotion

Decomposition output lands in `docs/architecture/workspace.dsl` or
`docs/architecture/fragments/<partition>.dsl` — never committed scratch under
`fragments/.scratch/` (gitignored).

## Integration with development workflow

| Phase | Agent / skill |
|---|---|
| Epic planning | Goal Orchestrator + Architecture Modeler |
| Per-feature commit | Platform Builder + `bytedesk-architecture-sync` |
| PR | Integration Reviewer + architecture-sync audit |