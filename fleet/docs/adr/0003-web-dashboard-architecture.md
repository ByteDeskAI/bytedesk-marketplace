# ADR-0003: Web dashboard architecture

## Status

Accepted - 2026-05-10

## Context

The fleet plugin's first-class UX has historically been the bash CLI (`claude-sessions list`, `tail`, `events`) plus desktop notifications via the notify daemon. Once parallel multi-session work became routine, the gap was visibility — there is no good text-mode answer to "show me the live state of seven concurrent children, with PTY input, replay, audit, and chain orchestration." Phase 12 (BDM-28 and descendants) added a per-project web dashboard. This ADR captures the load-bearing decisions so they aren't relitigated in follow-up tickets.

The dashboard is a sibling to, not replacement for, the CLI. Both read the same `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/` state (ADR-0002), so anything the dashboard observes is observable from the shell, and vice versa.

## Decision

A persistent per-project Go server with a static Preact SPA, talking to the existing on-disk session state via a thin repository layer. The server lives or dies with the plugin's monitor lifecycle and serves a single project.

### 1. Server lifetime + lock

One `claude-sessions-web` process per project, kept alive across Claude Code sessions. A PID lock at `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/web/pid` ensures exactly one server per project; secondary launches detect the lock, verify the PID is alive, and exit with status 0 (stand-by polling at 5s). Implementation in `fleet/web/server/main.go` and `fleet/web/server/lock.go`. The same per-project keying as the notify daemon (ADR-0002) keeps multi-repo users isolated.

### 2. Port assignment

Deterministic-first, conflict-tolerant. The first-pick port is `7681 + (sha256(PROJECT_KEY) mod 50)`, giving each project a stable URL across restarts as long as no one else holds the port. On `EADDRINUSE`, the server walks to an ephemeral port and persists the choice in `${CLAUDE_PLUGIN_DATA}/projects/<KEY>/web/config.toml`. Subsequent restarts read the persisted port first. See `fleet/web/server/config.go`. The 50-port window is wide enough for realistic concurrent project counts and narrow enough that the URL is memorable.

### 3. Tech stack

Server: Go, stdlib HTTP + `golang.org/x/net/websocket`, no web framework. Frontend: Preact (~3KB) + esbuild, no React, no Next.js, no Vite. Terminal: xterm.js. The bundled `dist/` is committed to the repo so `/plugin install` doesn't require a Node toolchain on the user's machine.

The rejected alternative was Next.js + React + a managed deploy. It was rejected because (a) the dashboard is per-project, not per-user, so SSR + a hosted runtime is the wrong shape; (b) Preact's bundle is small enough to ship as a single static asset alongside the Go binary; (c) the Go stdlib gives us SSE, WebSocket, and a static file server in ~200 LoC, with no dependency churn. The cost is hand-rolling some patterns React gives for free; the win is a self-contained binary plus 3KB of JS that the user can audit.

### 4. Atomic design layout

Frontend components under `fleet/web/src/components/` follow Brad Frost's atomic design taxonomy: `atoms/` (Button, Badge, Spinner), `molecules/` (Toolbar, StatBlock, TabStrip), `organisms/` (SessionTable, DetailPanel, ChainEditor), `templates/` (DashboardLayout), `pages/` (DashboardPage, GridPage, ChainsPage, AuditPage, SearchPage, RulesPage, SettingsPage). Pages compose templates from organisms; organisms compose molecules from atoms; never the other direction. The constraint is what keeps a 3KB bundle from accreting into a 300KB one.

### 5. Design patterns

Server-side: Repository per state kind (`SessionRepo`, `EventsRepo`, `ChainsRepo`, `SettingsRepo`, `ProjectsRepo`) reading and writing `${CLAUDE_PLUGIN_DATA}` files. Adapter wraps the existing `claude-sessions` bash CLI for spawn/kill/send so the bash + web paths share semantics. Mediator (`EventBus`) fans on-disk events out to SSE subscribers without coupling repos to transport. Strategy for `JudgeProvider` (heuristic / Haiku) and `GridLayout` (chips / split / focus). Decorator chain for HTTP middleware (logging, auth, recover). Builder for `SpawnRequest` so the wizard's many optional knobs don't poison the constructor.

Client-side: Container/Presenter split via custom hooks. Pages are containers (data fetching, route state); organisms are presenters (props in, callbacks out). Hooks like `useStream`, `useSessions`, `useChains` encapsulate the SSE/REST plumbing so pages stay declarative.

### 6. Live updates

Server-Sent Events for streams; WebSocket for interactive PTY only. `/api/stream` exposes topics (`sessions`, `stats`, `projects`, `events`, `chains`, `dist-rebuilt`); clients filter via the `topics=` query param. SSE was chosen over polling for latency and over WebSocket for streams because (a) it's one-way fan-out, (b) it survives proxies that mangle WebSocket frames, (c) `EventSource` reconnects automatically. WebSocket is reserved for `/api/sessions/<T>/pty`, where the client genuinely needs to send keystrokes upstream.

### 7. PTY bridge

`fleet/bin/claude-sessions` already runs each session under tmux with `pipe-pane` writing ANSI-stripped output to the session's `log` file. The PTY bridge piggybacks on that file rather than opening a second pipe-pane (which would clobber the existing one). On WebSocket connect, the server `tail -f`s `log` from EOF and forwards lines as `{"type":"data","data":"..."}` JSON envelopes. Input is `tmux send-keys -l <pane> "..."` with literal-mode quoting; resize is `tmux resize-pane -t <pane> -x W -y H`. The envelope leaves room for future message kinds (`marker`, `ping`) without breaking the wire format.

### 8. Auth

Optional bearer token. `web/config.toml` carries an `auth_token` field; when set, an HTTP middleware decorator gates `/api/*` (except `/healthz` and `/api/version`, which stay open for liveness checks). The `Authorization: Bearer <token>` header is the canonical form. Because `EventSource` and the WebSocket handshake can't carry custom headers, the same token is also accepted as `?token=<value>` on those two transports. When `auth_token` is empty, the middleware no-ops — appropriate for the loopback default of `127.0.0.1`. Anyone exposing the dashboard via Tailscale or a tunnel is expected to set the token.

### 9. Hash-chain audit

A sha256 chain over each session's `events.jsonl` lines, with the rolling hash persisted to a sidecar `events.hashlog`. Each entry is `sha256(prev_hash || line_bytes)`. The verifier endpoint `/api/audit/verify?session=<T>` re-walks both files and returns `{"ok": true}` or `{"ok": false, "bad_line": N}`. Tampering with any past event invalidates every hash from that point forward, so the verifier's report is the line where the chain first diverges, not where the tamper happened. The audit page renders this for the human.

### 10. Real Haiku judge with heuristic fallback

State badges ("waiting on input?", "stuck on a test?") are produced by a `JudgeProvider` strategy. The default is `HeuristicJudge` (regex + last-N-lines). When `[ai] enabled = true` and `ANTHROPIC_API_KEY` is in env, the server promotes to `HaikuJudge`, which shells out to a Node sidecar using `@anthropic-ai/claude-agent-sdk` over stdio JSON. Results are cached in a 60-second LRU keyed by `session_id + log_offset`. If the sidecar process dies, the strategy falls back to heuristic transparently and logs the failure. The sidecar lives in `fleet/web/sidecar/` and is started lazily on first request.

### 11. Hot-reload dev mode

`npm run dev` in `fleet/web/` runs `air` (Go file watcher) + esbuild watch + a dev build tag that exposes a `dist-rebuilt` SSE topic. Frontend rebuilds emit on the topic; the SPA listens and self-reloads. `DEV_MODE=1` skips the PID lock (so multiple dev servers can coexist without stomping the production lock) and forces port `7690` so the dev URL is stable across restarts. Production builds compile out the dev topic and re-enable the lock. The result: a single command (`npm run dev`) gives both ends hot-reloading with no nodemon, no Vite HMR plumbing, no proxy configuration.

## Consequences

### Positive

- One binary + ~3KB of JS owns the entire dashboard surface; uninstall is clean (per ADR-0002).
- Per-project key + lock means a user with five repos checked out gets five independent dashboards on five stable URLs.
- The repository + adapter split means the bash CLI and the web dashboard cannot drift in semantics — both read and write the same on-disk state.
- The hash-chain audit gives a tamper-evident view of every PR-level event without requiring a separate audit log database.
- Hot-reload dev mode keeps the iteration loop tight even though the production stack is two languages.

### Negative

- Hand-rolled HTTP / SSE / WebSocket means we own the bugs the framework would have caught. Mitigation: stdlib is small enough to test exhaustively.
- Committing `dist/` means the repo carries built artifacts. Mitigation: the build is reproducible via `npm run build`, and a CI check in BDM-29 fails when `dist/` is stale relative to `src/`.
- The Node sidecar is an optional second runtime that users opting into Haiku must have. Mitigation: heuristic fallback is the default, so the dashboard is fully functional without Node.

### Neutral / operational

- Future federation across machines (multi-host fleet) would need a second tier above the per-project server. Out of scope for this ADR; tracked as BDM-future.
- The 50-port window in (2) sets an implicit cap on the number of distinct projects that can have stable first-pick URLs simultaneously. Beyond 50 projects the walk-on-conflict path takes over; the cap is not a correctness limit, only a stability one.

## References

- BDM-28 — Phase 12 web dashboard tracking epic
- ADR-0002 — `${CLAUDE_PLUGIN_DATA}` per-project state layout (the dashboard reads this)
- ADR-0001 — Hierarchical authorization (surfaced in the dashboard's depth/auth badges)
- `fleet/web/server/main.go`, `lock.go`, `config.go` — server lifetime, lock, port assignment
- `fleet/web/src/components/` — atomic design layout
- `fleet/web/sidecar/` — Haiku Node sidecar
- `fleet/docs/SMOKE-TEST.md` — Phase 5 verifies the dashboard end-to-end
