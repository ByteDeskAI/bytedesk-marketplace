// ── TEMPLATE: ByteDesk Tool Action Command ────────────────────────────────────
// Copy to: src/ByteDesk.Shared.Contracts/Commands/{ToolName}Command.cs
// Replace ALL placeholders: {ToolName}, plus add domain-specific input fields
//
// Canonical reference: src/ByteDesk.Shared.Contracts/Commands/MarketResearchCommand.cs
// Rules: .claude/rules/backend.md §Tool Action Pattern
// ─────────────────────────────────────────────────────────────────────────────

namespace ByteDesk.Shared.Contracts.Commands;

/// <summary>
/// Command dispatched by the {ToolName} endpoint → consumed by {ToolName}Consumer.
///
/// Required fields (always):
///   TenantId     — tenant isolation; consumers must not assume ambient context
///   JobId        — links consumer back to the pre-created Job record
///   CorrelationId — tracing envelope (ICorrelatedMessage)
///
/// Add domain-specific input fields below (the ones the user submitted).
/// Keep them flat — no nested objects in commands. Use primitive types.
/// </summary>
public record {ToolName}Command(
    Guid TenantId,
    Guid JobId,
    // ── Add your domain inputs here ──────────────────────────────────────────
    string InputFieldOne,           // e.g. string Keyword, string Url, string Industry
    int OptionalInputField = 0,     // optional int with default
    // ─────────────────────────────────────────────────────────────────────────
    Guid CorrelationId = default) : ICorrelatedMessage
{
    public Guid CorrelationId { get; init; } = CorrelationId == default ? Guid.NewGuid() : CorrelationId;
}

// ── Notes ────────────────────────────────────────────────────────────────────
// 1. ICorrelatedMessage is in ByteDesk.Shared.Contracts — no using needed in same assembly
// 2. CorrelationId MUST be the last positional parameter, with default
// 3. Do NOT put complex types (List<>, nested records) in commands — flatten them
// 4. The endpoint serializes the raw input to JsonDocument for Job.Input storage,
//    then maps the same values to command fields — keep them in sync
