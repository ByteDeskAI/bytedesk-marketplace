---
name: bytedesk-adr
description: Architecture Decision Record (ADR) creation for the ByteDesk Platform. Use this skill whenever an architectural or design decision needs to be documented — new patterns, technology choices, cross-service contracts, infrastructure decisions, or any choice that future engineers (or future Claude sessions) need to understand. Invoke when the user says "write ADR", "create architecture decision", "document this decision", "ADR for", "record why we chose", "document our approach to", or when a significant technical choice is made during implementation.
user-invokable: true
argument-hint: "[decision title]"
allowed-tools:
  - Read
  - Bash
  - Write
  - Glob
---

## What This Skill Does

Creates a properly-formatted Architecture Decision Record (ADR) in the ByteDesk repo's `docs/architecture/adr/` directory, numbered sequentially and linked to any related rule files.

## Why ADRs Matter Here

The ByteDesk CLAUDE.md mandates reading relevant ADRs before implementing any new feature. ADRs are the primary way decisions survive session boundaries and context window compaction — if it's not in an ADR, it gets rediscovered and relitigated.

## ADR Template

Use this exact structure. Omit sections that truly don't apply, but never invent new section names:

```markdown
# ADR-NNN: <Short Decision Title>

**Date**: YYYY-MM-DD
**Status**: Proposed | Accepted | Deprecated | Superseded by ADR-XXX
**Deciders**: Ryan Helms
**Related Jira**: BDP-N (if applicable)

## Context

[1-3 paragraphs: What problem or situation prompted this decision? What constraints exist?
Include technical context, business context, and any timing pressures.]

## Decision

[1-2 paragraphs: What was decided? Be specific — name the technology, pattern, or approach chosen.
This should be a clear statement a new engineer can act on.]

## Rationale

[Bullet list of reasons this option was chosen over alternatives.]

- Reason 1
- Reason 2

## Alternatives Considered

[Brief list of what else was evaluated and why it was rejected. Can be very short — even one sentence per alternative is enough.]

| Alternative | Why Rejected |
|---|---|
| Option A | [reason] |
| Option B | [reason] |

## Consequences

**Positive**:
- [benefit 1]

**Negative / Trade-offs**:
- [trade-off 1]

**Risks**:
- [risk 1, if any]

## Implementation Notes

[Optional: specific files, patterns, or rules that enforce this decision.
Link to the relevant `.claude/rules/*.md` file if this decision is enforced by a rule.]
```

## File Naming and Numbering

1. List existing ADRs to find the next number:

```bash
ls /Users/kon1790/GitHub/bytedesk-platform/docs/architecture/adr/ | sort
```

2. Use zero-padded three-digit numbering: `001`, `002`, … `042`
3. Filename format: `NNN-short-kebab-title.md`
4. Full path: `docs/architecture/adr/NNN-short-kebab-title.md`

## Rule File Linkage

If this ADR introduces or enforces a pattern that should be checked during code review, mention the applicable rule file in the Implementation Notes section. If a new rule file is warranted, create it in `.claude/rules/` and update the rules index in `CLAUDE.md`.

## Status Values

- **Proposed** — under discussion, not yet in force
- **Accepted** — decision made, code/infra should follow it
- **Deprecated** — was accepted but no longer recommended (use a note explaining the newer approach)
- **Superseded by ADR-XXX** — replaced by a later decision

## Output

After writing the ADR:

1. Confirm the file path: `docs/architecture/adr/NNN-title.md`
2. Show the user the full rendered content
3. Ask if they'd like to commit it directly or review further
4. If committing: `git add docs/architecture/adr/NNN-title.md && git commit -m "docs(adr): add ADR-NNN short title"`
