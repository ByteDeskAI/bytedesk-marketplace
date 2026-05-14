# Pattern Finder Examples

## Behavior Variation

User:

```text
We have an if/else chain selecting fraud checks by payment method.
```

Response:

```text
Primary: Strategy. The force is interchangeable behavior with the same input and output shape.
Backup: Chain of Responsibility if several checks can run in order and each may accept, reject, or pass.
Simpler option: a typed function map if there are only a few checks and no shared lifecycle.
```

## Construction Variation

User:

```text
Each tenant needs a matching API client, serializer, and validator.
```

Response:

```text
Primary: Abstract Factory. The objects vary as a compatible family.
Backup: Factory Method if only one product varies.
Simpler option: DI registration per tenant if the framework already owns the selection cleanly.
```

## Integration Routing

User:

```text
Messages need to go to different queues depending on region and product.
```

Response:

```text
Primary: Content-Based Router. The destination is derived from message content.
Backup: Recipient List if one message can go to multiple computed destinations.
Operational companions: Correlation Identifier, Dead Letter Channel, and Idempotent Receiver.
```

