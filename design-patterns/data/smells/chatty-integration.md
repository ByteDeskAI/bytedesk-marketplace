---
slug: chatty-integration
name: Chatty Integration
domain: integration-smell
category: Architecture Smells
groups:
  - architecture-smell
patterns:
  - document-message
  - request-reply
  - message-router
  - aggregator
references:
  - skills/integration-flow-review/references/implementation.md
  - skills/architecture-issue-scan/references/implementation.md
---

# Chatty Integration

## Symptom
A workflow performs many small cross-boundary calls where one coarse contract, document message, or asynchronous exchange would be clearer.

## Why It Matters
Latency, partial failure, retries, and version drift multiply across each call. Support teams see a call chain instead of a coherent business exchange.

## Pattern Responses
- Use Document Message for a self-contained exchange.
- Use Request-Reply when a bounded response is required.
- Use Aggregator when multiple replies must be recombined.

## False Positives
Fine-grained calls can be acceptable inside one deployment boundary with shared ownership and low latency.

## Checks
- Does one user action trigger several remote calls?
- Are retries safe and bounded at every hop?
- Can support reconstruct the business operation from traces?
