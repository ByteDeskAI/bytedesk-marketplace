---
name: bytedesk-dba
description: ByteDesk database architect skill. Invoke whenever the user wants to audit the schema, design a new entity, plan a migration, analyze query performance, find N+1 problems, check index coverage, or do any database-level analysis or design work. Also invoke for "design this entity", "add a migration for X", "find N+1 in Y service", "check indexes", "audit the schema", "analyze the database", "what indexes are missing", "is this query efficient", or any mention of EF Core entities, migrations, database performance, or schema design. When in doubt, invoke this rather than making database changes directly — it enforces ByteDesk conventions (DomainEntity inheritance, DateTimeOffset, JSONB, domain events) and requires plan-first confirmation before generating any migration file.
user-invokable: true
argument-hint: "audit | analyze [indexes|queries|schema|migrations|all] | design <entity> | migrate <description>"
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

Audit schema health, design new entities following ByteDesk conventions, plan and generate migrations, and find database performance issues in EF Core. **Migrations are always plan-first — never generate a migration file without user confirmation.**

**Read `.claude/rules/database.md` before touching any file.**

## Service → Database Map

| Service | Database | DbContext location |
|---|---|---|
| `ByteDesk.Identity` | `bytedesk_identity` | `ByteDesk.Identity/Data/` |
| `ByteDesk.Sales` | `bytedesk_sales` | `ByteDesk.Sales/Data/` |
| `ByteDesk.Tools` | `bytedesk_tools` | `ByteDesk.Tools/Data/` |
| `ByteDesk.AI` | `bytedesk_ai` | `ByteDesk.AI/Data/` |

Entities live in `{Service}/Domain/`. EF configs in `OnModelCreating` in the DbContext file or in `{Service}/Data/Configurations/`. Migrations in `{Service}/Data/Migrations/`.

---

## Running Modes

### `analyze` — targeted health scans

Each analysis pass produces a structured report with findings, severity, and recommended fixes. Does not modify any file.

```
/bytedesk-dba analyze             ← prompts you to choose which analyses to run
/bytedesk-dba analyze indexes
/bytedesk-dba analyze queries
/bytedesk-dba analyze schema
/bytedesk-dba analyze migrations
/bytedesk-dba analyze all
```

**When invoked as `/bytedesk-dba analyze` with no sub-command**, use `AskUserQuestion` to ask the user which analyses to run before doing anything:

```
AskUserQuestion({
  question: "Which analyses should I run?",
  header: "Analysis scope",
  multiSelect: true,
  options: [
    { label: "Indexes", description: "Missing FK indexes, composite index opportunities, low-cardinality candidates" },
    { label: "Queries (N+1)", description: "N+1 LINQ patterns, unbounded ToList(), missing .Include()" },
    { label: "Schema", description: "DateTime violations, missing DomainEntity, JSONB columns, enum storage" },
    { label: "Migrations", description: "Migration naming, Down() completeness, raw SQL, pending model changes" },
  ]
})
```

Run only the selected analyses. `analyze all` skips the question and runs everything.

#### `analyze indexes`
Find missing indexes across all services. Check:
- Every FK property (`{Entity}Id`, `{Entity}Id?`) — needs a corresponding `HasIndex(e => e.XxxId)`
- Common filter columns (`Status`, `TenantId`, `CreatedAt`) — candidates for index if used in `WHERE` clauses
- Composite index opportunities: columns that always appear together in queries (e.g. `TenantId + Status`)
- Existing indexes that may be unused (column has low cardinality or is never filtered)

```bash
# Find all FK-looking properties across all entities
grep -rn "public Guid.*Id { get; set; }\|public Guid?.*Id { get; set; }" src --include="*.cs" | grep -v "//\|Migrations\|DbContext"

# Find existing HasIndex calls in OnModelCreating
grep -rn "HasIndex\|HasForeignKey" src --include="*.cs" | grep -v Migrations | grep -v "//"
```

Output format:
```
### Index Analysis — {Service}
| Entity | Property | Type | Index exists? | Recommendation |
|---|---|---|---|---|
| Contact | CompanyId | FK | ✗ | ADD — FK without index causes seq scan on join |
| Contact | Status | Filter | ✗ | CONSIDER — if filtered in list queries |
| Pipeline | TenantId + Status | Composite | ✗ | ADD — composite filter on every kanban query |
```

#### `analyze queries`
Find N+1 patterns and unbounded queries in service LINQ. Check:
- `.Select()` or `.Where()` calls inside a `.ForEach()` / `foreach` loop over a collection already loaded from DB
- `DbContext` or repository calls inside loops
- Missing `.Include()` / `.ThenInclude()` for navigation properties accessed after query
- `.ToList()` calls that load entire tables with no `Where` clause
- `GetAll()` / `List()` endpoints returning collections without pagination

```bash
# Find foreach + DB call patterns
grep -rn "foreach\|\.ForEach" src --include="*.cs" -l | grep -v Migrations | xargs grep -l "await.*Async\|DbContext\|_db\." 2>/dev/null

# Find ToList without Where (possible full-table scans)
grep -rn "\.ToListAsync()\|\.ToList()" src --include="*.cs" | grep -v "\.Where\|\.Take\|Migrations\|//"

# Find navigation property access without Include
grep -rn "\.(Company|Contact|Pipeline|Opportunity)\." src --include="*.cs" | grep -v "//\|Migrations" | head -30
```

Output format:
```
### N+1 Analysis — {Service}/{File}
| Location | Pattern | Severity | Fix |
|---|---|---|---|
| ContactQueryService.cs:142 | DbContext call inside foreach | HIGH | Batch with .Include() or dictionary lookup |
| PipelineService.cs:89 | .ToListAsync() with no Where | MEDIUM | Add .Take(n) + pagination |
```

#### `analyze schema`
Check every entity for convention violations. Check:
- `DateTime` used instead of `DateTimeOffset` (breaks timezone-aware queries)
- Entity does not inherit `DomainEntity` (breaks cross-service event projection per ADR-0023)
- Nullable `Guid` FK without `?` suffix on the property name (ambiguous intent)
- String columns without `HasMaxLength()` (PostgreSQL uses `text` by default — fine, but explicit is better)
- `JsonDocument` columns without `HasColumnType("jsonb")` in EF config (stores as json text, not binary jsonb)
- Enums stored as int (should be string via `HasConversion<string>()`)
- Missing `CreatedAt` / `UpdatedAt` on mutable entities

```bash
# Find DateTime (not DateTimeOffset)
grep -rn "public DateTime " src --include="*.cs" | grep -v "//\|Migrations\|DateTimeOffset"

# Find entities not inheriting DomainEntity
grep -rn "^public class.*{$\|^public class.*$" src --include="*.cs" | grep -v "DomainEntity\|abstract\|static\|//\|Migrations\|DbContext\|Options\|Command\|Event\|Result\|Response\|Request\|Dto\|Config\|Service\|Controller\|Endpoint\|Consumer\|Background\|Factory\|Provider\|Builder\|Manager\|Helper\|Extension\|Program\|Startup" | head -40

# Find JsonDocument without jsonb column type
grep -rn "JsonDocument" src --include="*.cs" | grep -v "//\|Migrations" | grep -v "HasColumnType"
```

#### `analyze migrations`
Audit migration health across all 4 services. Check:
- Pending model changes (entity changed but no migration generated)
- Migration naming — must be PascalCase descriptive (`AddScoreToContact` not `Migration20240101`)
- `Down()` completeness — every `AddColumn` must have a corresponding `DropColumn` in `Down()`
- Raw SQL in migrations (should not exist — schema via EF only)
- Seed data creating tables/columns (must be data only)
- `PendingModelChangesWarning` suppressed (rule violation)

```bash
# Find migration files with poor names
find src -path "*/Migrations/*.cs" -name "*.cs" | grep -v Designer | xargs ls -1 2>/dev/null | grep -E "[0-9]{14}_[a-z]|_[0-9]"

# Find raw SQL in migrations
grep -rn "Sql(\|migrationBuilder\.Sql" src --include="*.cs" | grep -v "//\|Migrations/.*Designer"

# Find suppressed PendingModelChangesWarning
grep -rn "PendingModelChanges\|SuppressPendingModelChanges" src --include="*.cs"

# Find seed files creating tables
grep -rn "CREATE TABLE\|ALTER TABLE\|ADD COLUMN" src --include="*.cs" | grep -v "//\|Migrations"
```

#### `analyze all`
Run all 4 analysis passes in parallel, then produce a unified health report with severity-prioritized fix list.

---

### `design` — scaffold a new entity

```
/bytedesk-dba design {EntityName} [in {Service}]
```

Example: `/bytedesk-dba design InvoiceLineItem in Sales`

**Before writing any file**, use `AskUserQuestion` to confirm:
1. What service does this entity belong to? (Identity / Sales / Tools / AI)
2. What are the key fields and their types?
3. Does it have FK relationships to existing entities? (list them)
4. What enum values does the status field have? (if applicable)
5. Is there flexible/sparse data that should be JSONB?

**After gathering answers**, produce:
1. Entity class extending `DomainEntity` with all fields
2. EF Core configuration (indexes, FK constraints, JSONB columns, string lengths) in `OnModelCreating` or a config class
3. Status enum in `ByteDesk.Shared.Contracts/Enums/` (if needed)
4. Domain event records: `{Entity}CreatedEvent`, `{Entity}UpdatedEvent`, `{Entity}DeletedEvent` in `ByteDesk.Shared.Contracts/Events/`
5. Migration plan document (see §Migration planning)

Read `references/entity-scaffold.cs` for the canonical template before writing anything.

**Do NOT generate the migration file** during design — produce the plan document first, let the user review it, then offer to run `dotnet ef migrations add`.

---

### `migrate` — plan and generate a migration

```
/bytedesk-dba migrate "{DescriptiveName}"
```

Example: `/bytedesk-dba migrate "AddScoreToContact"`

**Always plan-first.** Before generating any file:

1. Read the current entity and its EF config
2. Identify exactly what changed (added columns, dropped columns, new indexes, renamed columns)
3. Produce a migration plan document:

```
## Migration Plan: {Name}

### Service: {Service}
### Command: dotnet ef migrations add {Name} --project ByteDesk.{Service} --startup-project ByteDesk.{Service} --output-dir Data/Migrations

### Changes
| Type | Detail |
|---|---|
| AddColumn | contacts.score (int, nullable, default null) |
| AddIndex | contacts (score) — for sorting/filtering |

### Up() will do
- ALTER TABLE contacts ADD COLUMN score integer
- CREATE INDEX IX_contacts_score ON contacts (score)

### Down() will do
- DROP INDEX IX_contacts_score
- ALTER TABLE contacts DROP COLUMN score

### Data impact
- Existing rows: score = null (nullable column, no backfill needed)
- Zero downtime: additive-only change

### Risks
- None — nullable column, existing rows unaffected
```

4. Ask the user to confirm the plan
5. **Only after confirmation**: run `dotnet ef migrations add {Name} --project ByteDesk.{Service} --startup-project ByteDesk.{Service} --output-dir Data/Migrations`
6. Review the generated Up()/Down() — verify they match the plan
7. Report any discrepancy

**High-risk patterns that require extra confirmation:**
- `DropColumn` — irreversible data loss if Down() is needed
- `RenameColumn` — EF generates Drop + Add, not rename; may need custom SQL
- Removing NOT NULL constraint from existing column — affects all rows
- Any migration on the `bytedesk_identity` database — highest-traffic, most risk

---

## Conventions Quick Reference

(Full reference in `.claude/rules/database.md`)

```csharp
// ✓ Correct entity
public class Invoice : DomainEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Number { get; set; }
    public InvoiceStatus Status { get; set; } = InvoiceStatus.Draft;
    public JsonDocument? Metadata { get; set; }      // JSONB for flexible data
    public Guid ContactId { get; set; }              // FK — needs HasIndex
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UpdatedAt { get; set; }   // nullable — not set until first update
}

// ✓ EF config in OnModelCreating
entity.HasIndex(e => e.ContactId);                   // FK index — always
entity.HasIndex(e => new { e.TenantId, e.Status });  // composite filter index
entity.Property(e => e.Metadata).HasColumnType("jsonb");
entity.Property(e => e.Status).HasConversion<string>();

// ✓ Domain event on mutation
contact.Score = newScore;
contact.UpdatedAt = DateTimeOffset.UtcNow;
contact.AddDomainEvent(new ContactUpdatedEvent(TenantId: tenantId, ContactId: contact.Id, CompanyId: contact.CompanyId));
await _db.SaveChangesAsync(ct);
```

---

## Report Format

```
## DBA Run — {DATE} — {Mode}

### Health Summary
| Category | Issues found | Severity |
|---|---|---|
| Missing indexes | 7 | HIGH |
| N+1 queries | 3 | MEDIUM |
| DateTime violations | 2 | MEDIUM |
| Missing DomainEntity | 1 | HIGH |
| Migration issues | 0 | — |

### Priority Fix List
1. [HIGH] Contact.CompanyId — FK without index (seq scan on every contact join)
2. [HIGH] OrderItem does not inherit DomainEntity — domain event projection broken
3. [MEDIUM] N+1 in PipelineService.cs:89 — foreach over contacts hitting DB per row
...

### Items Requiring Design Decision
- EmailLog entity bypasses DomainEntity (known outlier per database.md — migration target, not a bug)
```