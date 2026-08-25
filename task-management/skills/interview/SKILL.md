---
name: interview
description: Relentless HITL interview that records decisions on a task (and ADRs when they are hard to reverse). Resolves decision:interview tickets. Use for /interview, grilling a plan, sharpening a destination, or single-session planning that is not big enough for /map.
user-invokable: true
argument-hint: "[TM-id to resolve, or a loose idea]"
---

# Interview

Facts are the agent's job; **decisions are the user's**. Do not answer your own questions.

## Rounds

Map a **design tree**. Each round, ask the whole **frontier** (questions whose prerequisites are settled). Number them, recommend an answer, **wait**.

```
❓ **Q1** - **<title>**: <body>

➡️ <recommended answer>
```

Lookup facts with subagents; don't ask the user what you can read. Done when the frontier is empty **and** the user confirms shared understanding. Then do not implement until they say so.

## Recording

- If a `decision:interview` task is in play: write `## Answer` on it, tick its AC, attach nothing that is a product build.
- Hard-to-reverse trade-offs: `tm_adr_new`. Do not create `docs/adr/` or `CONTEXT.md` unless the consuming repo already uses them.

## With /map

Charting a map starts here (destination first, then breadth-first). Resolving a map ticket uses the same rounds; the answer lives on that ticket.
