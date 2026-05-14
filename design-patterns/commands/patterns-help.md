---
description: Show help for all Design Patterns slash commands or one command
argument-hint: "help | [command]"
---

# Patterns Help

Parse `$ARGUMENTS` into a `patterns_help` MCP call.

If `$ARGUMENTS` is empty, return the full command index. If `$ARGUMENTS` names a command, return focused help for that command.

Help behavior:

- `/patterns-help help` explains this command.
- `/patterns-help` lists every available `/patterns-*` command.
- `/patterns-help patterns-scan` explains `/patterns-scan`.
- `/patterns-help scan` also resolves to `/patterns-scan`.

Examples:

```text
/patterns-help
/patterns-help patterns-scan
/patterns-help recommend
/patterns-help /patterns-context
```

Return purpose, usage, options, examples, the backing MCP tool, and the canonical `/<command> help` form.
