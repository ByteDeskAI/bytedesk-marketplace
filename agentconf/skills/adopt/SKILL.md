---
name: adopt
description: Take a machine that already has per-tool instruction files and work out what belongs in the shared source, before wiring anything. Use on first setup, when the user already maintains CLAUDE.md and AGENTS.md by hand, or when they ask how to start using agentconf without losing what they have.
user-invokable: true
allowed-tools:
  - Bash
  - Read
---

```
agentconf adopt
```

That reports what exists and how much of it is already in the shared source. **It does not
merge, and neither should you without showing your work.**

## The judgement this needs

The tempting move is "these two files are near-duplicates, pick one." That is usually wrong.
On the machine this plugin was built from, `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`
shared **10 of 55 lines** — and the divergence was deliberate: the Codex copy was reworded
for an agent that is not Claude Code, and the lines naming the `claude` CLI had been removed
on purpose. A render-from-one-source tool would have flattened that and called it a fix.

So read the files yourself and sort every section into one of two piles:

- **shared** — true regardless of which agent reads it
- **per-tool** — names a specific CLI, or is addressed to one audience

Then propose: shared content into `~/.agents/AGENTS.md`, per-tool content staying in that
tool's own file below the import. Show the split to the user before writing anything.

## Order of operations

1. `agentconf adopt` — see what is there
2. Read each standalone file
3. Propose the split, get agreement
4. Write `~/.agents/AGENTS.md`, trim the per-tool files to their genuine remainder
5. `agentconf wire` — link them up ([[wire]])
6. `agentconf verify --all` — prove the tools read it ([[verify]])

Step 6 is not optional. Adoption that ends at "the files look right" is exactly the failure
this plugin exists to catch.
