---
name: bytedesk-realtime-engineer
description: ByteDesk browser realtime engineer for SignalR and ByteDesk.Realtime. Invoke whenever the user wants live updates, realtime streams, SignalR topics, push updates, polling replacement, topic registry work, Redis projection events, replay/state/history wiring, agent/chat/job/deployment live feeds, admin realtime diagnostics, or an audit for banned browser SSE/EventSource/raw WebSocket patterns. Use this instead of implementing SSE directly; ByteDesk browser realtime is Redis projection events -> ByteDesk.Realtime -> SignalR -> useTopic/useAdminTopic.
user-invokable: true
argument-hint: "[service] [resource] | --audit"
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

Wire or audit browser-facing realtime using the canonical ByteDesk SignalR pattern.

**Read `.claude/rules/realtime.md` before touching any file.** ADR-0032 is authoritative: browser realtime uses `ByteDesk.Realtime` + SignalR. ADR-0012 is historical context only.

## Canonical Pattern

| Layer | What | Common files |
|---|---|---|
| Domain/service publisher | Publish tenant/resource-scoped projection events to Redis, optionally update state/history keys | `src/ByteDesk.{Service}/Services/**` |
| Realtime service | Resolve typed topics, authorize, replay state/history, bridge Redis Pub/Sub or Streams to SignalR | `src/ByteDesk.Realtime/Topics/RealtimeTopicRegistry.cs`, `src/ByteDesk.Realtime/Messaging/RealtimeTopicBridge.cs` |
| Gateway | Normal YARP proxy for `/hubs/*` and `/api/realtime/admin/*`; no browser SSE proxy routes | `src/ByteDesk.Gateway/**` |
| Frontend | Subscribe through shared SignalR client hooks | `src/ByteDesk.Web/src/lib/ws/use-topic.ts`, `src/ByteDesk.Web/src/lib/ws/use-admin-topic.ts` |

Canonical examples:
- Product topic hook: `src/ByteDesk.Web/src/lib/hooks/use-dev-server-events.ts`
- Agent log hook: `src/ByteDesk.Web/src/lib/hooks/use-agent-log.ts`
- Topic registry: `src/ByteDesk.Realtime/Topics/RealtimeTopicRegistry.cs`
- Bridge/replay behavior: `src/ByteDesk.Realtime/Messaging/RealtimeTopicBridge.cs`

## Running Modes

### Audit mode
`/bytedesk-realtime-engineer`

Scan for realtime violations and opportunities. Output findings only unless the user asked for implementation.

### Service mode
`/bytedesk-realtime-engineer {service}`

Audit or wire all realtime gaps in one service.

### Resource mode
`/bytedesk-realtime-engineer {service} {resource}`

Wire one resource end to end: publisher -> topic registry -> frontend hook/component.

## Step 1 - Survey

Always survey before changing realtime code:

```bash
# Browser transport violations
rg -n "new EventSource|EventSource\\(|text/event-stream|ReadableStream|getReader\\(|new WebSocket|WebSocket\\(" src/ByteDesk.Web/src src/ByteDesk.Gateway src/ByteDesk.* -g '*.ts' -g '*.tsx' -g '*.cs'

# Polling that may need SignalR
rg -n "refetchInterval" src/ByteDesk.Web/src -g '*.ts' -g '*.tsx'

# Existing frontend realtime usage
rg -n "useTopic|useAdminTopic|ReceiveTopicEvent|ReceiveAiChatEvent" src/ByteDesk.Web/src -g '*.ts' -g '*.tsx'

# Existing Realtime registry and topic bridge coverage
rg -n "RealtimeTopicKind|ResolvePlatformTopic|ResolveAdminFeed|RedisChannel|HistoryKey|StateKey" src/ByteDesk.Realtime -g '*.cs'

# Service Redis publishers and channel naming
rg -n "PublishAsync|StringSetAsync|HashSetAsync|ListRightPushAsync|StreamAddAsync|tools:|devserver:|deploy:|database:|chat:|agentlog:|office:" src -g '*.cs'

# Gateway should only proxy hubs/admin realtime, not browser SSE routes
rg -n "hubs|event-stream|/events|Sse|SSE" src/ByteDesk.Gateway -g '*.cs'
```

Classify findings:
- **P0 violation**: browser `EventSource`, raw browser WebSocket, new `text/event-stream`, custom `/ws`, global tenant-agnostic product topic, or bare resource-id Redis channel.
- **P1 wire now**: `refetchInterval` where latency matters and a Redis publisher or durable event source already exists.
- **P2 design first**: live UX needed but no publisher/event shape exists yet.
- **P3 compliant**: uses `useTopic`/`useAdminTopic`, topic registry authorization, tenant/resource channel naming, and optional replay intentionally.

## Step 2 - Decide

Before wiring, settle these questions from code or by asking the user:

1. What user-visible changes should stream live?
2. Does an existing service already publish Redis events for this resource?
3. Should the topic use Pub/Sub, Redis Stream, state snapshot, bounded history, or some combination?
4. Is the topic product-scoped (`useTopic`) or platform-admin-only (`useAdminTopic`)?
5. What tenant/resource authorization rule must `RealtimeTopicRegistry` enforce?

Do not add a topic until the publisher, topic name, authorization scope, and frontend consumer are known.

## Step 3 - Wire

Use the bundled references only as starting points:
- `references/backend-realtime-publisher.md`
- `references/realtime-topic-registry.md`
- `references/frontend-signalr-hook.ts`

Implementation rules:
- Services publish projection events to Redis; they do not expose new browser-facing SSE endpoints.
- Product topics must resolve tenant/resource scope server-side in `RealtimeTopicRegistry`.
- Use `SourceType.PubSub` for live projection events; use `SourceType.Stream` when Redis Stream cursor replay is needed.
- Use `StateKey` for latest snapshot and `HistoryKey`/`HistoryCount` for bounded replay only when the UX needs it.
- Gateway changes are normally unnecessary unless `/hubs/{**catch-all}` or `/api/realtime/admin/{**catch-all}` proxying is missing.
- Frontend code composes domain hooks around `useTopic` or `useAdminTopic`; never instantiate SignalR connections per component.
- REST remains for initial snapshots, commands, and mutations; SignalR carries projections.

## Compliance Checklist

- [ ] `.claude/rules/realtime.md` and ADR-0032 were read.
- [ ] No new browser-facing SSE endpoint, `EventSource`, raw browser WebSocket, or custom Gateway topic bridge.
- [ ] Redis channel includes tenant id for tenant-scoped resources.
- [ ] `RealtimeTopicRegistry` resolves the topic with correct `Kind`, `SourceType`, auth flags, state/history keys, and admin/product split.
- [ ] Payload filtering/authorization cannot leak cross-tenant or cross-company data.
- [ ] Frontend uses shared `useTopic`/`useAdminTopic`.
- [ ] Topic hook is shared at the owning surface and passed down as props when needed.
- [ ] Replay semantics are explicit: none, state snapshot, bounded history, or stream cursor replay.
- [ ] Tests or focused static checks cover the changed publisher/registry/hook behavior.

## Report Format

```markdown
## Realtime Engineer Run - {DATE}

### Findings
| Resource | Status | Action |
|---|---|---|
| development/devserver | P3 compliant | Uses devserver:{projectId} via useTopic |
| tools/jobs | P1 wire | Add/repair topic registry or frontend hook |

### Changes
- Publisher: {service/channel/state/history}
- Registry: {topic kind/source/auth/replay}
- Frontend: {hook/component subscription}

### Verification
- {commands or checks run}

### Follow-ups
- {items intentionally left out of scope}
```
