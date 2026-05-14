---
slug: python-idempotent-receiver
name: Python Idempotent Receiver
language: python
patterns:
  - idempotent-receiver
---

# Python Idempotent Receiver

## Use
- Use a stable business key or message id.
- Store processed keys before or atomically with side effects.
- Make replay observable and safe.

## Example
```python
async def handle_order_created(message: OrderCreated, store: ProcessedMessageStore) -> None:
    key = f"order-created:{message.order_id}:{message.event_id}"
    async with store.transaction() as tx:
        if await tx.has_processed(key):
            return
        await reserve_inventory(message.order_id)
        await tx.mark_processed(key)
```

## Tests
- Deliver the same message twice and assert side effects happen once.
- Simulate a crash between side effect and processed-key write.
- Confirm replay logs include correlation id and idempotency key.
