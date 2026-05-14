# Pattern Context Pack

## Request
Build a context pack for duplicate delivery handling.

## Findings
The scanner should surface retry, duplicate delivery, or idempotency evidence when present.

## Recommended Moves
Use Idempotent Receiver, Guaranteed Delivery, Dead Letter Channel, and related playbooks before scaling consumers.

## Implementation Snippets
Include language-specific snippets such as the Python Idempotent Receiver when the language filter is Python.

## ADR Seed
Summarize the architecture decision and alternatives.

## Verification
Replay the same message twice, exhaust failure policy, and confirm recovery is observable.
