# Omnigent Deploy and Sandbox Map

Generated from `deploy/` and deployment docs.

## Deploy Targets
- `deploy/bytedesk/`
- `deploy/cwsandbox/`
- `deploy/daytona/`
- `deploy/docker/`
- `deploy/e2b/`
- `deploy/fly/`
- `deploy/hf-spaces/`
- `deploy/islo/`
- `deploy/kubernetes/`
- `deploy/modal/`
- `deploy/railway/`
- `deploy/render/`

## Runtime Topology
- Server: FastAPI/WebSocket/SSE control plane and persistence.
- Runner/host: user or sandbox process that executes harnesses, tools, terminals, filesystem, and model calls.
- Runners and hosts dial back to the server; deploy targets generally deploy the server, not every user's execution environment.

## Auth Modes
- `accounts`: built-in username/password and invite flow.
- `oidc`: server-owned OIDC login flow.
- `header`: trusted reverse proxy injects identity; only safe behind a sanitizing proxy.

## Sandbox Providers
- Modal, Daytona, Islo, CoreWeave Sandbox, and E2B are represented in `deploy/` and optional dependencies.