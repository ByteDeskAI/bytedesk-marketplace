# fleet/web

Web dashboard server for the fleet plugin. Replaces the legacy `ttyd` + `cmd_tui` shim with a real Go HTTP server that (eventually) serves a Preact SPA. This directory holds the server source (`server/`), the SPA source (forthcoming), and the static `dist/` bundle that the Go binary embeds via `//go:embed`.

## Layout

```
fleet/web/
├── README.md
├── build.sh                  # builds the Go binary into ../bin/claude-sessions-web
└── server/
    ├── go.mod
    ├── *.go                  # server source
    ├── *_test.go             # unit tests
    └── dist/                 # static SPA bundle, embedded via //go:embed
        └── index.html        # placeholder until Phase 2 ships the Preact build
```

`dist/` lives inside `server/` because `//go:embed` requires sibling-or-below paths. The Phase 2 SPA build pipeline (esbuild) will write its output here.

## Phase 1 (BDM-15) — Foundation

Lifecycle (mirrors the BDM-4 notify-daemon pattern):

1. `CLAUDE_SESSION_DEPTH >= 1` → exit 0. Fleet children don't run their own dashboard.
2. Acquire per-project PID lock at `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/web/pid`. If held by a live peer, stand by and re-poll every 5s. Stale PIDs (and empty files) are reclaimed.
3. Load or assign port:
   - First-load pick: `7681 + (sha256(PROJECT_KEY) mod 50)`.
   - Walk 7681..7730 on bind failure; rewrite `web/config.toml` if the chosen port differs from disk.
   - Range exhausted → ephemeral port + warn.
4. Trap `SIGINT` / `SIGTERM` / `SIGHUP` → release lock + exit.
5. Serve `/`, `/healthz`, `/api/version`. Real routes land in subsequent phases.

## Build

```bash
fleet/web/build.sh
```

Runs `go fmt` / `go vet` / `go test ./...` and emits `fleet/bin/claude-sessions-web`. The binary is currently committed for the maintainer's platform (linux/amd64); cross-platform binary distribution is a Phase 2+ concern (see open questions in the BDM-14 epic).

## Discovery

`claude-sessions web` (no args, on the CLI) reads the project's `web/config.toml` and prints the URL the monitor is bound to. It does **not** start a server — the plugin monitor does. If the monitor isn't running (`web/pid` missing or stale), the CLI prints a hint.

## Roadmap

The Preact SPA bundle, Repos, EventBus, SSE fanout, PTY bridge, command dispatch, and per-feature pages all land in subsequent BDM-14 phases. See the architecture decision record at `fleet/docs/adr/0003-web-dashboard-architecture.md` (forthcoming).
