# Catalog Authoring Guide

The design-pattern plugin is source-neutral. Add catalog entries because they help architecture decisions, not because they come from a particular book, site, vendor, or framework.

## Pattern Files

Pattern files live in `plugins/design-patterns/data/patterns/*.md`.

Required frontmatter:

- `slug`
- `name`
- `domain`
- `category`
- `groups`
- `languages`
- `qualityAttributes`
- `implementationComplexity`
- `operationalRisk`
- `tradeoffs`
- `failureModes`
- `testingFocus`
- `observabilityFocus`
- `related`
- `relationships`
- `references`

Required sections:

- `Intent`
- `When To Use`
- `Avoid When`
- `Forces`
- `Tradeoffs`
- `Failure Modes`
- `Testing`
- `Observability`
- `Implementation Notes`

Use typed relationships in `type:slug` format. Supported examples include `alternative`, `companion`, `often-confused-with`, `requires`, `enables`, and `mitigates`.

## Playbooks

Playbooks live in `plugins/design-patterns/data/playbooks/*.md`. Use playbooks when the answer should recommend a coherent pattern set rather than a single pattern.

Required sections:

- `Intent`
- `When To Use`
- `Avoid When`
- `Pattern Set`
- `Implementation Steps`
- `Verification`

## Smells

Smells live in `plugins/design-patterns/data/smells/*.md`. Use smells to detect architectural risk before prescribing a pattern.

Required sections:

- `Symptom`
- `Why It Matters`
- `Pattern Responses`
- `False Positives`
- `Checks`

## Recipes

Recipes live in `plugins/design-patterns/data/recipes/*.md`. Use recipes for step-by-step pattern application.

Required sections:

- `Goal`
- `Preconditions`
- `Steps`
- `Tests`
- `Rollback`

## Framework Packs

Framework packs live in `plugins/design-patterns/data/frameworks/*.md`. Use these for stack-specific implementation details.

Required sections:

- `Best For`
- `Pattern Mapping`
- `Implementation Notes`
- `Testing Guidance`
- `Operational Guidance`

## Scorecards

Scorecards live in `plugins/design-patterns/data/scorecards/*.md`. Use these when comparing architecture options.

Required sections:

- `Intent`
- `Scale`
- `Criteria`
- `Output Contract`
- `Anti-Patterns`

## Validation

Run these before committing:

```bash
python3 scripts/validate_catalog.py
python3 -m unittest discover
python3 scripts/run_evals.py
python3 scripts/generate_site.py
plugins/design-patterns/bin/patterns serve --help
```

## Dynamic Workbench

The browser workbench is a plugin capability, not a separate local-only site. Its implementation lives in `plugins/design-patterns/lib/pattern_workbench.py` and is launched through `plugins/design-patterns/bin/patterns serve`.

The static generator also writes into the plugin bundle at `plugins/design-patterns/site`. When adding new catalog fields, update both the static generator and the dynamic workbench API if the field should be searchable, filterable, displayed in details, included in scenario recommendations, surfaced by paste-in architecture scans, used by implementation briefs, or included in ADR, matrix, and graph workflows.
