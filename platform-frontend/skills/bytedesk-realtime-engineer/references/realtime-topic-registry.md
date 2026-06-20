# Realtime Topic Registry Reference

Use this when adding or changing browser topic routing in `ByteDesk.Realtime`.

## Required Touch Points

1. Add a `RealtimeTopicKind` enum member when the resource family is new.
2. Add a `ResolvePlatformTopic(...)` branch for product topics or `ResolveAdminFeed(...)` for admin-only feeds.
3. Map public topic -> private Redis channel using server-side tenant context.
4. Set `RequiresAuth`, `RequiresTenantMatch`, and `RequiresPlatformAdmin` deliberately.
5. Configure replay:
   - no replay: `StateKey = null`, `HistoryKey = null`, `HistoryCount = 0`
   - snapshot: set `StateKey`
   - bounded list replay: set `HistoryKey` and `HistoryCount`
   - stream replay: `SourceType = Stream`, `HistoryCount > 0`
6. Add or update payload filtering if tenant/company/resource authorization needs payload inspection.

## Product Topic Sketch

```csharp
if (topic.StartsWith("resource:", StringComparison.Ordinal))
{
    return new RealtimeTopicResolution(
        Topic: topic,
        Kind: RealtimeTopicKind.Resource,
        RedisChannel: $"resource:{tenant}:{resourceId}",
        SourceType: RealtimeTopicSourceType.PubSub,
        StateKey: $"resource:{tenant}:{resourceId}:state",
        HistoryKey: $"resource:{tenant}:{resourceId}:history",
        HistoryCount: 50,
        RequiresAuth: true,
        RequiresTenantMatch: true,
        RequiresPlatformAdmin: false,
        AdditionalChannels: []);
}
```

## Admin Topic Sketch

```csharp
"resource:ops" => new RealtimeTopicResolution(
    Topic: topic,
    Kind: RealtimeTopicKind.ResourceOps,
    RedisChannel: "resource:ops:events",
    SourceType: RealtimeTopicSourceType.PubSub,
    StateKey: null,
    HistoryKey: "resource:ops:history",
    HistoryCount: 200,
    RequiresAuth: true,
    RequiresTenantMatch: false,
    RequiresPlatformAdmin: true,
    AdditionalChannels: [])
```

## Gateway Rule

Do not add a per-topic Gateway proxy. Browser realtime should flow through:

- `/hubs/platform`
- `/hubs/admin`
- `/api/realtime/admin/*` for admin REST operations

Any new `text/event-stream`, `/api/*/events`, or custom `/ws` route needs explicit pushback.
