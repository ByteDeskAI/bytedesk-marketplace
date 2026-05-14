# Catalog Usage

Start broad, then narrow by force:

```bash
patterns domains
patterns search "duplicate delivery" --scope integration-design
patterns search "algorithm selection" --scope object-design
patterns recommend "messages can be delivered twice and consumers write side effects" --scope integration-design
patterns compare idempotent-receiver transactional-client dead-letter-channel
patterns playbooks event-fanout
patterns smells naive-exactly-once
patterns frameworks dotnet-masstransit
patterns recipes idempotent-receiver-recipe
patterns scorecards standard-architecture-decision
patterns adr "duplicate delivery repeats side effects"
patterns simulate "duplicate delivery repeats side effects" --language csharp
patterns graph --format mermaid
patterns graph --query "what mitigates naive exactly once"
patterns show strategy --language typescript
patterns show content-based-router --language csharp
```

## Decision Mapping

- Runtime algorithm choice -> `strategy`, `state`, `command`, or a language-level function map.
- Product-family construction -> `abstract-factory`, `factory-method`, `builder`, or direct construction.
- Boundary mismatch -> `adapter`, `facade`, `bridge`, `messaging-gateway`, or `channel-adapter`.
- Async decoupling -> `message`, `message-channel`, `event-message`, `command-message`, or `publish-subscribe-channel`.
- Duplicate side effects -> `idempotent-receiver`, often with `guaranteed-delivery` and `dead-letter-channel`.
- Routing autonomy -> `message-router`, `content-based-router`, `recipient-list`, or `routing-slip`.
- Support visibility -> `correlation-identifier`, `message-history`, `wire-tap`, `message-store`, or `control-bus`.

Use `patterns simulate` when alternatives need scorecard-backed comparison. Use `patterns show <slug> --json` when you need machine-readable references and related patterns. Use the Markdown files directly when you need the full body text, examples, snippets, or implementation notes.
