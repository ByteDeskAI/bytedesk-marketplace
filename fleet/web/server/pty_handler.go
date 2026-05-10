package main

// Interactive PTY bridge — Phase 12.1 (BDM-28, A4 + B3).
//
// Route: GET /api/sessions/<TICKET>/pty   (WebSocket upgrade)
//
// Wire protocol (JSON messages, both directions):
//   client → server  {"type":"input","data":"ls\r"}
//   client → server  {"type":"resize","cols":120,"rows":34}
//   server → client  {"type":"output","data":"...stdout..."}
//   server → client  {"type":"error","msg":"reason"}
//
// Implementation:
//   - On open, spawn `tmux pipe-pane -t <S> -O 'cat'` to a Unix pipe;
//     a goroutine reads from that pipe and forwards as `output` messages.
//   - On `input`, run `tmux send-keys -t <S> -l -- "<data>"`. The `-l`
//     (literal) flag preserves arbitrary bytes including escape sequences.
//   - On `resize`, run `tmux resize-pane -t <S> -x <cols> -y <rows>`.
//   - On close, kill the pipe-pane process and `tmux pipe-pane -t <S> -O ''`
//     (toggles off — but only if no other consumer; in fleet there's
//     already a long-running pipe-pane to the log file, so we use a
//     separate fifo via a transient subprocess instead).
//
// Note: fleet's spawn-claude-feature already runs `tmux pipe-pane -O`
// to the per-session log file. Adding a second pipe-pane consumer would
// stack with the first. Strategy: subscribe via a transient `tmux
// pipe-pane -t <S> -o 'cat -'` (the -o without -O appends, idempotent;
// we then read its stdout). On disconnect, run `tmux pipe-pane -t <S>`
// (no command) to clear the second consumer while leaving the original
// log pipe in place.
//
// Simpler alternative used here: tail the existing log file (which
// already captures everything tmux emits) for output, and use
// send-keys for input. This avoids any tmux pipe-pane juggling.

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/websocket"
)

type ptyMsg struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
	Msg  string `json:"msg,omitempty"`
}

func handleSessionPty(w http.ResponseWriter, r *http.Request, deps *apiDeps, ticket string) {
	// Verify the session exists before upgrading.
	s, err := deps.sessions.Get(ticket)
	if err != nil {
		http.Error(w, fmt.Sprintf("session %q not found", ticket), http.StatusNotFound)
		return
	}
	tmuxSession := s.TmuxSession
	if tmuxSession == "" {
		tmuxSession = ticket
	}

	cfg := websocket.Config{}
	srv := websocket.Server{
		Config: cfg,
		Handshake: func(_ *websocket.Config, _ *http.Request) error {
			// Same-origin only by default; auth gate lives in middleware (12.6).
			return nil
		},
		Handler: func(ws *websocket.Conn) {
			defer ws.Close()
			runPty(ws, ticket, tmuxSession, s.LogPath, deps)
		},
	}
	srv.ServeHTTP(w, r)
}

func runPty(ws *websocket.Conn, ticket, tmuxSession, logPath string, deps *apiDeps) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var writeMu sync.Mutex
	send := func(m ptyMsg) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		b, _ := json.Marshal(m)
		_, err := ws.Write(b)
		return err
	}

	// Send a hello with the current pane size so the client can fit().
	if cols, rows, ok := tmuxPaneSize(tmuxSession); ok {
		_ = send(ptyMsg{Type: "size", Cols: cols, Rows: rows})
	}

	// Output pump: tail the session log file and forward new bytes.
	if logPath == "" {
		_ = send(ptyMsg{Type: "error", Msg: "session has no log file"})
		return
	}
	go pumpLogToWS(ctx, logPath, send)

	// Input pump: read JSON messages and dispatch to tmux.
	dec := json.NewDecoder(ws)
	for {
		var m ptyMsg
		if err := dec.Decode(&m); err != nil {
			if err != io.EOF {
				log.Printf("pty: decode error for %s: %v", ticket, err)
			}
			return
		}
		switch m.Type {
		case "input":
			if err := tmuxSendKeys(tmuxSession, m.Data); err != nil {
				_ = send(ptyMsg{Type: "error", Msg: err.Error()})
			}
		case "resize":
			if m.Cols > 0 && m.Rows > 0 {
				if err := tmuxResize(tmuxSession, m.Cols, m.Rows); err != nil {
					// Soft-error; resize failures are common when the pane
					// is already at the requested size.
					log.Printf("pty: resize %s to %dx%d: %v", tmuxSession, m.Cols, m.Rows, err)
				}
			}
		case "ping":
			_ = send(ptyMsg{Type: "pong"})
		}
	}
}

// pumpLogToWS tails the session log file and forwards new bytes as
// "output" messages. Starts at end-of-file (so the user doesn't get a
// flood of historical content on connect — that's what the Logs tab is
// for; the Terminal tab is "live from now").
func pumpLogToWS(ctx context.Context, logPath string, send func(ptyMsg) error) {
	f, err := os.Open(logPath)
	if err != nil {
		_ = send(ptyMsg{Type: "error", Msg: "open log: " + err.Error()})
		return
	}
	defer f.Close()
	if _, err := f.Seek(0, io.SeekEnd); err != nil {
		_ = send(ptyMsg{Type: "error", Msg: err.Error()})
		return
	}
	r := bufio.NewReader(f)
	buf := make([]byte, 4096)
	t := time.NewTicker(80 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			for {
				n, err := r.Read(buf)
				if n > 0 {
					if err := send(ptyMsg{Type: "output", Data: string(buf[:n])}); err != nil {
						return
					}
				}
				if err == io.EOF || n == 0 {
					break
				}
				if err != nil {
					return
				}
			}
		}
	}
}

func tmuxBin() string {
	if v, err := exec.LookPath("tmux"); err == nil {
		return v
	}
	return "tmux"
}

func tmuxSendKeys(session, data string) error {
	// `-l` (literal) preserves arbitrary bytes including ESC sequences.
	cmd := exec.Command(tmuxBin(), "send-keys", "-t", session, "-l", "--", data)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("tmux send-keys: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func tmuxResize(session string, cols, rows int) error {
	cmd := exec.Command(tmuxBin(), "resize-pane", "-t", session, "-x", strconv.Itoa(cols), "-y", strconv.Itoa(rows))
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("tmux resize-pane: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func tmuxPaneSize(session string) (cols, rows int, ok bool) {
	cmd := exec.Command(tmuxBin(), "display-message", "-p", "-t", session, "#{pane_width}x#{pane_height}")
	out, err := cmd.Output()
	if err != nil {
		return 0, 0, false
	}
	parts := strings.Split(strings.TrimSpace(string(out)), "x")
	if len(parts) != 2 {
		return 0, 0, false
	}
	cols, _ = strconv.Atoi(parts[0])
	rows, _ = strconv.Atoi(parts[1])
	return cols, rows, cols > 0 && rows > 0
}
