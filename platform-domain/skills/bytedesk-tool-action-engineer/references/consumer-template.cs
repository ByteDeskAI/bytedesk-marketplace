// ── TEMPLATE: ByteDesk Tool Action Consumer ───────────────────────────────────
// Copy to: src/ByteDesk.Tools/Consumers/{ToolName}Consumer.cs
// Replace ALL placeholders: {ToolName}, plus implement ProcessAsync logic
//
// Canonical reference: src/ByteDesk.Tools/Consumers/MarketResearchConsumer.cs
// Rules: .claude/rules/backend.md §Tool Action Pattern, §Consumers
// ─────────────────────────────────────────────────────────────────────────────

using System.Text.Json;
using ByteDesk.Shared.Contracts.Commands;
using ByteDesk.Shared.Contracts.Enums;
using ByteDesk.Shared.Infrastructure.Api;
using ByteDesk.Shared.Infrastructure.Messaging;
using ByteDesk.Tools.Services;
// using ByteDesk.Tools.Services.{ToolName};  // Add your service namespace
using MassTransit;

namespace ByteDesk.Tools.Consumers;

public class {ToolName}Consumer(
    IJobService jobService,
    IJobLogger jobLogger,
    // I{ToolName}Pipeline pipeline,   // Inject your service/pipeline here
    ILogger<{ToolName}Consumer> logger)
    : BaseConsumer<{ToolName}Command>(logger)
{
    protected override async Task ProcessAsync(ConsumeContext<{ToolName}Command> context)
    {
        var message = context.Message;

        // 1. Mark the job as running
        await jobService.UpdateJobStatusAsync(message.JobId, JobStatus.Running);
        await jobLogger.LogAsync(message.JobId, "info",
            $"Starting {ToolName} for '{message.InputFieldOne}'...");

        try
        {
            // 2. Do the actual work — log progress steps as you go
            // await jobLogger.LogAsync(message.JobId, "info", "Stage 1: Fetching data...");
            // var result = await pipeline.ExecuteAsync(message.InputFieldOne, jobLogger, message.JobId, context.CancellationToken);

            // 3. Serialize result to JsonDocument — ALWAYS use JsonDefaults.Options
            //    Serialize the canonical result DTO directly; don't project an anonymous subset
            //    (anonymous objects drift from shared contracts and drop diagnostics the frontend expects)
            // var output = JsonDocument.Parse(
            //     JsonSerializer.Serialize(result, JsonDefaults.Options));

            // 4. Mark job completed with output
            // await jobService.UpdateJobStatusAsync(message.JobId, JobStatus.Completed, output);

            Logger.LogInformation(
                "{ToolName} completed for '{Input}', job {JobId}",
                message.InputFieldOne, message.JobId);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "{ToolName} failed for job {JobId}", message.JobId);
            await jobLogger.LogAsync(message.JobId, "error", "{ToolName} failed", ex.Message);
            await jobService.UpdateJobStatusAsync(message.JobId, JobStatus.Failed, error: ex.Message);
            throw; // Re-throw so MassTransit retry policy applies
        }
    }

    /// <summary>
    /// Idempotency guard — if the job was already processed (e.g. due to retry),
    /// return true and BaseConsumer will skip ProcessAsync silently.
    /// </summary>
    protected override async Task<bool> IsAlreadyProcessedAsync(ConsumeContext<{ToolName}Command> context)
    {
        var job = await jobService.GetJobAsync(context.Message.JobId);
        return job?.Status is not (JobStatus.Pending or null);
    }
}

// ── Notes ────────────────────────────────────────────────────────────────────
// 1. NEVER implement IConsumer<T> directly — always extend BaseConsumer<T>
// 2. BaseConsumer handles retry-safe logging + error handling boilerplate
// 3. Every IJobLogger.LogAsync call is projected live to the job detail SignalR topic
// 4. Serialize with JsonDefaults.Options — NOT bare JsonSerializer.Serialize()
//    (bare serialize produces PascalCase, breaks frontend contract)
// 5. Throw exceptions after logging — MassTransit applies exponential backoff (5s→45s, max 3 retries)
// 6. Register in Program.cs: x.AddConsumer<{ToolName}Consumer>();