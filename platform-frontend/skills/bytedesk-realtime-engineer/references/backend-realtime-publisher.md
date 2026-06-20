# Backend Realtime Publisher Reference

Use this when a service owns the event source for a browser realtime topic.

## Contract

- Publish JSON projection events to Redis. The browser contract is SignalR, not the service endpoint.
- Tenant-scoped channels include tenant id: `{family}:{tenantId}:{resourceId}`.
- Serialize with `JsonDefaults.Options` or the shared ByteDesk JSON options.
- Keep event payloads UI-safe: `type`, `timestamp`, tenant/resource ids, and the minimal state the UI needs.
- Store replay only when the UX needs it:
  - latest snapshot: Redis hash field `data`
  - bounded history: Redis list with `ListTrimAsync`
  - stream cursor replay: Redis Stream via `StreamAddAsync`

## Pub/Sub + State + History Sketch

```csharp
using System.Text.Json;
using ByteDesk.Shared.Infrastructure.Api;
using StackExchange.Redis;

public sealed class ResourceEventPublisher(IConnectionMultiplexer redis)
{
    public async Task PublishAsync(
        Guid tenantId,
        Guid resourceId,
        string type,
        string message,
        CancellationToken ct = default)
    {
        var db = redis.GetDatabase();
        var channel = $"resource:{tenantId}:{resourceId}";
        var stateKey = $"resource:{tenantId}:{resourceId}:state";
        var historyKey = $"resource:{tenantId}:{resourceId}:history";

        var payload = JsonSerializer.Serialize(new
        {
            type,
            tenantId,
            resourceId,
            message,
            timestamp = DateTimeOffset.UtcNow,
        }, JsonDefaults.Options);

        await db.HashSetAsync(stateKey, "data", payload);
        await db.ListRightPushAsync(historyKey, payload);
        await db.ListTrimAsync(historyKey, -50, -1);
        await db.KeyExpireAsync(historyKey, TimeSpan.FromHours(1));
        await redis.GetSubscriber().PublishAsync(RedisChannel.Literal(channel), payload);
    }
}
```

## Stream Sketch

Use Redis Streams when the client needs cursor replay through `lastEventId`.

```csharp
await db.StreamAddAsync(
    $"chat:{tenantId}:{conversationId}",
    [
        new NameValueEntry("event", payload),
    ]);
```

Then set `SourceType = RealtimeTopicSourceType.Stream` in `RealtimeTopicRegistry`.

## Checks

- Do not add a browser-facing `/events` endpoint.
- Do not publish global product channels unless the feed is explicitly platform-admin scoped.
- Do not put secrets, access tokens, or internal stack traces in projection payloads.
