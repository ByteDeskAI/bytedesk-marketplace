---
name: enhance-track
description: Move capabilities through their lifecycle with evidence — accept a proposal into a task, mark one shipped, or drop it. Use post-merge, when the user says "we shipped CAP-X", when auditing which proposals actually landed, or as the closing step of /enhance.
user-invokable: false
---

# Enhance — track

## Lifecycle

| Card says | Store status | Verb |
|---|---|---|
| proposed | `open` | `tm cap new` |
| accepted / building | `in_progress` | `tm cap accept <id>` → mints the task |
| shipped | `done` | `tm cap ship <id>` |
| dropped | `deleted` | `tm cap drop <id> "<why>"` |

There is no separate index to keep in sync — the store is the registry.

## Accept

```bash
tm cap accept CAP-0046      # → TM-0xx, acceptance criteria carried over as its gate
```

The task links back to the capability, so the reason for the work survives the session that
proposed it. Only accept what the user has agreed to build.

## Ship

`tm cap ship` refuses without evidence, deliberately — a capability is never shipped on
assertion. Attach it first:

```bash
tm evidence CAP-0046 test/jump_palette_test.go
tm cap ship CAP-0046
```

Good evidence: a commit SHA, a test path, a passing deploy/cutover record, an operator
confirmation. Not good evidence: "the code looks done".

## Audit pass (post-merge)

1. `tm cap list --status open` and `--status in_progress`.
2. For each, check its acceptance criteria against the tree — files, tests, docs. Title
   similarity is not completion; a capability whose criteria are unmet stays open even if
   something adjacent shipped.
3. Ship what genuinely landed, with evidence. Say plainly which ones you left open and why.
4. At most **one** follow-on proposal per high-impact shipped capability, via
   [[enhance-propose]] rules — adjacent and smaller, not an expansion pack.
5. If the product's surfaces changed, refresh `product-state.md` ([[enhance-capture]]).
6. Summarize: shipped N, still open M, follow-ons proposed K.

## Do not

- Mark shipped without evidence.
- Auto-implement follow-ons.
