---
name: knowledge-verify
description: >
  Mark an OKF concept as human-reviewed (verified frontmatter) after the user
  confirms accuracy. Use for /knowledge:verify, "I reviewed this", or trust upgrades.
user-invokable: true
argument-hint: "<concept-id>"
allowed-tools: Bash, Read
---

# Verify a concept

1. `km show <id>` — review body and sources with the user.
2. On confirmation: `km verify <id>`
3. Confirm trust becomes `human-reviewed` via `km show <id> --json` or the verify output.

Only verify after a human (or explicit user instruction) confirms content accuracy.
