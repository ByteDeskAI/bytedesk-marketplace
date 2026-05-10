# fleet/web

Web dashboard for the fleet plugin: a Go HTTP server that serves a Preact SPA. The Go binary embeds the SPA's pre-built `dist/` via `//go:embed`, so plugin install ships a single binary — no Node toolchain required at install time.

## Layout

```
fleet/web/
├── README.md
├── package.json          # Preact + esbuild + typescript
├── tsconfig.json
├── build.mjs             # esbuild driver: src/ → server/dist/
├── build.sh              # full release build (SPA + Go)
├── .gitignore            # node_modules/, *.metafile.json
├── src/
│   ├── main.tsx          # SPA entry: mounts <OverviewPage /> at #root
│   ├── api.ts            # API client (placeholder fixtures in Phase 2; real /api/* in Phase 3)
│   ├── styles.css        # design tokens (CSS custom properties) + base styles
│   └── components/       # atomic-design layout
│       ├── atoms/        # Badge, Button, Icon, Sparkline
│       ├── molecules/    # SearchField, StatCard
│       ├── organisms/    # Sidebar, TopBar, StatRibbon, SessionTable
│       ├── templates/    # AppShell
│       └── pages/        # OverviewPage
└── server/
    ├── *.go              # Go HTTP server source
    ├── *_test.go         # unit tests
    └── dist/             # esbuild output, embedded via //go:embed
        ├── index.html    # template that loads /app.js + /app.css
        ├── app.js        # bundled SPA (Preact + components)
        ├── app.css       # bundled styles
        └── app.js.map    # source map for browser devtools
```

## Build / dev workflow

```bash
# Full release build (SPA + Go binary)
fleet/web/build.sh

# Iterating on the SPA (esbuild watch mode)
cd fleet/web
npm install            # first run only
npm run watch          # rebuilds server/dist/ on every src/ change

# In another shell, restart the Go binary to pick up new dist/
fleet/bin/claude-sessions-web   # serves the new bundle
```

## Phases

- **Phase 1 (BDM-15, v1.1.0)** — Foundation: Go server, monitor registration, port assignment, PID lock, standby polling.
- **Phase 2 (BDM-16, v1.2.0)** — SPA scaffold: Preact + esbuild + atomic-design layout + first organisms (`Sidebar`, `TopBar`, `StatRibbon`, `SessionTable`). Renders against placeholder fixtures from `src/api.ts` so the surface is real, not just empty dirs.
- **Phase 3+** — Repos, EventBus, SSE fanout, real `/api/*` endpoints, PTY embed (xterm.js + tmux control mode), spawn / steer / coordinate surfaces, intelligence layer, replay, mobile, themes.

## Atomic design

Components live in five tiers, with hard rules:

- **Atoms** — primitives, no business state. Take only display props (variant, size, label).
- **Molecules** — atoms composed; light state allowed (form-local, transient).
- **Organisms** — feature regions. Own data binding via custom hooks (Phase 3).
- **Templates** — slot-driven page skeletons. Today: `AppShell` (sidebar + topbar + content).
- **Pages** — instances bound to routes. Today: `OverviewPage`. Each page is thin: composes hooks + organisms.

## Patterns (server)

The Go server (Phase 3+) lays down these patterns:

- **Repository** — per state-file directory abstraction.
- **Adapter** — `claude-sessions` subprocess wrapper.
- **Observer / Mediator** — inotify watcher + `EventBus` per project.
- **Strategy** — auth strategy, cost-source strategy.
- **Decorator** — middleware stack (RequestID → Log → Auth → RateLimit → Handler → ErrorMap).
- **Factory** — `SessionDetailFactory` composes a response from multiple repos.
- **Command** — typed action dispatch to the `claude-sessions` adapter.
- **Builder** — `SpawnRequestBuilder` for CLI-arg construction with prompt-file temp-file handling.
- **`embed.FS`** — single-binary distribution.

## Known limitations

- **Multi-arch binary distribution.** The committed binary is linux-amd64 only. Cross-platform builds queued for a later phase.
- Source maps (`app.js.map`, ~150KB) are committed alongside the bundle so browser devtools "view source" works.
