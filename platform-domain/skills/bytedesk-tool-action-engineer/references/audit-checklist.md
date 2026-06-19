# Tool Action Audit Checklist

Full grep reference for each of the 9 touch points. Run relevant sections before auditing or when diagnosing a broken tool.

---

## Touch Point 1 — JobType enum entry

```bash
# All enum values (source of truth)
grep -n "^\s\+[A-Z][A-Za-z]*," src/ByteDesk.Shared.Contracts/Enums/JobType.cs \
  | grep -v "//"
```

**Failure mode if missing:** Consumer receives command but `IJobService.CreateJobAsync` fails with `ArgumentOutOfRange` on the unknown type. The HTTP endpoint 500s before the job is even queued.

---

## Touch Point 2 — Command record

```bash
# All command files
ls src/ByteDesk.Shared.Contracts/Commands/

# Check a specific command has required fields
grep -n "Guid TenantId\|Guid JobId\|ICorrelatedMessage\|CorrelationId" \
  src/ByteDesk.Shared.Contracts/Commands/{ToolName}Command.cs
```

**Failure mode if missing:** Endpoint compiles but MassTransit can't route the message — thrown at startup or at dispatch time with a route-not-found error.

**Failure mode if CorrelationId is wrong:** Should be last parameter with `= default`. Incorrect position causes `MassTransit.MessageException` at publish time.

---

## Touch Point 3 — Consumer class

```bash
# All consumers
ls src/ByteDesk.Tools/Consumers/

# Verify BaseConsumer inheritance (not IConsumer<T>)
grep -n "BaseConsumer\|IConsumer" src/ByteDesk.Tools/Consumers/{ToolName}Consumer.cs

# Verify IsAlreadyProcessedAsync exists
grep -n "IsAlreadyProcessedAsync" src/ByteDesk.Tools/Consumers/{ToolName}Consumer.cs
```

**Failure mode if missing:** Command is published to RabbitMQ but no consumer picks it up. Job stays `Pending` forever. Check the `_error` queue in RabbitMQ management UI.

**Failure mode if extends IConsumer<T> directly:** Idempotency and retry logging are lost. Duplicate execution on retry.

**Failure mode if missing IsAlreadyProcessedAsync:** On MassTransit retry, the job runs again from scratch — status may flip from Completed back to Running.

---

## Touch Point 4 — Endpoint class

```bash
# All endpoint files
ls src/ByteDesk.Tools/Endpoints/

# Verify structure: CreateJobAsync + Publish + Accepted
grep -n "CreateJobAsync\|publishEndpoint.Publish\|ApiResults.Accepted" \
  src/ByteDesk.Tools/Endpoints/{ToolName}Endpoints.cs
```

**Failure mode if missing:** 404 from the gateway when the frontend tries to start the job.

**Failure mode if Accepted is wrong:** Returning 200 instead of 202 breaks the frontend's assumption that `{ id, location }` is a job handle, not a result.

---

## Touch Point 5 — Consumer registration in Program.cs

```bash
grep -n "AddConsumer" src/ByteDesk.Tools/Program.cs
```

**Failure mode if missing:** Consumer class exists but MassTransit doesn't know about it. Message goes to `_error` queue immediately at startup. No retries.

---

## Touch Point 6 — Endpoint group mapping in Program.cs

```bash
grep -n "MapGroup.*tools\|Map.*Endpoints" src/ByteDesk.Tools/Program.cs
```

**Failure mode if missing:** 404 from the gateway when calling the endpoint URL. The endpoint class exists but is never registered as a route.

---

## Touch Point 7a — Frontend JobType union

```bash
grep -A 60 "^export type JobType" src/ByteDesk.Web/src/lib/api/tools.ts
```

**Failure mode if missing:** TypeScript compile error — `ResultsRouter` switch falls to `default` (generic viewer) even after the result viewer is added, because the type is missing from the union.

**Naming rule:** `JobType.MarketResearch` → `"marketResearch"` (camelCase). Match exactly or the switch falls through.

---

## Touch Point 7b — TOOLS array entry in tools-config.ts

```bash
grep "id:" src/ByteDesk.Web/src/lib/config/tools-config.ts
```

**Failure mode if missing:** Tool never appears in the Actions page grid. Users can't trigger it from the UI.

**Required fields:** `id`, `label`, `description`, `icon`, `color`, `isSync`, `category`. The `id` must match the `JobType` camelCase string exactly.

---

## Touch Point 7c — TOOL_RUNNERS entry

```bash
grep -n "^\s\+[a-z]" src/ByteDesk.Web/src/components/tools/forms/tool-runner.ts | head -40
```

**Failure mode if missing:** Clicking "Run" in the Actions page throws `Tool 'x' is not configured in TOOL_RUNNERS` at dispatch time. Job is never created.

---

## Touch Point 8 — Result viewer component

```bash
ls src/ByteDesk.Web/src/components/tools/results/
```

**Failure mode if missing:** `ResultsRouter` falls to `default` case → shows `GenericResultView` (raw JSON dump). Data is present but unformatted.

---

## Touch Point 9 — ResultsRouter registration

```bash
# Lazy imports
grep -n "dynamic(.*ResultView\|dynamic(.*View" \
  src/ByteDesk.Web/src/components/tools/results/ResultsRouter.tsx

# Switch cases
grep -n "case \"" src/ByteDesk.Web/src/components/tools/results/ResultsRouter.tsx
```

**Failure mode if lazy import missing but switch case exists:** Runtime import error when the case is hit — `Cannot find module './XResultView'`.

**Failure mode if switch case missing but viewer exists:** Falls to `default` → `GenericResultView`. Common after adding the viewer file but forgetting the router update.

---

## Full Compliance Check (run all at once)

```bash
echo "=== TP1: JobType entries ===" && \
  grep "^\s\+[A-Z][A-Za-z]*," src/ByteDesk.Shared.Contracts/Enums/JobType.cs | grep -v "//" && \
echo "" && \
echo "=== TP2: Command files ===" && \
  ls src/ByteDesk.Shared.Contracts/Commands/ && \
echo "" && \
echo "=== TP3: Consumer files ===" && \
  ls src/ByteDesk.Tools/Consumers/ && \
echo "" && \
echo "=== TP4: Endpoint files ===" && \
  ls src/ByteDesk.Tools/Endpoints/ && \
echo "" && \
echo "=== TP5: Consumer registrations ===" && \
  grep "AddConsumer" src/ByteDesk.Tools/Program.cs && \
echo "" && \
echo "=== TP6: Endpoint group mappings ===" && \
  grep "MapGroup.*tools\|Map.*Endpoints" src/ByteDesk.Tools/Program.cs && \
echo "" && \
echo "=== TP7a: Frontend JobType union ===" && \
  grep -A 30 "^export type JobType" src/ByteDesk.Web/src/lib/api/tools.ts && \
echo "" && \
echo "=== TP7b: TOOLS array ids ===" && \
  grep "id:" src/ByteDesk.Web/src/lib/config/tools-config.ts && \
echo "" && \
echo "=== TP7c: TOOL_RUNNERS entries ===" && \
  grep "^\s\+[a-z][A-Za-z]*:" src/ByteDesk.Web/src/components/tools/forms/tool-runner.ts && \
echo "" && \
echo "=== TP8: Result viewers ===" && \
  ls src/ByteDesk.Web/src/components/tools/results/ && \
echo "" && \
echo "=== TP9: ResultsRouter cases ===" && \
  grep "case \"" src/ByteDesk.Web/src/components/tools/results/ResultsRouter.tsx
```

---

## Severity Guide

| Severity | Effect |
|---|---|
| **HIGH** | Job never runs, or frontend can't trigger the tool at all |
| **MEDIUM** | Job runs but results display incorrectly (GenericResultView fallback) |
| **LOW** | Cosmetic — wrong icon, wrong category in the grid |