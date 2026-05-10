package main

// claude-sessions-web — fleet plugin web dashboard server (BDM-14, Phase 1).
//
// Lifecycle:
//   1. CLAUDE_SESSION_DEPTH >= 1 → exit 0 (parent's daemon covers the project).
//   2. Acquire per-project PID lock at ${CLAUDE_PLUGIN_DATA}/projects/<KEY>/web/pid.
//      If held by a live peer, stand by and re-poll every 5s.
//   3. Load or assign port (hash-based first-pick, fallback walk, rewrite config).
//   4. Trap SIGINT / SIGTERM / SIGHUP; release lock + exit on signal.
//   5. Listen and serve until a fatal error or a signal.

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// probeRunningVersion does a short-timeout GET on /api/version of the
// existing running server and returns its `build` string. Returns ""
// on any failure (server unreachable, slow, returning unexpected
// payload). Used by the reuse-or-reload launch flow (BDM-44) to
// decide whether to defer to the running server or preempt it.
func probeRunningVersion(cfg *WebConfig) string {
	addr := net.JoinHostPort(cfg.Bind, strconv.Itoa(cfg.Port))
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	req, err := http.NewRequest(http.MethodGet, "http://"+addr+"/api/version", nil)
	if err != nil {
		return ""
	}
	if cfg.AuthToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AuthToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	var body struct {
		Build string `json:"build"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return ""
	}
	return body.Build
}

// Phase 12 note: standby polling was replaced by preemptive takeover
// in lock.go's AcquirePreempt — one dashboard per project, last-launch
// wins. The constant is preserved (commented out) so the original
// BDM-4 standby pattern stays discoverable for the notify daemon,
// which still uses it.
// const standbyPollSeconds = 5

func main() {
	var (
		printVersion bool
	)
	flag.BoolVar(&printVersion, "version", false, "print version and exit")
	flag.Parse()

	if printVersion {
		fmt.Println("claude-sessions-web", buildVersion)
		return
	}

	// Depth gate (matches notify daemon — fleet child sessions don't run their
	// own dashboard server; the parent's covers the project).
	if depth, _ := strconv.Atoi(os.Getenv("CLAUDE_SESSION_DEPTH")); depth >= 1 {
		log.Println("claude-sessions-web: depth >= 1, exiting (parent's daemon covers the project)")
		return
	}

	pkey, err := projectKey()
	if err != nil {
		log.Fatalf("claude-sessions-web: cannot derive project key: %v", err)
	}
	webPath, err := webDir()
	if err != nil {
		log.Fatalf("claude-sessions-web: cannot derive web dir: %v", err)
	}
	if err := os.MkdirAll(webPath, 0o755); err != nil {
		log.Fatalf("claude-sessions-web: mkdir %s: %v", webPath, err)
	}

	// Record the canonical repo root so MainTile + downstream tooling
	// know where the project lives. Resolution order: CLAUDE_PROJECT_DIR
	// env (Claude Code injects it) → `git rev-parse --show-toplevel`
	// from cwd → cwd itself.
	worktree := os.Getenv("CLAUDE_PROJECT_DIR")
	if worktree == "" {
		if out, err := exec.Command("git", "rev-parse", "--show-toplevel").Output(); err == nil {
			worktree = strings.TrimSpace(string(out))
		}
	}
	if worktree == "" {
		worktree, _ = os.Getwd()
	}
	if worktree != "" {
		_ = os.WriteFile(filepath.Join(webPath, "worktree"), []byte(worktree), 0o644)
	}

	devMode := os.Getenv("DEV_MODE") == "1"

	var lock *Lock
	if !devMode {
		lock = &Lock{Path: filepath.Join(webPath, "pid")}

		// Reuse-or-reload: if a live peer already holds the lock,
		// fetch its build via /api/version. If it matches our own
		// `buildVersion` (i.e. the running server is already at the
		// latest binary on disk), exit cleanly and let the new
		// claude session reuse the existing dashboard. If the
		// versions differ, preempt + take over — effectively
		// reloading the old version with the new one (BDM-44).
		if pid, alive := lock.HolderInfo(); alive {
			if cfg := readExistingConfig(webPath); cfg != nil {
				running := probeRunningVersion(cfg)
				if running != "" && running == buildVersion {
					log.Printf("claude-sessions-web: server already running (pid=%d build=%s) at http://%s:%d — reusing", pid, running, cfg.Bind, cfg.Port)
					return
				}
				if running != "" {
					log.Printf("claude-sessions-web: peer running older build %s — reloading to %s", running, buildVersion)
				}
			}
		}

		// Preemptive takeover: if a peer holds the lock, SIGTERM it (grace
		// 3s) then SIGKILL. One dashboard per project, last-launch wins.
		prior, err := lock.AcquirePreempt(3 * time.Second)
		if err != nil {
			log.Fatalf("claude-sessions-web: lock acquire error: %v", err)
		}
		if prior > 0 {
			log.Printf("claude-sessions-web: preempted prior holder pid=%d (project %s)", prior, pkey)
		}
	} else {
		log.Println("claude-sessions-web: DEV_MODE=1 — skipping lock; will pick port from FLEET_DEV_PORT or OS-assigned")
	}

	var cfg *WebConfig
	if devMode {
		cfg = &WebConfig{Bind: "127.0.0.1"}
		if v := os.Getenv("FLEET_DEV_PORT"); v != "" {
			if p, err := strconv.Atoi(v); err == nil {
				cfg.Port = p
			}
		}
		if cfg.Port == 0 {
			cfg.Port = 7690 // dev default; production lives on hashedPort range
		}
	} else {
		var err error
		cfg, err = loadOrAssignPort(webPath, pkey)
		if err != nil {
			_ = lock.Release()
			log.Fatalf("claude-sessions-web: port assignment failed: %v", err)
		}
	}

	projDir, _ := projectDir()
	deps := newAPIDeps(pkey, cfg, projDir, dataRoot(), webPath)
	handler, err := buildHandler(deps)
	if err != nil {
		if lock != nil {
			_ = lock.Release()
		}
		log.Fatalf("claude-sessions-web: handler init: %v", err)
	}
	// Run the EventBus watcher; cancels with the main context.
	busCtx, busCancel := context.WithCancel(context.Background())
	defer busCancel()
	deps.bus.Run(busCtx, deps, 1000)
	defer deps.bus.Close()
	startDevDistWatcher(busCtx, deps.bus) // no-op outside `-tags dev`

	// Eagerly create the always-on `fleet-main-<KEY>` tmux session so
	// claude is already booted by the time the user opens #/grid.
	if err := ensureMainTmux(deps); err != nil {
		log.Printf("claude-sessions-web: ensureMainTmux failed (will retry on first connect): %v", err)
	}

	// Reaper kills tmux sessions whose state transitions to `done`,
	// so finished tournament variants don't linger as zombie tiles.
	NewReaper(deps).Run(busCtx)

	// Tailscale auto-install (BDM-50) — best-effort, non-blocking. If
	// the CLI is missing and sudo -n NOPASSWD is configured, this
	// installs it via the official tailscale.com/install.sh script.
	// Linux-only; logs once and exits on any precondition failure.
	go func() {
		s, err := deps.settings.Load()
		if err != nil {
			return
		}
		tailscaleAutoInstall(busCtx, s)
	}()

	// Transcript stream tails each session's Claude Code jsonl and
	// publishes typed events to the bus, keeping a per-ticket stats
	// cache for /api/sessions/<T>/stats.
	deps.transcript.Run(busCtx)
	addr := fmt.Sprintf("%s:%d", cfg.Bind, cfg.Port)
	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		s := <-sigCh
		log.Printf("claude-sessions-web: received %v, shutting down", s)
		cancel()
	}()

	log.Printf("claude-sessions-web: project=%s listening on http://%s/", pkey, addr)
	serverErr := make(chan error, 1)
	go func() {
		err := srv.ListenAndServe()
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
		close(serverErr)
	}()

	select {
	case <-ctx.Done():
	case err := <-serverErr:
		if err != nil {
			log.Printf("claude-sessions-web: server error: %v", err)
		}
	}

	shutCtx, shutCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutCancel()
	_ = srv.Shutdown(shutCtx)
	if lock != nil {
		_ = lock.Release()
	}
	log.Println("claude-sessions-web: shutdown complete")
}
