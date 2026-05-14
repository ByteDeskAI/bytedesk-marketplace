# Architecture Issue Scan Examples

## Object-Design Finding

```text
[P2] PaymentService selects behavior with repeated payment-method branches.
The same branch set appears in validation, fee calculation, and settlement. This makes adding a payment method error-prone. Strategy would isolate each payment method's behavior, while a resolver keeps selection in one place. Start by extracting fee calculation first and add resolver tests.
```

## Integration Finding

```text
[P1] OrderCreated consumers retry without idempotency checks.
The flow assumes retries are rare, but at-least-once delivery can duplicate side effects. Add Idempotent Receiver using a stable order event key, then route exhausted failures to a Dead Letter Channel. Test duplicate delivery and replay.
```

## No-Pattern Finding

```text
No pattern is needed yet for this two-branch formatter.
The variation is small and local. A named helper or function map is clearer than introducing Strategy classes. Revisit if more formatters arrive or callers start depending on formatter construction.
```

