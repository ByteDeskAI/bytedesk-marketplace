# Integration Flow Review Examples

## Event Fanout

```text
Use Event Message on a Publish-Subscribe Channel. Add Durable Subscriber for consumers that cannot miss events. Every consumer should implement Idempotent Receiver because broker redelivery is expected. Add Correlation Identifier and Message History for support.
```

## Command Queue

```text
Use Command Message on a Point-to-Point Channel with Competing Consumers if throughput matters. Define retry limits, a Dead Letter Channel, and idempotency before scaling consumers. Test duplicate delivery and poison messages.
```

## Dynamic Routing

```text
Use Content-Based Router if route choice comes from message fields. Use Recipient List if one message can go to multiple computed destinations. Keep routing rules observable and version controlled; avoid hiding business policy in producer code.
```

## Large Payload

```text
Use Claim Check when payloads are too large or sensitive for the broker. The message carries a secure reference, while storage owns retention, authorization, and cleanup. Test missing, expired, and unauthorized claims.
```

