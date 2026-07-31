# Knowledge management (OKF v0.2)

This project keeps durable knowledge in `.bytedesk/knowledge/` using the
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md).

- **CLAUDE.md / AGENTS.md** — how to behave.
- **task-management** (`.bytedesk/task-management/`) — work to do.
- **knowledge-management** (`.bytedesk/knowledge/`) — what is true about the system.

Before inventing architecture, API, or runbook facts, run `km find <words>`.
After learning something the code cannot say, file a concept (`km concept new`).
Prefer progressive disclosure: index → find → show one concept.

```bash
km init
km concept new "Title" --type Architecture --dir architecture
km validate
km lint
```
