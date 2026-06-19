// ── TEMPLATE: ByteDesk Entity Scaffold ───────────────────────────────────────
// Copy to: src/ByteDesk.{Service}/Domain/{EntityName}.cs
// Replace ALL placeholders: {EntityName}, {Service}, {tenantContext}
//
// Canonical reference: src/ByteDesk.Sales/Domain/Contact.cs
// Rules: .claude/rules/database.md
// ─────────────────────────────────────────────────────────────────────────────

using ByteDesk.Shared.Infrastructure.Domain;
using ByteDesk.Shared.Contracts.Enums;   // For shared enums
using ByteDesk.Shared.Contracts.Events;  // For domain events
using System.Text.Json;

namespace ByteDesk.{Service}.Domain;

// ── Entity ────────────────────────────────────────────────────────────────────
// MUST inherit DomainEntity — required for cross-service event projection (ADR-0023)

public class {EntityName} : DomainEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();

    // ── Required fields ───────────────────────────────────────────────────────
    public required string Name { get; set; }
    // Add other required fields here

    // ── Status (if applicable) ────────────────────────────────────────────────
    public {EntityName}Status Status { get; set; } = {EntityName}Status.Active;

    // ── FK relationships ──────────────────────────────────────────────────────
    // Every FK needs HasIndex in EF config (see OnModelCreating below)
    public Guid TenantId { get; set; }
    // public Guid? ParentEntityId { get; set; }          // Nullable FK example
    // public ParentEntity? ParentEntity { get; set; }    // Navigation property

    // ── Flexible/sparse data ──────────────────────────────────────────────────
    // Use JsonDocument for fields that vary by tenant or are rarely needed
    // Requires HasColumnType("jsonb") in EF config
    public JsonDocument? Metadata { get; set; }

    // ── Timestamps ────────────────────────────────────────────────────────────
    // DateTimeOffset — NEVER DateTime (timezone-aware, per database.md)
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? UpdatedAt { get; set; }

    // ── Domain event helpers ──────────────────────────────────────────────────
    // Call before SaveChangesAsync — TenantDbContextBase publishes on save success

    public void MarkCreated(Guid tenantId)
    {
        TenantId = tenantId;
        AddDomainEvent(new {EntityName}CreatedEvent(
            TenantId: tenantId,
            {EntityName}Id: Id));
    }

    public void Update(/* changed fields */)
    {
        // Apply changes here
        UpdatedAt = DateTimeOffset.UtcNow;
        AddDomainEvent(new {EntityName}UpdatedEvent(
            TenantId: TenantId,
            {EntityName}Id: Id));
    }

    public void Delete()
    {
        AddDomainEvent(new {EntityName}DeletedEvent(
            TenantId: TenantId,
            {EntityName}Id: Id));
    }
}


// ── Status enum ───────────────────────────────────────────────────────────────
// Place in: src/ByteDesk.Shared.Contracts/Enums/{EntityName}Status.cs
// (In a separate file — shown here for reference)

public enum {EntityName}Status
{
    Active,
    Inactive,
    Archived,
    // Add domain-specific statuses
}


// ── EF Core configuration in OnModelCreating ─────────────────────────────────
// Add to: src/ByteDesk.{Service}/Data/{Service}DbContext.cs
// Or in a separate IEntityTypeConfiguration<{EntityName}> class

/*
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    base.OnModelCreating(modelBuilder);

    modelBuilder.Entity<{EntityName}>(entity =>
    {
        // ── Table ─────────────────────────────────────────────────────────────
        entity.ToTable("{entity_names}"); // snake_case plural

        // ── Primary key ───────────────────────────────────────────────────────
        entity.HasKey(e => e.Id);

        // ── Required + max length ─────────────────────────────────────────────
        entity.Property(e => e.Name).IsRequired().HasMaxLength(255);

        // ── Status as string (not int) ────────────────────────────────────────
        entity.Property(e => e.Status).HasConversion<string>();

        // ── JSONB column ──────────────────────────────────────────────────────
        entity.Property(e => e.Metadata).HasColumnType("jsonb");

        // ── Indexes ───────────────────────────────────────────────────────────
        entity.HasIndex(e => e.TenantId);                    // Tenant filter — always
        // entity.HasIndex(e => e.ParentEntityId);            // FK — always index FKs
        entity.HasIndex(e => new { e.TenantId, e.Status });  // Composite — if filtered together
        entity.HasIndex(e => e.CreatedAt);                   // If sorted by creation date

        // ── FK relationships ──────────────────────────────────────────────────
        // entity.HasOne(e => e.ParentEntity)
        //     .WithMany(p => p.{EntityName}s)
        //     .HasForeignKey(e => e.ParentEntityId)
        //     .OnDelete(DeleteBehavior.Restrict);  // Never Cascade on meaningful data
    });
}
*/


// ── Domain events ─────────────────────────────────────────────────────────────
// Place in: src/ByteDesk.Shared.Contracts/Events/{EntityName}Events.cs
// (Shown here for reference — move to Shared.Contracts)

/*
using ByteDesk.Shared.Contracts.Messages;
using MassTransit;

namespace ByteDesk.Shared.Contracts.Events;

// All events implement ICorrelatedMessage (TenantId + CorrelationId envelope)
public record {EntityName}CreatedEvent(
    Guid TenantId,
    Guid {EntityName}Id,
    Guid CorrelationId = default) : ICorrelatedMessage;

public record {EntityName}UpdatedEvent(
    Guid TenantId,
    Guid {EntityName}Id,
    Guid CorrelationId = default) : ICorrelatedMessage;

public record {EntityName}DeletedEvent(
    Guid TenantId,
    Guid {EntityName}Id,
    Guid CorrelationId = default) : ICorrelatedMessage;
*/


// ── Migration command (run after entity is complete) ─────────────────────────
// cd src
// dotnet ef migrations add Add{EntityName} \
//   --project ByteDesk.{Service} \
//   --startup-project ByteDesk.{Service} \
//   --output-dir Data/Migrations
//
// Review Up() and Down() before committing.
// ─────────────────────────────────────────────────────────────────────────────