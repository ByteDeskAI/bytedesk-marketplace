# Pattern Application Catalog Use

## Lookup Workflow

```bash
patterns show strategy --language typescript
patterns show adapter --language csharp
patterns show idempotent-receiver
patterns search "duplicate" --scope integration-design
patterns playbooks variation-point-refactor
patterns smells conditional-sprawl
patterns recipes strategy-refactor
patterns frameworks typescript-nestjs-kafkajs
patterns compare strategy template-method state
patterns migrate provider-switch-sprawl --to bridge
patterns snippets strategy --language csharp
patterns context ./src --query "pricing branches vary by customer and market" --language typescript
patterns languages rust
```

## Applying Catalog Fields

- Use `intent` as the refactor thesis.
- Use `whenToUse` as evidence that the pattern fits.
- Use `avoidWhen` as a pre-implementation safety check.
- Use `languageNotes` to pick idiomatic implementation shape.
- Use `related` to identify alternatives before committing to a design.
- Use `relationships` to separate alternatives from companion patterns.
- Use playbooks when a refactor needs several patterns in sequence.
- Use smells to keep the implementation tied to the risk being removed.
- Use `references` to load deeper skill-specific implementation guidance.
- Use recipes, `patterns migrate`, and snippets to turn the pattern recommendation into safe refactor steps.

## Minimum Implementation Bar

A pattern application should produce:

- clearer ownership;
- reduced branching or coupling;
- testable seams;
- preserved behavior;
- explicit failure handling for integration patterns.
