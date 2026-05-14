# Provider Recommendation

## Best Fit
Provider Abstraction is the first option when provider selection leaks into domain code. It keeps the domain contract separate from provider SDKs and leaves provider selection in composition or policy code.

## Pattern Response
- Bridge separates abstraction from provider implementation.
- Strategy makes runtime selection explicit.
- Adapter protects the domain from provider SDK shape.
- Abstract Factory can keep compatible provider families together.

## Verification
- Adding a provider does not change domain workflows.
- Provider-specific errors are mapped consistently.
- Selection policy is deterministic and observable.
