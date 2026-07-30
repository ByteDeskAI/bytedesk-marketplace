---
name: enhance-propose
description: Turn research into ranked capability cards in the task store (tm cap new), each sized by impact/effort/confidence with checkable acceptance criteria. Use during /enhance or when the user asks for enhancement ideas, a product backlog, or "what should we build next".
user-invokable: false
---

# Enhance — propose

## Inputs

`.bytedesk/task-management/product-state.md`, the newest pack under
`.bytedesk/task-management/research/`, and `tm cap list` — the backlog that already exists.

## Steps

1. `tm cap list` and read it properly. Every open capability is a problem already claimed;
   a near-duplicate under a new title is the most common way this backlog rots.
2. Diff state + research against that list. Propose only genuinely new problems.
3. Draft 5–15. Each one needs a problem worth a sentence, a concrete slice, acceptance
   criteria a command can settle, and at least one evidence seed (a path or a URL).
4. Write each with `tm cap new`:

```bash
tm cap new "Jump palette operator cheatsheet" \
  --area ux --impact H --effort S --confidence H --source research
```

Then fill the card body (problem / current state / proposal / acceptance criteria / non-goals)
with `tm edit <CAP-id> --body -`, or write the sections through `tm_cap_propose`, which takes
`problem`, `current`, `proposal`, `criteria[]` and `nonGoals[]` directly.

5. Report the ranking to the user: id | title | impact | effort | confidence | one-line why.
   Recommend the **top 3 only**, and stop. Accepting is the user's call:
   `tm cap accept <CAP-id>` mints the task and carries the acceptance criteria across as its gate.

## Sizing

Impact and confidence are **H/M/L**; effort is **S/M/L**.

| impact | | effort | | confidence | |
|---|---|---|---|---|---|
| **H** | outage, data loss, security hole, or a core job blocked | **S** | one PR, clear acceptance | **H** | evidenced |
| **M** | frequent operator friction; reliability or clarity gaps | **M** | design + implement | **M** | reasoned |
| **L** | polish, power-user convenience | **L** | multi-PR, architectural | **L** | speculative |

Score is `impact × ease × confidence` — 1 to 27, so a person can check it by eye. Effort is
inverted: cheap is good. A speculative architectural rewrite scores 3; a high-impact, cheap,
well-evidenced win scores 27.

Do not inflate confidence to promote a favourite. A low-confidence idea proposed honestly at
`--confidence L` sits low in the list and keeps its research follow-up; a dishonest `H`
outranks work that is actually ready.

## Do not

- Implement anything. Proposing is not committing.
- Propose a capability whose acceptance criteria you cannot state.
