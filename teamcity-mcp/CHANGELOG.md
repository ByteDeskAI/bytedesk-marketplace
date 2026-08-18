# Changelog

## [0.1.0] — 2026-08-18

### Added
- TeamCity CI/CD over MCP (BDM-62): 43 curated tools plus REST passthrough
  (GET/POST/PUT/DELETE) covering the 2026.1 API surface.
- stdio launcher (`bin/teamcity-mcp`) for Claude Code / Codex / Gemini, and
  streamable HTTP for shared deployments.
- Credentials from `~/.config/teamcity-mcp/env` (or `TEAMCITY_MCP_ENV`); `.env`
  stays host-local and is gitignored.
- Claude, Codex, and Gemini manifests; `.env.example` with empty token fields.
