# Changelog

## [0.1.0] — 2026-07-31

### Added

- OKF v0.2 knowledge store at `.bytedesk/knowledge/` with runtime under `.km/`
- CLI `km`: init, validate, reindex, concept new, show, find, graph, backlinks, verify, lint, doctor, migrate, log, export, viz, link task, install/where
- Hooks: SessionStart, PreCompact, UserPromptSubmit, AskUserQuestion decision capture, SubagentStart, Stop (soft stale warn)
- MCP stdio server (`km-mcp`) with search/show/validate/lint/graph/verify/write
- Skills: knowledge, ingest, lint, verify
- Soft task-management cross-links (`km link task`)
- PR7: static `km viz` HTML export + GitHub Actions workflow example for `km validate`
- Vendored OKF SPEC under `reference/SPEC.md` (Apache-2.0 upstream; see NOTICE)
- Vendored `yaml@2.9.0` under `lib/vendor/yaml` so `/plugin install` works without `npm ci`
- Unit + smoke test suite (`run-tests.sh`) including install/where and zero-install coverage
