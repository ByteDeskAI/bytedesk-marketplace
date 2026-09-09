# TM-130 — patch for `topology/lib/supervision.mjs` (one comment)

Integrator-owned, so this is the change I want rather than an edit I made. It is the other half of
the rename: `delivery.mjs` now points at this ladder, and this one should point back, so a reader
who lands on either knows the other exists without grepping.

**Context — `topology/lib/supervision.mjs:32-39` (main @ `ebc92e3`):**

```js
export const SLEEP_LADDER_MS = [2000, 5000, 15000];
...
export function nextRung(rung, activity) {
  return activity ? 0 : Math.min(rung + 1, SLEEP_LADDER_MS.length - 1);
}
```

**Change — add above `nextRung`:**

```js
/**
 * The reconcile loop's backoff: an index into `SLEEP_LADDER_MS`, reset to 0 by any activity.
 *
 * Not to be confused with `delivery.mjs`'s `nextDeliveryRung`, which is a different ladder
 * entirely — the retry rungs for one message's doorbell (`resubmit` / `retype` / `wait-safe` /
 * `escalate`). That one was renamed away from this name for exactly this reason; nothing imports
 * both, so the hazard was always to the reader rather than to the code.
 */
```

Nothing else in this file changes.
