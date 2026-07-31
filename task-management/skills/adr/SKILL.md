---
name: adr
description: Write an architecture decision record into .bytedesk/task-management/adrs/, or finish one of the stubs the AskUserQuestion hook drafted automatically. Use when a real decision gets made — a tradeoff, a rejected alternative, a constraint the team must not relitigate — or when the user says "record this decision", "write an ADR", "/adr".
user-invokable: true
argument-hint: "[decision title, or an ADR-id to finish]"
---

# ADR

Decisions made in a session evaporate unless they're written down. Every
`AskUserQuestion` already drafts a stub automatically — this skill finishes those
and writes deliberate ones.

## Process

1. **Check for an existing stub first**: `tm find <topic>` or look in
   `.bytedesk/task-management/adrs/`. Auto-captured stubs have `status: proposed` and a
   `_TODO_` consequences section. Finish the stub rather than writing a duplicate.
2. New one: `tm adr new "<title>"` — titles state the decision
   ("Markdown files are the source of truth"), not the topic ("storage").
3. **Fill the three sections** in the created file:
   - **Context** — the forces: what was true, what was constrained, what we knew.
   - **Decision** — what we chose, stated in the active voice, plus the alternatives
     rejected *and why*. The rejected options are the load-bearing part.
   - **Consequences** — what this makes easy, what it makes hard, and what would have
     to be true to revisit it.
4. Set `status` to `accepted` when it is agreed; `superseded` + `supersedes: ADR-xxxx`
   when a later decision replaces it. Never edit an accepted ADR's decision in place —
   write a new one that supersedes it.
5. ADRs inherit the active epic; link the driving task by adding its id in the body.

## Notes

- Related: [[epic]], [[board]].
