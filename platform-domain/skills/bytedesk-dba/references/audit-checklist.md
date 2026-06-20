# DBA Audit Checklist — ByteDesk

Full reference for each analysis pass. Read the relevant section before running greps.

---

## Index Analysis

### What to find

**FK without index (HIGH severity)**
Every `public Guid XxxId` or `public Guid? XxxId` navigation FK should have `HasIndex(e => e.XxxId)` in `OnModelCreating`. Missing = sequential scan on every JOIN.

```bash
# All FK-looking properties
grep -rn "public Guid.*Id { get;" src --include="*.cs" \
  | grep -v "//\|Migrations\|DbContext\|Id { get; set; } = Guid.NewGuid"

# Existing HasIndex calls
grep -rn "HasIndex" src --include="*.cs" | grep -v Migrations
```

**TenantId + Status composite (MEDIUM)**
If a list endpoint filters by both TenantId and Status (common for kanban/dashboard), a composite index `(TenantId, Status)` is more selective than two single-column indexes.

**CreatedAt / UpdatedAt index (LOW)**
Only add if the page actually sorts or filters by timestamp. Check the actual query handlers.

**Low-cardinality candidates to flag, not add**
- Boolean columns (`IsActive`, `IsDeleted`) — only 2 values, index rarely helps
- Enum columns with 2-3 values and even distribution

### Output format

```markdown
### Index Analysis — ByteDesk.{Service}

| Entity | Property | Type | Index? | Severity | Recommendation |
|---|---|---|---|---|---|
| Contact | CompanyId | FK | ✗ | HIGH | `HasIndex(e => e.CompanyId)` |
| Contact | TenantId + Status | Composite | ✗ | MEDIUM | `HasIndex(e => new { e.TenantId, e.Status })` |
| Lead | IsActive | Boolean | — | SKIP | Low cardinality — index won't help |
```

---

## Query Analysis (N+1 Detection)

### Patterns to find

**Pattern 1: DbContext call inside loop (HIGH)**
```csharp
// Bad — N database calls for N contacts
foreach (var contact in contacts)
{
    var company = await _db.Companies.FindAsync(contact.CompanyId);
}

// Fix — one query with Include, or batch with dictionary
var contacts = await _db.Contacts.Include(c => c.Company).ToListAsync();
```

```bash
# Files with both foreach and DB access — high N+1 risk
grep -rn "foreach\|\.ForEach" src --include="*.cs" -l \
  | grep -v Migrations \
  | xargs grep -l "_db\.\|await.*Async\|DbContext" 2>/dev/null
```

**Pattern 2: ToList with no Where (MEDIUM)**
```csharp
// Bad — loads entire table
var all = await _db.Contacts.ToListAsync();

// Fix — always add Where + pagination
var page = await _db.Contacts
    .Where(c => c.TenantId == tenantId && c.Status == ContactStatus.Active)
    .OrderByDescending(c => c.CreatedAt)
    .Skip(offset).Take(limit)
    .ToListAsync();
```

```bash
grep -rn "\.ToListAsync()" src --include="*.cs" \
  | grep -v "\.Where\|\.Take\|Migrations\|//"
```

**Pattern 3: Missing Include (MEDIUM)**
Navigation properties accessed after `.ToListAsync()` without `.Include()` trigger implicit lazy loading or throw if lazy loading is disabled.

```bash
# Find navigation property access patterns
grep -rn "\.\(Company\|Contact\|Pipeline\|Opportunity\)\." src --include="*.cs" \
  | grep -v "//\|Migrations\|new \|typeof" | head -40
```

**Pattern 4: Select inside loop (HIGH)**
```csharp
// Bad — one query per pipeline step
var results = pipelines.Select(p => new {
    p.Name,
    StageCount = _db.PipelineStages.Count(s => s.PipelineId == p.Id) // query per iteration!
}).ToList();

// Fix — batch query or join
```

---

## Schema Analysis

### DateTime violations (MEDIUM)
```bash
grep -rn "public DateTime " src --include="*.cs" \
  | grep -v "//\|Migrations\|DateTimeOffset"
```
Every hit: replace `DateTime` with `DateTimeOffset`. Check if existing data needs a migration.

### Missing DomainEntity inheritance (HIGH)
```bash
# Entities in Domain/ not inheriting DomainEntity
grep -rn "^public class " src/ByteDesk.*/Domain --include="*.cs" \
  | grep -v ": DomainEntity\|abstract\|//\|Enum\|Status"
```
Missing `DomainEntity` means `AddDomainEvent()` is unavailable → domain events never fire → cross-service projections break silently (ADR-0023).

**Known outlier:** `EmailLog` in the Email service — intentional per `database.md`, skip it.

### JSONB without column type (MEDIUM)
```bash
grep -rn "JsonDocument" src --include="*.cs" \
  | grep -v "//\|Migrations" \
  | grep -v "HasColumnType"
```
Without `HasColumnType("jsonb")` EF stores as `json` text type, not binary JSONB. Functional but loses GIN indexing and JSONB-specific operators.

### Enum stored as int (MEDIUM)
```bash
# Enums in entity properties without HasConversion
grep -rn "HasConversion<string>" src --include="*.cs" | grep -v Migrations
# Compare against enum properties in entities
grep -rn "public.*Status\|public.*Type\|public.*Kind" src/ByteDesk.*/Domain --include="*.cs" | grep -v "//"
```
Int enums break readability in DB queries and make migrations harder when enum values reorder.

### Missing timestamps (LOW)
Every mutable entity should have `CreatedAt: DateTimeOffset` + `UpdatedAt: DateTimeOffset?`. Check entities missing one or both.

---

## Migration Analysis

### Naming conventions (LOW)
PascalCase descriptive names only:
```bash
# Files with numeric-only or poor names
find src -path "*/Migrations/*.cs" ! -name "*Designer*" -name "*.cs" \
  | xargs -I {} basename {} .cs \
  | grep -E "^[0-9]|_[a-z]|Migration[0-9]"
```

Good: `AddScoreToContact`, `CreateInvoiceLineItem`, `AddCompositeIndexToLeads`
Bad: `migration_001`, `20240101_update`, `Migration20240315123456`

### Down() completeness (HIGH)
Every `AddColumn` in `Up()` must have a `DropColumn` in `Down()`. Every `CreateTable` must have a `DropTable`.
```bash
# Migrations with empty or minimal Down()
grep -rn "migrationBuilder\.Down\|throw new NotImplementedException" \
  src --include="*.cs" | grep -v Designer
```

### Raw SQL (HIGH — rule violation)
```bash
grep -rn "migrationBuilder\.Sql\b" src --include="*.cs" | grep -v "//"
```
Schema changes via `Sql()` bypass EF tracking → schema drift. Exception: custom SQL for data backfill during migration is allowed with a comment explaining why.

### PendingModelChangesWarning suppressed (HIGH — rule violation)
```bash
grep -rn "SuppressPendingModelChanges\|PendingModelChanges" src --include="*.cs"
```
Suppressing this warning hides entity changes that haven't been migrated. Fix the root cause (generate the migration) instead.

### Seed creating schema (HIGH — rule violation)
```bash
grep -rn "CREATE TABLE\|ALTER TABLE\|ADD COLUMN\|DROP TABLE" src --include="*.cs" \
  | grep -v "//\|Migrations\|\.md"
```

---

## Severity Guide

| Severity | Meaning | Action |
|---|---|---|
| **HIGH** | Rule violation or data integrity risk | Fix in current sprint |
| **MEDIUM** | Performance or convention issue | Plan for next sprint |
| **LOW** | Style/maintainability | Address in next cleanup pass |
| **SKIP** | Known outlier documented in database.md | Document, do not fix |
