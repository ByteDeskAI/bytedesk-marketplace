---
name: spec
description: Collapse a decision map or the current thread into a buildable spec in .bytedesk/task-management/plans/ and set epic.plan. Use after a map is clear, or when deciding is already done. Do not interview; synthesise.
user-invokable: true
argument-hint: "[EP-id of the map, or omit for this thread]"
---

# Spec

Do **not** interview. Synthesise what is already known (map Decisions so far, ADRs, this thread).

Write `plans/<date>-<slug>.md` (or let ExitPlanMode capture). Point the epic at it (`epic.plan`). Sections: problem, solution, user stories, implementation decisions (no stale file paths), testing decisions, out of scope.

This is not implementation. Next is `/task-management:tickets`.
