---
name: bytedesk-tool-action-engineer
description: ByteDesk Tool Action Pattern engineer. Invoke whenever the user wants to add a new async tool action (web scraping, SEO analysis, market research, AI intelligence, or any other background job), audit existing tool actions for pattern violations, or wire up a result viewer for a job type. Also invoke for "add a tool", "create a new action", "add a job type", "wire up results viewer for X", "check tool pattern compliance", "missing result viewer", "new background job", or any mention of JobType, BaseConsumer, tool actions, or the 9-file pattern. Plan-first — never write files without showing the full plan and getting confirmation.
user-invokable: true
argument-hint: "add <ToolName> | audit [<ToolName>] | viewer <ToolName>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
---

## Mission

Add a new end-to-end Tool Action (background job + frontend viewer) following the ByteDesk 9-touch-point pattern, or audit existing actions for compliance. Every new action requires every touch point — partial wiring is the leading source of "why isn't my tool showing results?" bugs.

**Read `.claude/rules/backend.md` §Tool Action Pattern and `.claude/rules/frontend.md` before writing anything.**

---

## The 9-Touch-Point Pattern

One logical "tool action" spans 9 concrete changes across 5 files (some files get multiple changes):

| # | What | File | Notes |
|---|---|---|---|
| 1 | `JobType` enum entry | `Shared.Contracts/Enums/JobType.cs` | PascalCase, add to correct category group |
| 2 | Command record | `Shared.Contracts/Commands/{Name}Command.cs` | `TenantId`, `JobId`, input fields, `ICorrelatedMessage` |
| 3 | Consumer class | `Tools/Consumers/{Name}Consumer.cs` | Extends `BaseConsumer<{Name}Command>` |
| 4 | Endpoint static class | `Tools/Endpoints/{Name}Endpoints.cs` | `MapPost("/")` → `ApiResults.Accepted(job.Id)` |
| 5 | Consumer registration | `Tools/Program.cs` | `x.AddConsumer<{Name}Consumer>()` |
| 6 | Endpoint group mapping | `Tools/Program.cs` | `app.MapGroup("/api/tools/{slug}").Map{Name}Endpoints()` |
| 7 | Frontend type + request + API method | `Web/src/lib/api/tools.ts` + `lib/config/tools-config.ts` + `forms/tool-runner.ts` | `JobType` union, `XRequest` interface, `toolsApi.x`, `TOOLS` entry, `TOOL_RUNNERS` entry |
| 8 | Result viewer component | `Web/src/components/tools/results/{Name}ResultView.tsx` | Typed data interface + rich display |
| 9 | ResultsRouter registration | `Web/src/components/tools/results/ResultsRouter.tsx` | Lazy `dynamic()` import + `switch` case |

Missing any single touch point causes a specific failure mode — the audit section documents each one.

---

## Running Modes

### `add` — scaffold a new tool action end-to-end

```
/bytedesk-tool-action-engineer add {ToolName}
```

Example: `/bytedesk-tool-action-engineer add CompetitorPriceWatch`

**Step 1 — Gather intent via AskUserQuestion:**

```
AskUserQuestion({
  question: "Tell me about the new tool action.",
  fields: [
    { id: "name", label: "Tool name (PascalCase)", placeholder: "e.g. CompetitorPriceWatch" },
    { id: "description", label: "One-line description for the UI card", placeholder: "Monitor competitor pricing changes" },
    { id: "inputs", label: "Input fields (name: type, one per line)", type: "textarea", placeholder: "url: string\nfrequency: string (optional)" },
    { id: "output_shape", label: "Output shape (what does the result object look like?)", type: "textarea", placeholder: "{ competitors: [{name, url, price, changePercent}], summary: string }" },
    { id: "category", label: "Frontend category", type: "select", options: ["content", "search", "analysis", "design", "seo"] },
    { id: "icon", label: "Lucide icon name", placeholder: "e.g. DollarSign, TrendingDown, Eye" },
    { id: "service", label: "Which service does the heavy work?", type: "select", options: ["Tools (new pipeline)", "AI sidecar (Node.js)", "External API adapter"] }
  ]
})
```

**Step 2 — Generate a plan document before writing anything:**

Show the user the complete 9-touch-point plan with exact file paths, class names, and code snippets. Ask for confirmation before proceeding.

Format:
```markdown
## Tool Action Plan: {ToolName}

### Touch point 1 — JobType enum entry
File: src/ByteDesk.Shared.Contracts/Enums/JobType.cs
Add: `{ToolName},`  (after last entry in the logical group)

### Touch point 2 — Command record
File: src/ByteDesk.Shared.Contracts/Commands/{ToolName}Command.cs
[Show the full record body]

### Touch point 3 — Consumer
File: src/ByteDesk.Tools/Consumers/{ToolName}Consumer.cs
[Show class signature + ProcessAsync skeleton]

...and so on for all 9 touch points
```

**Step 3 — Write files only after confirmation.**

Write in dependency order: shared contracts first (1–2), then backend (3–6), then frontend (7–9).

After writing, run a build check:
```bash
cd src/ByteDesk.Web && npx next build 2>&1 | tail -30
```

---

### `audit` — check compliance for one or all tool actions

```
/bytedesk-tool-action-engineer audit               # all JobType entries
/bytedesk-tool-action-engineer audit MarketResearch  # single tool
```

For each `JobType` entry, verify all 9 touch points exist. Report findings in this format:

```markdown
## Tool Action Audit — {DATE}

| Tool | TP1 | TP2 | TP3 | TP4 | TP5 | TP6 | TP7a | TP7b | TP7c | TP8 | TP9 | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MarketResearch | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Complete |
| NewTool       | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✗ | ✗ | 4 missing |
```

TP7 columns: a=JobType union in tools.ts, b=TOOLS array entry in tools-config.ts, c=TOOL_RUNNERS entry.

Grep commands for the audit — run in parallel:

```bash
# TP1 — all JobType values (source of truth)
grep -n "^\s\+\w\+,\?" src/ByteDesk.Shared.Contracts/Enums/JobType.cs | grep -v "//\|{"

# TP2 — command records
ls src/ByteDesk.Shared.Contracts/Commands/

# TP3 — consumers
ls src/ByteDesk.Tools/Consumers/

# TP4 — endpoints
ls src/ByteDesk.Tools/Endpoints/

# TP5 — consumer registrations
grep -n "AddConsumer" src/ByteDesk.Tools/Program.cs

# TP6 — endpoint group mappings
grep -n "MapGroup.*tools\|Map.*Endpoints" src/ByteDesk.Tools/Program.cs

# TP7a — frontend JobType union
grep -A 60 "^export type JobType" src/ByteDesk.Web/src/lib/api/tools.ts

# TP7b — TOOLS array entries in tools-config
grep "id:" src/ByteDesk.Web/src/lib/config/tools-config.ts

# TP7c — TOOL_RUNNERS entries
grep -n "^\s\+\w\+:" src/ByteDesk.Web/src/components/tools/forms/tool-runner.ts

# TP8 — result viewers
ls src/ByteDesk.Web/src/components/tools/results/

# TP9 — ResultsRouter registrations
grep -n "ResultView\|ResultsView\|View = dynamic" src/ByteDesk.Web/src/components/tools/results/ResultsRouter.tsx
```

---

### `viewer` — add only the result viewer for an existing job type

```
/bytedesk-tool-action-engineer viewer {ToolName}
```

Use this when a tool's backend is wired but the results page shows the generic viewer. Reads the job's actual output shape from a real job record if possible (ask the user for a job ID), then designs a typed viewer.

Steps:
1. Ask user for an example job ID to inspect the output shape
2. Read `GET /api/tools/jobs/{id}` output via the existing job detail page or job logs
3. Design the viewer with appropriate sections, metrics, and data tables
4. Create `{ToolName}ResultView.tsx` in `components/tools/results/`
5. Add to `ResultsRouter.tsx` (lazy import + switch case)

---

## Conventions Quick Reference

(Full reference in `.claude/rules/backend.md` §Tool Action Pattern)

### Backend naming

```
JobType:     {ToolName}                                    # PascalCase enum value
Command:     {ToolName}Command                             # record in Shared.Contracts
Consumer:    {ToolName}Consumer                            # in Tools/Consumers/
Endpoint:    {ToolName}Endpoints                           # static class in Tools/Endpoints/
URL slug:    /api/tools/{kebab-case-tool-name}             # e.g. /api/tools/competitor-price-watch
```

### Frontend naming

```
JobType:     "{camelCaseToolName}"                         # in tools.ts JobType union
TOOLS id:    "{camelCaseToolName}"                         # must match JobType exactly
API method:  toolsApi.{camelCaseToolName}(data)            # in ToolsActionsApi
Viewer:      {ToolName}ResultView                          # component export
Viewer file: {ToolName}ResultView.tsx                      # in components/tools/results/
```

### camelCase mapping examples
```
JobType.MarketResearch  →  "marketResearch"
JobType.DigitalGapSearch  →  "digitalGapSearch"
JobType.SeoComprehensiveReport  →  "seoComprehensiveReport"
```

---

## Result Viewer Design Guide

Every viewer receives `{ data: Record<string, unknown> }` from `ResultsRouter`. The viewer is wrapped in `ResultViewerShell` (provides Report + Raw Data tabs).

Read `references/result-view-template.tsx` before writing a new viewer.

**Anatomy of a good viewer:**

1. **Header row** — icon + title + optional `<Badge>` for the primary entity
2. **`<MetricGrid>`** — 2–4 summary stats (count, avg score, highlights)
3. **Filter/search bar** — if >10 items
4. **Main content** — cards grid or `<DataTable>` depending on data shape
5. **Detail sections** — expandable sections for verbose AI output

**Design tokens to use:**
- Status/quality scores: `<Badge variant="green|amber|red">` with numeric thresholds
- Section labels: `<Label muted>`
- Empty state: `<EmptyState>` from `@/components/shared`
- Numbers/metrics: `<MetricCard>` from `@/components/ui`
- Consistent color helpers: derive from `var(--color-accent-*)` tokens, not hardcoded hex

**Anti-patterns (will fail design review):**
- `text-[10px]` or `text-[11px]` — use `.text-caption` or `.text-label`
- Hardcoded `#hex` — use `var(--color-*)`
- `animate-pulse` divs — use `<Skeleton>` atom
- Inline `style={{ fontFamily }}` — IBM Plex Sans is global default

---

## Checklist Before Marking Done

After writing all files for an `add` run:

```
[ ] JobType enum entry exists in Shared.Contracts
[ ] Command record implements ICorrelatedMessage (TenantId, JobId, CorrelationId)
[ ] Consumer extends BaseConsumer<{Name}Command>, not IConsumer<T>
[ ] Consumer overrides IsAlreadyProcessedAsync checking job.Status
[ ] Endpoint serializes input to JsonDocument using JsonDefaults.Options
[ ] Endpoint calls CreateJobAsync(JobType.X, input) THEN publishes command
[ ] Endpoint returns ApiResults.Accepted(job.Id.ToString(), location)
[ ] AddConsumer<{Name}Consumer>() in Program.cs
[ ] MapGroup + Map{Name}Endpoints() in Program.cs
[ ] JobType camelCase string added to frontend union type
[ ] XRequest interface in tools.ts
[ ] toolsApi.x method wired
[ ] TOOLS array entry in tools-config.ts with matching id, icon, color, category
[ ] TOOL_RUNNERS entry in tool-runner.ts
[ ] {Name}ResultView.tsx created with typed data interface
[ ] ResultsRouter lazy import + switch case
[ ] npx next build passes
```

---

## Reference Files

- `references/command-template.cs` — canonical command record with inline guidance
- `references/consumer-template.cs` — BaseConsumer template with ProcessAsync + IsAlreadyProcessedAsync
- `references/endpoint-template.cs` — Minimal API endpoint group with JobService + PublishEndpoint
- `references/result-view-template.tsx` — TypeScript result viewer with MetricGrid + data table pattern
- `references/audit-checklist.md` — grep commands and failure modes for each touch point
