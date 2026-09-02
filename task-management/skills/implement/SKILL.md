---
name: implement
description: Build one implementation ticket — claim, TDD at agreed seams, attach evidence, tick acceptance, then done. Use when a ready-for-agent task is startable, or the user says /implement.
user-invokable: true
argument-hint: "[TM-id]"
---

# Implement

For **implementation** tickets only (`ready-for-agent`, no `decision:*`).

1. `tm_show` / `tm_handoff`. `tm_claim` (or start) before edits.
2. Agree seams. Red → green one slice at a time. AC is the spec; a failing-then-passing test is `tm_evidence`.
3. Tick each criterion only when verified (`tm_ac_accept`).
4. Optional: two-axis review (standards vs this ticket/`epic.plan`); attach as evidence.
5. `tm_task_update` done. Never leave `in_progress` at session end.

Do not implement `decision:*` tickets — those are `/interview`, `/research`, `/prototype`.

A `ready-for-agent` card this session should **not** implement: [[dispatch]] (one
shot) or [[pool]] (loop). After the worker exits: [[collect]], then [[events]].
Probe the host with [[caps]] first.
