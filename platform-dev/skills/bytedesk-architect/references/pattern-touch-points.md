# ByteDesk Pattern Touch Points

Complete checklists for every pattern. Use this to verify a plan's claims against what the pattern actually requires.

---

## Tool Action Pattern (ADR-0013)

Required for ALL async work (>2s). Reference: `bytedesk-tool-action-engineer`.

| # | Touch Point | Location | Check |
|---|---|---|---|
| 1 | `JobType` enum entry | `Shared.Contracts/Enums/JobType.cs` | Value in enum |
| 2 | Command record | `Shared.Contracts/Commands/{Name}Command.cs` | Implements `ICorrelatedMessage`, has `TenantId` + `JobId` |
| 3 | Consumer class | `Tools/Consumers/{Name}Consumer.cs` | Extends `BaseConsumer<T>`, NOT `IConsumer<T>` |
| 4 | `IsAlreadyProcessedAsync` | `Tools/Consumers/{Name}Consumer.cs` | Checks `job.Status is not (Pending or null)` |
| 5 | Endpoint class | `Tools/Endpoints/{Name}Endpoints.cs` | Uses `JsonDefaults.Options`, `CreateJobAsync` → `Publish` → `ApiResults.Accepted` |
| 6 | Consumer registration | `Tools/Program.cs` | `x.AddConsumer<{Name}Consumer>()` |
| 7 | Endpoint group | `Tools/Program.cs` | `app.MapGroup("/api/tools/{slug}").Map{Name}Endpoints()` |
| 8 | Frontend type union | `Web/src/lib/api/tools.ts` | camelCase string in `JobType` union |
| 8b | Request interface | `Web/src/lib/api/tools.ts` | `interface XRequest extends IReturn<{id,location}>` |
| 8c | `toolsApi` method | `Web/src/lib/api/tools.ts` | Method in `ToolsActionsApi` + export |
| 8d | `TOOLS` array entry | `Web/src/lib/config/tools-config.ts` | id matching camelCase type |
| 8e | `TOOL_RUNNERS` entry | `Web/src/components/tools/forms/tool-runner.ts` | Function mapping form data to api call |
| 9 | Result viewer | `Web/src/components/tools/results/{Name}ResultView.tsx` | Typed data interface + display |
| 9b | `ResultsRouter` | `Web/src/components/tools/results/ResultsRouter.tsx` | `dynamic()` import + `switch` case |

**Common misses in plans:**
- Touch points 8d (TOOLS array) and 8e (TOOL_RUNNERS) are often forgotten — tool exists in API but not in UI grid
- Touch point 4 (IsAlreadyProcessedAsync) is skipped — causes double-execution on MassTransit retry
- Touch point 9 (result viewer) is deferred — job completes but shows raw JSON dump to user

---

## MassTransit Consumer (any non-Tool-Action consumer)

| Touch Point | Location | Check |
|---|---|---|
| Command/Event record | `Shared.Contracts/Commands/` or `Shared.Contracts/Events/` | `record`, implements `ICorrelatedMessage`, `CorrelationId` is last parameter |
| Consumer class | `{Service}/Consumers/` | `class XConsumer : BaseConsumer<TMessage>` |
| `ProcessAsync` | Consumer | Override, not `Consume()` |
| `IsAlreadyProcessedAsync` | Consumer | Override if idempotency matters |
| Registration | `{Service}/Program.cs` | `x.AddConsumer<XConsumer>()` inside `AddByteDeskMessaging()` |

**Never:** `builder.Services.AddMassTransit(...)` directly. Always `AddByteDeskMessaging()`.

---

## Browser Realtime Topic (ADR-0032, realtime.md)

| Touch Point | Location | Check |
|---|---|---|
| Redis projection publisher | `{Service}/Services/**` | Publishes JSON with tenant/resource ids and UI-safe payload |
| Channel naming | Publisher | Tenant-scoped channels include `{tenantId}`; no bare resource id |
| State/replay store | Publisher + registry | State hash/list/stream only when UX needs replay |
| Topic kind | `RealtimeTopicRegistry.cs` | Adds or reuses `RealtimeTopicKind` |
| Topic resolution | `RealtimeTopicRegistry.cs` | Maps public topic to private Redis channel using server-side tenant context |
| Authorization flags | `RealtimeTopicRegistry.cs` | `RequiresAuth`, `RequiresTenantMatch`, `RequiresPlatformAdmin` are intentional |
| Payload filtering | `RealtimeTopicPayloadFilter.cs` | Required if tenant/company/resource scope depends on payload fields |
| Gateway | `Gateway` config/routes | Uses normal `/hubs/*` proxy; no per-topic realtime route |
| Frontend hook | `Web/src/lib/hooks/**` or component-local hook | Uses `useTopic` or `useAdminTopic`, not raw transport APIs |
| Subscription ownership | Frontend surface | One shared subscription at owning surface, pass state down as props |

**Never:** browser-facing SSE, `EventSource`, raw browser WebSocket, custom Gateway topic bridge, or polling for important live state.

---

## EF Core Entity (ADR-0002, database.md)

| Touch Point | Location | Check |
|---|---|---|
| `DomainEntity` inheritance | `{Service}/Domain/{Entity}.cs` | `: DomainEntity` — required for domain events (ADR-0023) |
| `DateTimeOffset` | Same | NOT `DateTime` anywhere in entity |
| FK properties indexed | `OnModelCreating` or Configurations | `HasIndex(e => e.XxxId)` for every FK |
| Composite index | Same | `HasIndex(e => new { e.TenantId, e.Status })` if filtered together |
| Enum as string | Same | `HasConversion<string>()` — never stored as int |
| JSONB column type | Same | `HasColumnType("jsonb")` for any `JsonDocument` property |
| Domain events | Domain class | `MarkCreated()`, `Update()`, `Delete()` methods calling `AddDomainEvent()` |
| Migration | `{Service}/Data/Migrations/` | PascalCase descriptive name, Down() complete |

**Known outlier:** `EmailLog` intentionally skips `DomainEntity` — document in plan if repeating this pattern.

---

## Minimal API Endpoint Group

| Touch Point | Location | Check |
|---|---|---|
| Static extension method | `{Service}/Endpoints/{Name}Endpoints.cs` | `public static RouteGroupBuilder Map{Name}Endpoints(this RouteGroupBuilder group)` |
| `ApiResults` helpers | Same | `ApiResults.Success/Created/Accepted/BadRequest/NotFound` — never raw `Results.Ok()` |
| `[FromBody]` record | Same | Request DTO is a `record` type |
| `.RequireAuthorization()` | Same | On every non-public route |
| Group mapping | `{Service}/Program.cs` | `app.MapGroup("/api/{service}/{resource}").Map{Name}Endpoints()` |
| Shared.Contracts DTO | `Shared.Contracts/` | Response DTO in shared contracts if cross-service |

---

## Cross-Service HTTP Call (inter-service.md)

| Touch Point | Location | Check |
|---|---|---|
| Named client registration | `Program.cs` | `builder.Services.AddHttpClient("{Name}", ...)` |
| Resilience handler | Same | `.AddStandardResilienceHandler()` — no exceptions |
| No inline `CreateClient()` | Business code | Only `httpClientFactory.CreateClient("{Name}")` |
| Config key | `appsettings.json` / env | `Services:{Target}:BaseUrl` — never hardcoded port |
| `JsonDefaults.Options` | Serialization | `JsonSerializer.Serialize(payload, JsonDefaults.Options)` |

---

## Frontend Component (frontend.md, ADR-0014)

| Touch Point | Layer | Check |
|---|---|---|
| Atom (ui/) | Zero business logic | Uses design tokens only (`var(--color-*)`), no hardcoded hex |
| Molecule (shared/) | 2-3 atoms | Domain-agnostic, composable |
| Organism ({domain}/) | Domain-owned | Can have `useQuery`/`useMutation`, owns domain state |
| Page (app/(app)/) | Route entry | Should be <80 lines, composes organisms + templates |
| No inline `style={{}}` | All | Except one-off color values — standard patterns → atoms |
| No `variant=`/`accent=` in page | Pages | Must go through concrete facade |

---

## Sales Pipeline Step (ADR-0016)

For any plan that adds a new pipeline step type or modifies execution:

| Touch Point | Location | Check |
|---|---|---|
| Step type enum | `Shared.Contracts/Enums/PipelineStepType.cs` | New value |
| Saga handler | `Sales/Sagas/PipelineExecutionStateMachine.cs` | Handler for new step type |
| Step executor service | `Sales/Services/Pipeline/` | Implements step execution |
| `CurrentStepId` sync | Executor | `Opportunity.CurrentStepId` updated on advance |
| Idempotency guard | Saga | Can re-enter same step safely |

---

## AI Agent Route (ADR-0018)

For any plan that adds a new AI capability via the Node.js sidecar:

| Touch Point | Location | Check |
|---|---|---|
| Route handler | `AI.AgentServer/src/routes/` | Express route, Zod input schema |
| Model selection | Route | Haiku for speed/cost, Sonnet for quality/reasoning |
| MCP tools available | Route | Check `src/lib/tools.js` for available tools |
| C# typed client | `AI/Services/AiSidecar/` | Method on `IAiSidecarClient` + `AiSidecarClient` |
| Registered in DI | `AI/Program.cs` | Client registered, extension method added |