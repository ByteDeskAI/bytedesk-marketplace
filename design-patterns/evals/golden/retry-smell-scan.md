# Retry Smell Scan

## Findings
- P1: Unbounded Retry. The worker retries forever without a terminal failure policy.
- P1: Naive Exactly Once. The worker assumes redelivery will not duplicate side effects.

## Pattern Response
- Add Idempotent Receiver with a stable business or message key.
- Add Dead Letter Channel for exhausted failures.
- Add Message Expiration when stale work is no longer useful.
- Consider Guaranteed Delivery only with duplicate handling and support ownership.

## Verification
- Duplicate delivery does not repeat side effects.
- Poison messages stop retrying and become visible.
- Retry count, terminal failure, and replay actions are observable.
