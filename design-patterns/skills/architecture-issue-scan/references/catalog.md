# Architecture Issue Scan Catalog Use

## Lookup Commands

```bash
patterns search "strategy" --scope object-design
patterns search "dead letter" --scope integration-design
patterns list operations-and-observability
patterns recommend "retries duplicate side effects and never stop"
patterns smells unbounded-retry
patterns playbooks message-replay-and-recovery
patterns scan ./src --pack integration --min-confidence 0.7 --json
patterns context ./src --query "retries duplicate side effects and never stop" --language python
patterns show adapter --language go
patterns show idempotent-receiver
```

## Finding-to-Domain Map

- repeated behavior branches -> `behavior-and-collaboration`;
- vendor coupling -> `object-structure`;
- tangled construction -> `object-construction`;
- async route decisions -> `message-routing`;
- schema conversion -> `message-transformation`;
- retry and duplicates -> `message-endpoint`;
- trace, replay, and support gaps -> `operations-and-observability`.

## Evidence Standards

Use catalog entries to support findings, but ground every finding in observed code, docs, or runtime behavior. If no evidence exists, report the item as a question or risk hypothesis.

Use `patterns context` when the scan findings should travel with recommended patterns, snippets, ADR seed text, and verification guidance. Use `patterns graph --query` when you need to explain which patterns mitigate a smell or which recipes implement a pattern.
