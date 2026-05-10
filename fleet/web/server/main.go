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
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

const standbyPollSeconds = 5

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

	lock := &Lock{Path: filepath.Join(webPath, "pid")}
	for {
		ok, err := lock.TryAcquire()
		if err != nil {
			log.Fatalf("claude-sessions-web: lock acquire error: %v", err)
		}
		if ok {
			break
		}
		log.Printf("claude-sessions-web: lock held by peer (project %s); standby polling every %ds", pkey, standbyPollSeconds)
		time.Sleep(standbyPollSeconds * time.Second)
	}

	cfg, err := loadOrAssignPort(webPath, pkey)
	if err != nil {
		_ = lock.Release()
		log.Fatalf("claude-sessions-web: port assignment failed: %v", err)
	}

	projDir, _ := projectDir()
	deps := newAPIDeps(pkey, cfg, projDir, dataRoot())
	handler, err := buildHandler(deps)
	if err != nil {
		_ = lock.Release()
		log.Fatalf("claude-sessions-web: handler init: %v", err)
	}
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
	_ = lock.Release()
	log.Println("claude-sessions-web: shutdown complete")
}
