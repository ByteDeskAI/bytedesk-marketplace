// ── TEMPLATE: ByteDesk Tool Action Endpoint ───────────────────────────────────
// Copy to: src/ByteDesk.Tools/Endpoints/{ToolName}Endpoints.cs
// Replace ALL placeholders: {ToolName}, {toolName}, {kebab-name}
//
// Canonical reference: src/ByteDesk.Tools/Endpoints/MarketResearchEndpoints.cs
// Rules: .claude/rules/backend.md §Endpoints, §Tool Action Pattern
// ─────────────────────────────────────────────────────────────────────────────

using System.Text.Json;
using ByteDesk.Shared.Contracts.Commands;
using ByteDesk.Shared.Contracts.Enums;
using ByteDesk.Shared.Infrastructure.Api;
using ByteDesk.Tools.Services;
using MassTransit;
using Microsoft.AspNetCore.Mvc;

namespace ByteDesk.Tools.Endpoints;

public static class {ToolName}Endpoints
{
    public static RouteGroupBuilder Map{ToolName}Endpoints(this RouteGroupBuilder group)
    {
        // Optional: add rate limiting if this calls expensive external APIs
        // group.MapPost("/", Start{ToolName}Async).RequireRateLimiting("{kebab-name}");
        group.MapPost("/", Start{ToolName}Async);

        return group;
    }

    private static async Task<IResult> Start{ToolName}Async(
        [FromBody] {ToolName}Request request,
        IJobService jobService,
        IPublishEndpoint publishEndpoint)
    {
        // 1. Serialize request fields into a JsonDocument for Job.Input storage.
        //    This is the permanent record of what was requested — keep it complete.
        //    ALWAYS use JsonDefaults.Options (camelCase, omit nulls)
        var input = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            request.InputFieldOne,
            request.OptionalInputField,
        }, JsonDefaults.Options));

        // 2. Create the job FIRST (before publishing) — establishes the job record
        var job = await jobService.CreateJobAsync(JobType.{ToolName}, input);

        // 3. Publish the command to the message bus — consumer picks it up asynchronously
        await publishEndpoint.Publish(new {ToolName}Command(
            Guid.Empty,             // TenantId — resolved from HTTP context in production
            job.Id,
            request.InputFieldOne,
            request.OptionalInputField));

        // 4. Return 202 Accepted with job ID + polling location
        return ApiResults.Accepted(job.Id.ToString(), $"/api/tools/jobs/{job.Id}");
    }
}

/// <summary>
/// Request DTO — record type, validated by Minimal API.
/// Add [Required] attributes for mandatory fields.
/// </summary>
public record {ToolName}Request(
    string InputFieldOne,
    int OptionalInputField = 0
);

// ── Program.cs changes needed ─────────────────────────────────────────────────
// In builder.Services section (MassTransit configuration):
//   x.AddConsumer<{ToolName}Consumer>();
//
// In endpoint group mapping section:
//   app.MapGroup("/api/tools/{kebab-name}").Map{ToolName}Endpoints();
//
// ── Gateway changes needed ────────────────────────────────────────────────────
// The YARP reverse proxy in ByteDesk.Gateway auto-routes /api/tools/* to the Tools service.
// No gateway changes needed. If this tool needs a new browser live feed,
// use /bytedesk-realtime-engineer and route it through ByteDesk.Realtime.