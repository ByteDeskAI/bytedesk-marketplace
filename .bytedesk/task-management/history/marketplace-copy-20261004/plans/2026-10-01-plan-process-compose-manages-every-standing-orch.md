# Plan: process-compose manages every standing orchestration process, installed and controlled by the ao plugin, on every OS

## Context

The gateway's orchestration tab showed `ACP_CONTROL_UNAVAILABLE` because the session host had stopped. The ao plugin starts its standing processes in three different ways, and none of them restarts a process that dies:

| Process | How it starts today | Restarts? |
|---|---|---|
| Session host (`agent-orchestration session-host`) | lazily, by `ensureSessionHost` (`src/service.mjs:299`), as a Linux-only `systemd-run --scope` with **`RuntimeMaxSec=24h`** (`src/session/supervisor.mjs:60`); in-process on Windows; or by hand | No |
| Local NATS (`topology/lib/nats-local.mjs:66`) | a detached spawn the first time a transport opens | No |
| Repository supervisor (`ao-topology supervise`) | a plugin monitor that lives only while a Claude session is open, or a detached spawn from any activating verb (`topology/lib/supervision.mjs:445`) | Only when the next verb or session starts |

**Goal:**
- The installed ao plugin owns every standing orchestration process through **process-compose** (Apache-2.0, a single Go binary for Linux, macOS and Windows). It supplies restart policies, readiness probes, per-process logs and a control API.
- The processes run while you are logged in. You chose not to enable linger.
- The gateway starts the processes itself instead of telling you to.

### Processes process-compose does not run, and who handles each

A `restart: always` policy is right only for something that should run all the time. These four should not, so each is handled a different way.

| Process | Why process-compose should not restart it | How it is handled under this plan |
|---|---|---|
| **Per-run workers** (`agent-orchestration worker`, one per run, `src/platform/linux-runtime.mjs:96`) | A worker is a finite job. Restarting one that crashed would repeat a provider prompt, edits and commits, which is unsafe. Recovery has to decide whether to re-queue the run or mark it, and that is what the existing recovery sweep does (`src/service.mjs:115-166`). | **Moved to global control.** The sweep runs today only inside each MCP server, so when no Claude/Codex session is open nobody recovers lost runs. The managed `session-host` process switches to `autoRecover: true` (`src/cli.mjs:27`), so one always-on, auto-restarted process owns recovery for the state root. Several MCP servers already run the sweep at the same time, so it must already tolerate concurrency; I'll confirm that in the code before relying on it. Workers keep their per-run isolation: systemd scope, `prlimit`, memory limits and `RuntimeMaxSec=8h`. |
| **Probes** (doctor and readiness probes, 30-second scopes) | A probe is one-shot: it runs, reports and exits. There is nothing to keep alive. | No change. |
| **stdio MCP server** (`.mcp.json` → `dist/host-launcher.cjs`) | Its stdin and stdout are the pipe to the Claude, Codex, Grok or Kimi session that started it. A process manager cannot own that pipe, so only the host CLI can start it or reconnect it (`/mcp`). | **Becomes a thin client.** Its two long-lived duties move to managed processes: launching the session host (now `services ensure`) and the recovery sweep (now in `session-host`). If it dies, no orchestration state is lost. |
| **Hand-run `watch` commands** (`startup watch`, `presence watch`, `prompt watch`, `observer watch`, `census --watch`) | They are foreground views that print to your terminal, used for debugging. As services they would write to nobody. | The managed `supervise-<repo>` process already does the background part of startup, presence, prompt refresh and census in each tick (`topology/lib/supervision.mjs:91-362`). I'll check that each `watch` command has a matching tick step. Any background duty not covered by the tick becomes a tick step, not a separate process. |

**One cross-platform gap found while checking this:** on macOS, workers fall through to the `linux-native` backend (`src/platform/host-adapters.mjs:13,74`), which launches through `systemd-run`, and macOS has no systemd. I'll file it as its own `tm` task, because it is about the worker runtime, not about services.

## Design

### 1. The plugin installs a pinned process-compose

`services install` downloads one pinned process-compose release from GitHub and puts it in `<dataHome>/bytedesk/agent-orchestration/bin/`.
- `dataHome` is `XDG_DATA_HOME` or `~/.local/share` on Linux, `~/Library/Application Support` on macOS, and `%LOCALAPPDATA%` on Windows.
- The pinned version and each archive's SHA-256 live in the plugin, in `services/process-compose.lock.json`. The download is refused if the hash does not match.
- The version is chosen at implementation time, and its CLI flags and API are confirmed against that version's documentation.
- `NOTICE` gets an attribution line.
- The binary is not committed to the repo. That keeps the plugin small and per-OS binaries out of git.

### 2. A stable path to the installed plugin

The installed plugin's path changes with every commit (`~/.claude/plugins/cache/bytedesk/agent-orchestration/<sha>`).
- `ensure` writes `<dataHome>/…/current.json` = `{ pluginRoot, sha, node }`. `node` is the absolute path, because nvm and Homebrew put node outside the OS service PATH.
- A tiny `<dataHome>/…/launcher.cjs` reads `current.json` and runs the current plugin's `dist/cli.cjs` or `topology/cli.mjs`.
- Every process in the process-compose config calls this launcher, so a plugin update needs only a process restart, not a config rewrite.
- This is a JSON pointer, not a symlink, because Windows symlinks need extra privilege.

### 3. The process-compose project (generated)

`ensure` generates `<stateRoot>/services/process-compose.yaml`, using the existing state root from `src/config.mjs:10`:

| Process | Command | Availability | Readiness |
|---|---|---|---|
| `session-host` | `node launcher.cjs session-host` | `restart: always`, with backoff | exec probe `… services probe session-host`, which wraps `probeSessionHost` (`src/session/host.mjs:105`) |
| `nats` | `nats-server -c <conf>`, reusing the config and credentials from `nats-local.mjs` | `restart: always` | TCP probe on its port |
| `supervise-<key>` | `node launcher.cjs ao-topology supervise --consumer <repo>`, one per registered repository | `restart: always` | none; the existing per-repo lock prevents duplicates |

Platform guards decide which processes are included:
- `nats` is left out when `AO_NATS_URL` is set or `findNatsServer` (`nats-local.mjs:23`) finds no binary.
- `supervise-*` is left out on native Windows, because it needs tmux; `status` reports it as unsupported.

Registered repositories live in `<stateRoot>/services/repos.json`.

### 4. The OS keeps process-compose alive and starts it at login

Only process-compose itself is registered with the OS:

| OS | Registration | Restart mechanism |
|---|---|---|
| Linux / WSL with systemd | `~/.config/systemd/user/agent-orchestration.service`, `WantedBy=default.target` | `Restart=always` |
| macOS | `~/Library/LaunchAgents/ai.bytedesk.agent-orchestration.plist` | `RunAtLoad`, `KeepAlive` |
| Windows | Task Scheduler task `ByteDesk\agent-orchestration`, from `schtasks /Create /XML` | logon trigger, restart on failure, no time limit |
| WSL without systemd | none; a detached process-compose, started again by every `ensure` | — |

Each registration runs `process-compose up -f <yaml> -t=false`, with its control API on a loopback port or Unix socket recorded in `<stateRoot>/services/manager.json`.

The code is `src/services/os-registration.mjs`: one `register` / `unregister` / `isRegistered` per platform in a plain `switch (process.platform)`. It reuses `src/runtime/user-bus.mjs` and `src/platform/windows-native-runtime.mjs`.

### 5. New CLI: `agent-orchestration services install | ensure | status | probe | uninstall`

- **`ensure`** is idempotent, fast and the same on every OS. It:
  - installs process-compose if missing;
  - refreshes `current.json`;
  - regenerates the YAML and the OS registration only when their content changed;
  - starts the registration if process-compose is not answering;
  - hot-reloads changed config through process-compose's project update;
  - restarts processes when the plugin sha changed.
- **`status`** shows the OS registration, process-compose health, and each process's state, pid, restart count and readiness. It reads these from the process-compose API.
- **`uninstall`** removes the registration and stops process-compose. It keeps the binary and state.

Callers of `ensure`:
- the plugin's `SessionStart` hook;
- `monitors/monitors.json` `ao-supervise`, changed from `supervise` to `services ensure`;
- every lazy launcher below;
- the gateway.

### 6. Route the existing launchers through process-compose

- **Session host.** `ensureSessionHost` (`src/service.mjs:299`) runs `services ensure`, then waits for the lease (`waitForSessionHostLease`). The 24-hour scope and the in-process fallback remain only behind `AGENT_ORCHESTRATION_SERVICES=0`.
- **Session host, single instance.** A hand-run `session-host` probes first and exits 0 if a healthy host already owns the state root.
- **Repository supervisor.** `startRepositorySupervision` (`topology/lib/supervision.mjs:445`) adds the repository to `repos.json` and runs `ensure`, which hot-reloads the config, instead of doing a detached spawn.
- **NATS.** `ensureLocalNats` (`nats-local.mjs:66`) runs `ensure` instead of spawning.

### 7. Gateway (`bytedesk-remote-gateway`)

When the port dial in `orchestration_runs_control.go:84-169` fails:
1. run `agent-orchestration services ensure` once (rate-limited by the existing 2-second cache);
2. dial again.

Only then does it return `ACP_CONTROL_UNAVAILABLE`, whose message (`orchestration_workflows.go:413`) then names `agent-orchestration services ensure`. The gateway's setup also runs `ensure`, which closes the gateway's TM-457.

### 8. Where the work happens, cleanup, version

- **ao:** a new worktree off `fix/ao-local-nats-autostart` at `bbe8884` in `~/Documents/GitHub/ByteDeskAI/bytedesk-marketplace`, on branch `tm/TM-nnn-ao-process-compose`. The 200 uncommitted files there are untouched.
- **Gateway:** a feature branch in the gateway repo.
- **Tracking:** one `tm` task in each repo before coding.
- **Cleanup:**
  - stop the session host I started by hand (pid 2598129);
  - stop the three leaked `/tmp/ao-clean-install-*` session-host scopes;
  - make the clean-install test stop what it starts.
- **Version:** ao stays versionless on the Claude side. Bump ao's own semver markers (minor) and `CHANGELOG.md`.

## Verification

All of these must be able to fail.

1. **Unit tests** (`node --test --test-concurrency=1`):
   - YAML and registration renderers for `linux`, `darwin` and `win32`, given a repository path with a space and parentheses;
   - platform guards include or leave out `nats` and `supervise`;
   - `ensure` is idempotent: a second run writes nothing and reloads nothing;
   - a download with a wrong SHA-256 is refused;
   - a second hand-run `session-host` exits 0 without touching `lease.json`.

   Fake `systemctl`, `launchctl`, `schtasks` and `process-compose` on `PATH` record their argument lists, and the tests assert on those lists.
2. **Live Linux** (this machine):
   - `services ensure`, then `status` shows every process ready.
   - `kill -9` the session host: a new pid appears within 5 s, and `/api/health` answers.
   - Repeat for NATS and for one supervise process.
   - `kill -9` process-compose itself: systemd brings it back, and it brings back the children.
   - Record every pid.
3. **macOS and Windows:**
   - the renderers and the `ensure` paths are covered by the unit tests;
   - live checks need those machines, so I'll report them as unverified unless one is available.
4. **Recovery without a session:**
   - Close every Claude/Codex session.
   - Start a run and `kill -9` its worker.
   - Within 60 s, the managed `session-host` marks the run `recovery_required`.
   - Read the run's events to confirm which pid wrote the change.
5. **Plugin update:** after `claude plugin update agent-orchestration@bytedesk`, the next `ensure` updates `current.json` to the new sha and restarts the processes. Compare the sha and pids before and after.
6. **Gateway, through agent-browser:**
   - stop the session host and open the orchestration tab: it loads with no error;
   - with `services uninstall` and the host stopped, the error shows the new command text.

## ao skills (answer to your second question)

| Skill | What it does |
|---|---|
| `/agent-orchestration:agent-orchestrate` | Hands bounded work to Claude, Codex, Grok or Kimi through the MCP server |
| `/agent-orchestration:agent-orchestration-doctor` | Checks the plugin, provider CLIs, adapters and state paths |
| `/agent-orchestration:goal-feedback-loop` | Drives an admitted goal through PM, implementation, validation and dogfood |
| `/agent-orchestration:install-codex-orchestration-agent` | Installs the Codex custom-agent template |
| `/agent-orchestration:install-orchestration-host` | Sets up Claude, Codex, Grok or Kimi as an orchestration host |
| `/agent-orchestration:orchestration-compose` | Turns a team description into a validated tmux workflow |
| `/agent-orchestration:orchestration-conduct` | The conductor's protocol inside a launched run |
| `/agent-orchestration:orchestration-launch` | Launches a saved workflow as a tmux session |
| `/agent-orchestration:orchestration-status` | Inspects, troubleshoots or stops a running tmux run |
| `/agent-orchestration:roadmap-orchestrator` | Maintains ROADMAP.md and picks the next work |
| `/agent-orchestration:setup-agent-orchestration` | Prepares a machine: tmux, CLIs, folders, extra adapters |
