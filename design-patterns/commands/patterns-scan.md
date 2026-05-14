---
description: Scan a file or directory for pattern-relevant architecture smells
argument-hint: "help | [path] [--min-confidence <0-1>] [--pack <pack>] [--include-docs] [--include-generated]"
---

# Patterns Scan

Parse `$ARGUMENTS` into a `patterns_scan` MCP call.

Help behavior:

- `/patterns-scan help`, `/patterns-scan --help`, or `/patterns-scan -h` returns help only.
- Help must include purpose, usage, options, examples, backing MCP tool, and JSON argument mapping.
- Do not call `patterns_scan` when the user asks for help.

Argument mapping:

- First positional value: `path` optional when the MCP working directory is a project; otherwise the tool returns structured missing-argument detail.
- `--min-confidence <0-1>`: filter weak findings, default `0.0`.
- `--pack <pack>`: optional smell rule pack; inferred from scope, path, and query markers when omitted.
- `--include-docs`: optional; inferred true for documentation paths and false for code paths.
- `--include-generated`: optional; defaults false unless explicitly requested.

Inference behavior:

- Infer language and likely catalog scope from the scan path and nearby project files.
- Infer scan `path`, `pack`, and `include_docs` where safe.
- Include inference metadata in the scan result so follow-up commands can reuse it.
- If evidence is ambiguous, use `all` for scope and omit the language filter.
- If `path` cannot be inferred, return missing-argument detail instead of scanning the plugin install directory by accident.

Examples:

```text
/patterns-scan backend/app/repositories/jobs.py --min-confidence 0.5
/patterns-scan backend/app/workflow_engine --min-confidence 0.45
/patterns-scan docs/architecture --include-docs --pack integration
```

Lead with concrete findings. For each finding, include the smell, why it matters, likely pattern response, and a small next check.
