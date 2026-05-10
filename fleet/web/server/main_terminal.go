package main

// main_terminal.go — the "always-on" main terminal exposed at
// /api/main/pty. Lazily creates a per-project tmux session named
// `fleet-main-<KEY>` rooted in the project worktree, with `tmux
// pipe-pane -O` tee'ing output to web/main.log so the existing
// pumpLogToWS plumbing in pty_handler.go can stream it.
//
// Lifecycle: created on first /api/main/pty connect; reattached on
// every subsequent connect. Survives dashboard restarts (tmux owns
// the session, not the dashboard process).

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"golang.org/x/net/websocket"
)

// mainTmuxSession returns the deterministic tmux session name + log
// file path for this project's main terminal.
func mainTmuxSession(deps *apiDeps) (session, logPath string) {
	session = "fleet-main-" + deps.projectKey
	pd, _ := projectDir()
	logPath = filepath.Join(pd, "web", "main.log")
	return
}

// ensureMainTmux creates the tmux session if it doesn't exist and
// starts piping its pane to the log file. The session runs `claude`
// in the project worktree (matching how fleet child sessions launch),
// so the user always has a working Claude conversation rooted here.
// Idempotent — has-session short-circuits if it's already running.
func ensureMainTmux(deps *apiDeps) error {
	session, logPath := mainTmuxSession(deps)
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return err
	}

	// Resolve the project's worktree.
	cwd := readProjectLabel(filepath.Dir(filepath.Dir(logPath)))
	if cwd == "" {
		cwd, _ = os.Getwd()
	}

	if err := exec.Command(tmuxBin(), "has-session", "-t", session).Run(); err != nil {
		// Locate the claude CLI. Falls back to plain shell if claude
		// isn't on PATH so the dashboard still gives the user a
		// terminal to work in.
		claude, lookErr := exec.LookPath("claude")
		var args []string
		if lookErr == nil {
			args = []string{"new-session", "-d", "-s", session, "-c", cwd, claude}
		} else {
			// No claude — just spawn a shell.
			args = []string{"new-session", "-d", "-s", session, "-c", cwd}
		}
		create := exec.Command(tmuxBin(), args...)
		if out, err := create.CombinedOutput(); err != nil {
			return fmt.Errorf("tmux new-session: %w: %s", err, string(out))
		}
	}

	// Always (re-)pipe-pane to the log file. tmux's pipe-pane is
	// idempotent within a session — calling it again replaces the
	// previous shell command with the new one.
	cmd := exec.Command(tmuxBin(), "pipe-pane", "-t", session, "-O", fmt.Sprintf("cat >> %q", logPath))
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("tmux pipe-pane: %w: %s", err, string(out))
	}
	return nil
}

// handleMainPty — WebSocket bridge for the main terminal. Mirrors
// handleSessionPty but resolves the tmux session and log file from
// mainTmuxSession() instead of a fleet meta file.
func handleMainPty(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if err := ensureMainTmux(deps); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	session, logPath := mainTmuxSession(deps)

	srv := websocket.Server{
		Handshake: func(_ *websocket.Config, _ *http.Request) error { return nil },
		Handler: func(ws *websocket.Conn) {
			defer ws.Close()
			runPty(ws, "_main", session, logPath, deps)
		},
	}
	srv.ServeHTTP(w, r)
}

// handleMainInfo — GET /api/main returns the main terminal's tmux
// session + log path so a client can decide whether the page should
// render the tile (today: always).
func handleMainInfo(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	session, logPath := mainTmuxSession(deps)
	writeJSON(w, http.StatusOK, map[string]any{
		"tmux_session": session,
		"log_path":     logPath,
		"project_key":  deps.projectKey,
	})
}
