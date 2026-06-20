---
name: omnigent-architect
description: Omnigent architecture and plan-review skill. Use before non-trivial changes to server, runner, runtime, inner harnesses, tools, agent spec, storage, auth, deployment, SDKs, WebSockets, or APIs; also use for "review this plan", "what did I miss", "is this the right design", and boundary checks inside bytedesk-omnigent.
---

# Omnigent Architect

## Mission

Read the plan and the current source, then find missing touch points before implementation. Do not approve a design until the server/runner/runtime/spec/API/test/deploy boundaries are accounted for.

## References

Load only what the plan needs:
- `references/generated/repo-map.md`
- `references/generated/api-surface.md`
- `references/generated/runtime-map.md`
- `references/generated/deploy-sandbox-map.md`

## Review Buckets

1. **Boundary fit**: server control plane, runner/host execution, runtime loop, inner harness, spec parser, stores, SDK, and web UI each own different responsibilities.
2. **Already exists**: search for existing route, schema, tool, policy, store, harness, or UI seam before adding a new one.
3. **Contract drift**: any REST/SSE/WebSocket/event/spec change needs docs, OpenAPI or generated references, SDK compatibility, and tests.
4. **Failure modes**: include tunnel loss, runner unavailable, cancellation, approvals/elicitations, retry, orphaned subprocesses, auth mode, and partial persistence when relevant.
5. **Complexity to cut**: prefer extending an existing seam over introducing a new abstraction, especially in shared runtime and server route code.

## Output

Lead with findings ordered by severity. Include exact files or symbols that make the plan unsafe or incomplete, then give the minimal design correction.
