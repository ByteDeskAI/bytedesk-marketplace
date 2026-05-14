---
slug: god-service
name: God Service
domain: object-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - strategy
  - mediator
  - facade
  - command
references:
  - skills/architecture-issue-scan/references/implementation.md
  - skills/pattern-application/references/implementation.md
---

# God Service

## Symptom
One service coordinates unrelated responsibilities, owns too much state, and becomes the default place for new behavior.

## Why It Matters
Change risk rises because unrelated behaviors share dependencies, tests, and lifecycle assumptions.

## Pattern Responses
- Use Strategy for isolated behavior variation.
- Use Command for explicit operations.
- Use Mediator only when collaboration coordination is the real force.
- Use Facade when callers need a simpler entry point but responsibilities remain elsewhere.

## False Positives
A small application service can be fine when it orchestrates a narrow use case and delegates real work.

## Checks
- Do unrelated features change the same file?
- Are dependencies used by only one method group?
- Can responsibilities be named as separate domain capabilities?
