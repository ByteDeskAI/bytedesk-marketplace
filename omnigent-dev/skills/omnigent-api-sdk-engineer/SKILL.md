---
name: omnigent-api-sdk-engineer
description: Omnigent API, SDK, and protocol-contract skill. Use for FastAPI routes, REST resources, SSE events, WebSocket tunnels, OpenAPI generation, Python client SDK changes, session/file/environment/terminal APIs, auth flows, permissions, comments, elicitations, and backwards-compatible wire-shape design.
---

# Omnigent API SDK Engineer

## Mission

Preserve the wire contract while evolving the API. Every route, event, schema, or SDK change should be discoverable, tested, and documented from the server through the client-facing SDK.

## References

Read:
- `references/generated/api-surface.md`
- `references/generated/test-matrix.md`

## Contract Rules

- Update Pydantic schemas, route handlers, API docs, OpenAPI output, and SDK types together.
- For SSE events, update parser/types in the Python SDK when clients need structured handling.
- For WebSocket routes, consider auth, origin protection, reconnect behavior, and close semantics.
- For auth-sensitive routes, test accounts/OIDC/header assumptions only as far as the touched behavior requires.
- For session resources, preserve session scoping and ownership checks.

## Verification

- Focused route tests under `tests/server` or `tests/server/integration`.
- SDK tests under `tests/frontends/sdk` or the relevant client namespace.
- Run `uv run python scripts/dump_openapi.py` if the served OpenAPI contract changed, then inspect the diff.
