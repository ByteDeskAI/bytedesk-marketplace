# knowledge-management — agent notes

- Source of truth for durable knowledge: `.bytedesk/knowledge/` (OKF v0.2).
- Runtime caches only under `.bytedesk/knowledge/.km/` — never treated as concepts.
- All mutations go through `bin/km` (or MCP tools that call the same lib).
- Do not invent a proprietary frontmatter dialect; stay OKF-compatible.
- Prefer `km find` → `km show` over loading entire trees into context.
- task-management is separate; use `km link task` for soft joins.
