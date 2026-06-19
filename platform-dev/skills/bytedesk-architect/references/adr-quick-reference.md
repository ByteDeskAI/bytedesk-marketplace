# ADR Quick Reference

One-line summary of each ADR. Read the full ADR from `docs/architecture/adr/00{N}-*.md` when a plan touches that domain.

| ADR | Title | Core rule |
|---|---|---|
| 0001 | Microservices Architecture | Services are separate processes with their own databases. No cross-service DB access. |
| 0002 | Database-per-Tenant | Each service has one DB. Tenant data isolated by schema or row-level policy. EF Core code-first. |
| 0003 | MassTransit + RabbitMQ | All async messaging via MassTransit. `AddByteDeskMessaging()` only — never raw config. |
| 0004 | YARP API Gateway | Gateway reverse-proxies HTTP and SignalR hubs. Do not add per-topic browser realtime proxies. |
| 0005 | OpenIddict Auth | JWT tokens via OpenIddict. `RequireAuthorization()` on all protected routes. |
| 0006 | Node.js AI Sidecar | Claude API calls go through the Node.js sidecar, not directly from .NET. |
| 0007 | OSS-only Stack | No proprietary vendor lock-in. All infrastructure components are open source. |
| 0008 | GoF Design Patterns | Strategy for interchangeable algorithms. Adapter for external APIs. Template Method for consumers. |
| 0009 | Enterprise Integration Patterns | Idempotent Receiver on all consumers. Dead Letter Channel automatic. Saga for multi-step flows. |
| 0010 | SEO Integration | SEO agents are Claude Code sub-agents in the skill ecosystem, not backend services. |
| 0011 | Superseded Local Orchestration | Superseded by ADR-0036. Local and production runtime is Kubernetes. Never `dotnet run` directly. |
| 0012 | Superseded Redis Realtime | Superseded by ADR-0032 for browser realtime; retained only as historical context. |
| 0032 | SignalR Browser Realtime | Browser realtime flows through ByteDesk.Realtime + SignalR. No browser SSE, EventSource, or custom /ws bridges. |
| 0013 | Tool Action Pattern | All async work (>2s) follows the 9-touch-point Tool Action Pattern. No exceptions. |
| 0014 | Atomic Design System | 5-layer atomic hierarchy. Pages compose organisms. No business logic in atoms/molecules. |
| 0016 | Pipeline Execution Engine | Sales pipelines use a MassTransit saga state machine. Step types: manual, automated, conditional, wait, webhook. |
| 0017 | Development Sandbox Architecture | Dev projects run in isolated Docker containers. Agent server manages sandbox lifecycle. |
| 0018 | Split Agent Architecture | Dual-model: Haiku for fast/cheap steps, Sonnet for reasoning/quality steps. No single model for all. |
| 0019 | Distributed Deployment Topology | Service ports are fixed (Gateway:46444, Web:46445, Identity:46446, ...). Config via `Services:{Name}:BaseUrl`. |
| 0020 | Kubernetes Deployment | Production on RKE2/Hetzner via Helm. Env vars via ConfigMap + Secret. No hardcoded values in images. |

## When a plan contradicts an ADR

Report the conflict directly in the review:

```
[HIGH] Proposed approach contradicts ADR-0032: plan adds a browser-facing SSE endpoint, but browser realtime must flow through ByteDesk.Realtime and SignalR. Fix: publish a tenant/resource-scoped Redis projection event, add or reuse a RealtimeTopicRegistry mapping, and consume it from the frontend with useTopic/useAdminTopic.
```

Do not soften this — ADR violations are HIGH severity findings.

## Checking if an ADR needs updating

If the plan introduces a genuinely new pattern that isn't covered by any ADR, flag it:

```
[OPEN QUESTION] This plan introduces a new pattern (X) that isn't covered by existing ADRs. If this becomes the standard approach, consider drafting ADR-0021.
```

The `bytedesk-adr` skill handles ADR creation — reference it in the review if a new ADR is warranted.