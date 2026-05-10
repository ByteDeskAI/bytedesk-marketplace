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
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"time"

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

// mainWorktree resolves the project worktree path that the
// `fleet-main-<KEY>` tmux session is rooted in. Mirrors the lookup
// `ensureMainTmux` does — read it from `web/worktree`, then fall back
// to cwd. Returns "" if neither resolves.
func mainWorktree(deps *apiDeps) string {
	_, logPath := mainTmuxSession(deps)
	cwd := readProjectLabel(filepath.Dir(filepath.Dir(logPath)))
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	return cwd
}

// handleMainMessages — chat-mode bootstrap for the main terminal.
// Reads the most-recent jsonl in the main worktree's project dir and
// projects it into UIMessage[]. Mirrors handleSessionMessages but
// resolves the worktree from main's tmux config rather than from
// SessionRepo.
func handleMainMessages(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	limit := 200
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	wt := mainWorktree(deps)
	path := findTranscript(wt)
	if path == "" {
		writeJSON(w, http.StatusOK, []UIMessage{})
		return
	}
	msgs, err := readUIMessages(path, limit, r.URL.Query().Get("before"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	if msgs == nil {
		msgs = []UIMessage{}
	}
	writeJSON(w, http.StatusOK, msgs)
}

// handleMainTranscript — SSE stream of TranscriptEvent for the main
// terminal. Subscribes to the same bus topic that TranscriptStream
// publishes on for the synthetic `__main__` ticket.
func handleMainTranscript(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	sub := deps.bus.Subscribe(Topic("transcript." + mainTicket))
	defer deps.bus.Unsubscribe(sub)

	if st, ok := deps.transcript.Stats(mainTicket); ok {
		b, _ := json.Marshal(st)
		fmt.Fprintf(w, "event: stats\ndata: %s\n\n", b)
		flusher.Flush()
	}

	keep := time.NewTicker(15 * time.Second)
	defer keep.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-keep.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		case msg, ok := <-sub.C():
			if !ok {
				return
			}
			b, _ := json.Marshal(msg.Body)
			fmt.Fprintf(w, "event: transcript\ndata: %s\n\n", b)
			flusher.Flush()
		}
	}
}

// mainTicket is the synthetic ticket key TranscriptStream uses for
// the always-on main terminal so it can ride the same tailer +
// EventBus machinery as fleet child sessions.
const mainTicket = "__main__"

// handleMainSend — POST /api/main/send. Mirrors handleSessionSend but
// targets the persistent fleet-main tmux session instead of going
// through `claude-sessions send` (which is keyed off a fleet ticket).
// Composes the body text + Enter as a single tmux send-keys call so
// the line commits to claude's stdin (BDM-33).
func handleMainSend(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	var body struct {
		Message string `json:"message"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid json: %w", err))
		return
	}
	if body.Message == "" {
		writeError(w, http.StatusBadRequest, errors.New("message required"))
		return
	}
	session, _ := mainTmuxSession(deps)
	// `-l` (literal) preserves arbitrary text without tmux interpreting
	// it as named keys. Then a separate `Enter` to commit the line.
	cmd := exec.Command(tmuxBin(), "send-keys", "-t", session, "-l", "--", body.Message)
	if out, err := cmd.CombinedOutput(); err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("send literal: %v: %s", err, string(out)))
		return
	}
	enter := exec.Command(tmuxBin(), "send-keys", "-t", session, "Enter")
	if out, err := enter.CombinedOutput(); err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("send enter: %v: %s", err, string(out)))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleMainKeys — POST /api/main/keys. Same shape + allowlist as
// handleSessionKeys but targets the main tile's tmux session.
func handleMainKeys(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	var body struct {
		Keys []string `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid json: %w", err))
		return
	}
	if len(body.Keys) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("keys required"))
		return
	}
	session, _ := mainTmuxSession(deps)
	if err := sendTmuxKeys(session, body.Keys); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "keys": body.Keys})
}
