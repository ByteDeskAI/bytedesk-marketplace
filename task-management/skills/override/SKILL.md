---
name: override
description: Bypass the next task-management gate once (no active epic, WIP limit, unmet acceptance criteria, or a blocking Stop), with the reason recorded in the audit log. Use when a gate is wrong for the situation and the user wants through anyway — "override", "skip the gate", "/override", "just let me create the task".
user-invokable: true
argument-hint: "<reason for the bypass>"
---

# Override

The gates exist so work doesn't evaporate. They are also occasionally wrong. This is
the sanctioned way through — one gate, once, with a reason on the record.

## Process

1. **Ask what's actually being bypassed** and whether the cheap fix is faster:
   - No active epic → `tm epic use <id>` is usually one command.
   - WIP limit → closing or parking a task is usually the right answer.
   - Unmet acceptance criteria → if the criterion is genuinely satisfied, tick it
     (`tm accept <id> <n>`); overriding here hides an unverified close.
2. `tm override "<reason>"` — arms a one-shot token. The next gate passes and clears it.
3. Retry the action that was blocked.

## Escalation

- Persistently wrong gate → change the policy, not the token:
  `tm config requireEpic false` · `tm config wipLimit 5` · `tm config requireAcceptance false`
- Total shutdown (debugging the plugin itself): `TM_ENFORCE=off` in the environment.
- The Stop gate already self-releases: it never blocks twice in a row on the same tasks.

## Notes

- Every override is written to `events.jsonl` with its reason — that log is the point.
  A reason like "unspecified" is a smell; write the real one.
- Related: [[board]], [[epic]].
