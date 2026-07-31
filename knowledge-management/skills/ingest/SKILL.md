---
name: knowledge-ingest
description: >
  Ingest a source (file, URL notes, or research pack) into an OKF concept with
  provenance sources[] and generated stamp. Use for /knowledge:ingest, "file this
  into the knowledge base", or after enhance-research.
user-invokable: true
argument-hint: "<title or path>"
allowed-tools: Bash, Read, Write, Edit
---

# Ingest into knowledge

1. Read the source material (path, research pack, or user text).
2. Choose a type from: Architecture, Decision, API, Module, Runbook, Onboarding, Domain Concept, Playbook, Metric, Reference.
3. Create with CLI:

```bash
km concept new "<Title>" --type <Type> --dir <subdir> --desc "<one line>" --tag <tag>
```

4. Edit the concept body to structured markdown (headings, lists, tables). Prefer absolute bundle links: `[other](/path/to.md)`.
5. Add `sources` in frontmatter when derived from external material (resource URL or path).
6. `km reindex && km validate`
7. Optionally `km link task <TM-id> <concept-id>` if this knowledge unblocks work.
