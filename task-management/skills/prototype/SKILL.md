---
name: prototype
description: Throwaway prototype that answers one design question (look or behave). HITL — a human picks the variant. Resolves decision:prototype tickets. Use for /prototype, "how should this look", "does this state model feel right".
user-invokable: true
argument-hint: "[TM-id or the question]"
---

# Prototype

Throwaway code that answers **one** question. Mark it as prototype. Trivial to run. No tests, no polish, no persistence by default.

- Logic / state model → one shareable HTML file that surfaces state after every action.
- Look / UI → several radically different variants, switchable, human chooses.

`.bytedesk/task-management/bin/tm worktree` is the isolation primitive. Capture the prototype **off main**. Attach the path/branch as `tm_evidence`.

**The agent must not pick the variant.** If the user is AFK, leave the ticket open.

AC: "a human chose a variant and the pointer is stored as evidence." Then write `## Answer` and `tm_task_update` done.
