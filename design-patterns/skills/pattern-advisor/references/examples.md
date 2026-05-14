# Pattern Advisor Examples

## Selection Prompt

User:

```text
We have several pricing algorithms selected by tenant and product line in TypeScript. Which pattern fits?
```

Good response shape:

```text
Use Strategy as a typed map of pricing functions or classes. The force is algorithm variability, not object creation. Keep the tenant/product selector separate from the pricing implementation so tests can exercise selection and calculation independently.

Alternatives: State if behavior changes because of lifecycle, not product type; Factory Method if the main variation is construction rather than calculation.
```

## Overuse Prompt

User:

```text
Should I use Abstract Factory for two email templates?
```

Good response shape:

```text
Probably not yet. Two templates are usually better represented by named functions, configuration, or a small renderer map. Abstract Factory becomes useful only when you create multiple compatible products as a family, such as templates plus validators plus tracking adapters per provider.
```

## Integration Prompt

User:

```text
Orders publish events to five downstream services. Some are optional. What patterns matter?
```

Good response shape:

```text
Start with publish-subscribe channel plus event message. If recipients vary per order type, use recipient list or content-based router downstream from the publisher. Add correlation identifier, idempotent receiver, and dead-letter channel as operational baseline.
```

## Language Prompt

User:

```text
How would Decorator look in Go?
```

Good response shape:

```text
In Go, Decorator is usually an interface wrapper or handler middleware. Keep the interface tiny, wrap one behavior at a time, and make wrapper order explicit in construction code.
```

