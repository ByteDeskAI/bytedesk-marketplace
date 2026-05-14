---
slug: architecture-forces
name: Architecture Forces
groups:
  - taxonomy
---

# Architecture Forces

## Variation Point
- provider selection
- pricing variation
- branching behavior
- interchangeable implementation
- strategy selection
- market-specific logic
- customer-type logic

## Boundary Mismatch
- vendor sdk leak
- external contract mismatch
- legacy interface
- adapter boundary
- anti-corruption boundary
- protocol translation

## Duplicate Delivery
- duplicate message
- redelivery
- repeated side effect
- exactly once
- idempotency
- replay

## Fanout And Decoupling
- many consumers
- downstream subscribers
- producer knows consumers
- event notification
- independent reaction

## Routing Control
- destination selection
- route by header
- dynamic destination
- tenant routing
- hidden router

## Stateful Workflow
- lifecycle state
- workflow transition
- long-running process
- compensation
- checkpoint

## Operational Recovery
- dead letter
- poison message
- retry exhaustion
- replay procedure
- support visibility
- terminal failure
