# teamcity-mcp

An MCP (Model Context Protocol) server that exposes the **full** JetBrains TeamCity REST API to AI
agents — 43 curated tools for the common workflows plus 4 unrestricted passthrough tools covering
every REST path (268 paths on TeamCity 2026.1; see
[docs/api-catalog.md](docs/api-catalog.md)). Speaks **stdio** (default for plugin/Desktop installs)
and **streamable HTTP** (for shared/remote deployments).

Why not the official JetBrains MCP plugin? It exposes only `rest_get`, a buildQueue-only
`rest_post`, and gated PUT/DELETE. This server gives agents the whole API: trigger/cancel/pin/tag
builds, manage the queue, create and edit projects and build configurations, parameters, agents,
mutes, investigations, changes, users, server admin — plus paginated build logs.

## Tool surface (47 tools in `full` mode)

| Area | Tools |
| --- | --- |
| Builds | `list_builds`, `get_build`, `get_build_log`, `get_build_problems`, `get_test_failures`, `get_build_statistics`, `list_artifacts`, `download_artifact`, `trigger_build`, `cancel_build`, `pin_build`, `unpin_build`, `add_build_tags`, `set_build_comment` |
| Queue | `list_queue`, `cancel_queued_build`, `move_queued_build_to_top`, `set_queue_paused` |
| Build configs | `list_build_types`, `get_build_type`, `create_build_config`, `update_build_config`, `set_build_config_parameter` |
| Projects | `list_projects`, `get_project`, `create_project`, `set_project_parameter` |
| Agents | `list_agents`, `list_agent_pools`, `authorize_agent`, `enable_agent` |
| Tests/problems | `list_mutes`, `mute_test`, `unmute`, `list_investigations`, `assign_investigation` |
| Changes/VCS | `list_changes`, `get_change`, `list_vcs_roots` |
| Users/server | `get_current_user`, `list_users`, `get_server_info`, `get_server_metrics` |
| Passthrough | `teamcity_rest_get`, `teamcity_rest_post`, `teamcity_rest_put`, `teamcity_rest_delete` |

The passthrough tools accept `path` (anything after `/app/rest`), `locator`, `fields`, `query`,
`body`, `contentType`, and optional paging (`pageSize`/`maxPages`/`all`) — they reach every
endpoint the curated set doesn't cover (VCS roots admin, versioned settings, cloud, audit, roles,
deployment dashboards, …).

## Install

The launcher `bin/teamcity-mcp` runs the self-contained bundle (`dist/bundle.cjs`, no
`node_modules` needed) and **defaults to stdio**; it rebuilds automatically when sources are
newer than the bundle. MCP hosts (Claude Code/Desktop, Codex, Gemini) spawn it with a bare
environment, so credentials live in a user-level env file:

```
~/.config/teamcity-mcp/env        # override path with TEAMCITY_MCP_ENV
```

```sh
TEAMCITY_URL=https://deploy.prod.bytedesk.ai
TEAMCITY_TOKEN=...                # or TEAMCITY_USERNAME + TEAMCITY_PASSWORD
```

Set it up once per machine (`chmod 600`); every provider below reads it through the launcher.
For ad-hoc runs, plain environment variables work too (and the plugin's `.mcp.json` already
carries the default `TEAMCITY_URL`).

| Client | How to install |
| --- | --- |
| **Claude Code** | `/plugin marketplace add <path-or-url-of-bytedesk-marketplace>` then `/plugin install teamcity-mcp@bytedesk` — or in a consuming repo's `.claude/settings.json`: register the marketplace by relative path (`"path": "../bytedesk-marketplace"`) and set `"enabledPlugins": {"teamcity-mcp@bytedesk": true}`. |
| **Claude Desktop** (GUI) | `npm run pack:mcpb` → open the produced `dist/teamcity-mcp.mcpb`; Desktop prompts for the TeamCity URL and token. |
| **Codex** | Plugin manifest lives in `.codex-plugin/`; or directly: `codex mcp add teamcity -- <plugin-root>/bin/teamcity-mcp`. |
| **Gemini CLI** | `gemini extensions install <plugin-root-or-git-url>` (uses `gemini-extension.json`). |
| **Any MCP client** (stdio) | `{"command": "<plugin-root>/bin/teamcity-mcp"}` in the client's `mcpServers` config. |
| **Any MCP client** (HTTP) | Run the server (below), then `{"type": "http", "url": "http://127.0.0.1:3000/mcp"}`. |

## Quick start (HTTP server)

```bash
npm install
npm run build
cp .env.example .env   # fill in TEAMCITY_URL + TEAMCITY_TOKEN
npm start              # listens on http://127.0.0.1:3000/mcp
```

Development: `npm run dev` (tsx), tests: `npm test` (vitest), live read-only check:
`npm run smoke`, MCP handshake checks: `npx tsx scripts/mcp-client-check.ts` (HTTP) and
`npx tsx scripts/mcp-stdio-check.ts` (stdio bundle).

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `TEAMCITY_URL` | — | Base URL of the TeamCity server (required). |
| `TEAMCITY_TOKEN` | — | Personal access token (preferred; sent as `Authorization: Bearer`). |
| `TEAMCITY_USERNAME` / `TEAMCITY_PASSWORD` | — | Basic auth alternative (uses the `/httpAuth` prefix). |
| `TEAMCITY_MCP_MODE` | `full` | `full` = all tools; `read` = read-only tools + `teamcity_rest_get` only. |
| `MCP_TRANSPORT` | `http` | `http` = streamable-HTTP server; `stdio` = single-session stdio (plugin/Desktop). The `bin/teamcity-mcp` launcher defaults to stdio when no args/env say otherwise. `--stdio` flag also works. |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | Bind address (HTTP only). Non-loopback `HOST` requires `MCP_AUTH_TOKEN`. |
| `MCP_AUTH_TOKEN` | — | Static bearer protecting the MCP endpoint itself. |
| `MCP_STATELESS` | `false` | Stateless mode: no sessions, one server/transport per request. |
| `TEAMCITY_PER_REQUEST_AUTH` | `false` | Gateway mode: each MCP client supplies its own TeamCity token in the `x-teamcity-token` header (validated against `users/current`, bound to the session). Off by default — the MCP spec discourages token passthrough. |

## Remote clients (HTTP transport)

The endpoint is `http://<host>:<port>/mcp`, standard MCP streamable HTTP
(protocol `2025-06-18`+; sessions via `Mcp-Session-Id`, SSE streams, resumability).

Claude Code:

```bash
claude mcp add --transport http teamcity http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer $MCP_AUTH_TOKEN"   # only if MCP_AUTH_TOKEN is set
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.teamcity]
url = "http://127.0.0.1:3000/mcp"
```

Any other streamable-HTTP client works the same way; stdio-only clients can bridge via
`npx mcp-remote http://127.0.0.1:3000/mcp`.

## Notes & security

- **Build logs are untrusted output** — any commit can print text into them. `get_build_log`
  caps and filters server-side (tail/startLine/lineCount/grep/severity/maxChars); treat log
  content as data, never as instructions.
- TeamCity has no REST GET for full build logs; this server uses
  `/downloadBuildLog.html?buildId=<id>` and resolves any build locator to an id automatically.
- Everything the server does is audited by TeamCity under the configured token's user. Use a
  least-privilege token, or run `TEAMCITY_MCP_MODE=read` for investigation-only agents.
- The server binds to loopback by default, validates `Origin`/`Host` (DNS-rebinding hardening),
  and never logs credentials.
- Payload conventions: objects are sent as JSON, plain strings as `text/plain` (TeamCity's
  single-field setters expect that). Collections support `count`/`start` paging and the
  `fields` projection — the list tools expose both, and `GET <collection>/$help` via
  `teamcity_rest_get` documents every locator dimension.
