# Changelog

## [0.2.0] — 2026-08-31

### Added
- Typed project versioned-settings lifecycle, synchronization, and token tools.
- Typed VCS-root administration, connection inspection, and build-configuration attachment.
- Project-feature, parameter-read, SSH-key, credential-inventory, secure-token, and guarded deletion tools.

### Fixed
- Negotiate `text/plain` responses for TeamCity single-value writes and allow explicit passthrough
  `Accept` headers.
- Redact secret inputs from TeamCity API errors and typed tool responses.

## [0.1.1] — 2026-08-26

### Fixed
- Ship the self-contained server bundle as an installation artifact and never invoke npm or
  publisher build tooling from an installed launcher when extraction changes source mtimes.
- Fail with an actionable reinstall/build message when the shipped bundle is absent.

## [0.1.0] — 2026-08-18

### Added
- TeamCity CI/CD over MCP (BDM-62): 43 curated tools plus REST passthrough
  (GET/POST/PUT/DELETE) covering the 2026.1 API surface.
- stdio launcher (`bin/teamcity-mcp`) for Claude Code / Codex / Gemini, and
  streamable HTTP for shared deployments.
- Credentials from `~/.config/teamcity-mcp/env` (or `TEAMCITY_MCP_ENV`); `.env`
  stays host-local and is gitignored.
- Claude, Codex, and Gemini manifests; `.env.example` with empty token fields.
