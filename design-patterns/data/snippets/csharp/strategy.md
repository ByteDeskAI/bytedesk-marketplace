---
slug: csharp-strategy
name: C# Strategy Boundary
language: csharp
patterns:
  - strategy
---

# C# Strategy Boundary

## Use
- Keep the selection policy near the application boundary.
- Keep each strategy focused on one behavior variant.
- Test selection separately from each strategy implementation.

## Example
```csharp
public interface IPricingPolicy
{
    Money Price(PricingContext context);
}

public sealed class EnterprisePricingPolicy : IPricingPolicy
{
    public Money Price(PricingContext context) => context.BasePrice.ApplyDiscount(context.ContractDiscount);
}

public sealed class PricingPolicySelector
{
    private readonly IReadOnlyDictionary<CustomerSegment, IPricingPolicy> _policies;

    public PricingPolicySelector(IEnumerable<IPricingPolicy> policies)
    {
        _policies = policies.ToDictionary(policy => policy.Segment);
    }

    public IPricingPolicy For(CustomerSegment segment) => _policies[segment];
}
```

## Tests
- Each policy has behavior tests for its business rule.
- The selector has table-driven tests for segment-to-policy mapping.
- Existing branch outputs are preserved with parity tests during migration.
