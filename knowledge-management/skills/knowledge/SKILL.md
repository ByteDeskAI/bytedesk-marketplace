---
name: knowledge
description: >
  Browse the project OKF knowledge bundle at .bytedesk/knowledge/ — index summary,
  find concepts, show trust tiers. Use when the user asks what we know, "check the
  knowledge base", "/knowledge", or before inventing domain/architecture facts that
  may already be recorded.
user-invokable: true
argument-hint: "[query words]"
allowed-tools: Bash, Read, Grep
---

# Browse knowledge (OKF v0.2)

The store at `.bytedesk/knowledge/` is the durable knowledge truth for this project.
Session memory is not.

## Steps

1. Run `km where` to confirm the bundle path (or `node ${CLAUDE_PLUGIN_ROOT}/bin/km where`).
2. If missing, offer `km init`.
3. Prefer progressive disclosure:
   - `km find <words>` or `km find type:Architecture`
   - `km show <id>` for one concept only
   - `km lint` for health; do not dump every concept body into context
4. When answering from knowledge, cite concept ids (`architecture/auth`) and trust tier if shown.
5. Relationship: **task-management** is work to do; **knowledge-management** is what is true about the system. Link with `km link task TM-014 architecture/auth` when both apply.

## Do not

- Invent domain facts when a concept already covers them.
- Load the entire wiki into the prompt.
