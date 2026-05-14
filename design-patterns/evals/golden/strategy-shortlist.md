# Pricing Variation Shortlist

## Best Fit
Strategy is the best fit when pricing behavior varies by customer type and market while keeping the same input and output shape.

## Alternatives
- State fits only if pricing behavior changes by lifecycle state.
- A function map is simpler when variants are small and first-class functions are idiomatic.
- A table-driven rule set is better when behavior is mostly data.

## Do Not Use Yet
Do not introduce Strategy if there are only one or two trivial branches, if strategies need too much host object state, or if a simple function parameter communicates the variation better.

## Verification
- Add behavior tests for each pricing variant.
- Add selection tests for customer type and market.
- Preserve existing outputs with parity tests before removing conditionals.
