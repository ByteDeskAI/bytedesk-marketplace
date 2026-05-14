# Pattern Application Examples

## Strategy Refactor

Prompt:

```text
Apply Strategy to this TypeScript pricing switch.
```

Implementation outline:

```text
Create a `PricingStrategy` function type, move each branch into a named strategy, and keep selection in one small resolver. Tests should cover each strategy and the resolver's mapping. Do not introduce abstract base classes.
```

## Adapter Refactor

Prompt:

```text
Wrap this vendor SDK so the domain does not depend on it.
```

Implementation outline:

```text
Define a local interface in the consuming boundary, implement a vendor adapter in infrastructure, map vendor errors into local failures, and test the adapter with SDK fakes or contract tests.
```

## Idempotent Receiver Refactor

Prompt:

```text
Make this message consumer safe under retries.
```

Implementation outline:

```text
Choose a stable message or business key, persist processed status with retention policy, make side effects conditional on first processing, and test duplicate delivery plus partial-failure retry.
```

