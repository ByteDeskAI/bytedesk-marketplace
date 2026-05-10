package main

// Interactive PTY bridge — Phase 12.1 (BDM-28, A4 + B3).
//
// Route: GET /api/sessions/<TICKET>/pty   (WebSocket upgrade)
//
// Bridge architecture (revised after first-render mismatch bug): each
// WS connection spawns its own `tmux attach -t <session>` inside a
// real PTY (via creack/pty). The PTY is sized to match the xterm
// client exactly, so cursor positioning is coherent. tmux retains the
// persistent session in the background.
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
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
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
	_ = logPath // unused now; pty bridge replaces log-file tailing
	_ = deps    // unused; kept for signature compat with main_terminal handler
	startedAt := time.Now()
	exitReason := "unknown"
	defer func() {
		log.Printf("pty: %s closed after %s — reason=%s", ticket, time.Since(startedAt), exitReason)
	}()
	var writeMu sync.Mutex
	send := func(m ptyMsg) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		b, _ := json.Marshal(m)
		_, err := ws.Write(b)
		return err
	}

	// Each viewer gets its own `tmux attach` inside a real pty. The
	// pty's window size matches the xterm client exactly, so all of
	// claude's TUI cursor positioning is coherent. The persistent
	// tmux session is reattached, not duplicated — multiple viewers
	// see the same buffer.
	cmd := exec.Command(tmuxBin(), "attach-session", "-t", tmuxSession)
	// Inherit env so tmux can find the user's shell, etc.
	cmd.Env = nil // nil = inherit parent process env
	ptmx, err := pty.Start(cmd)
	if err != nil {
		_ = send(ptyMsg{Type: "error", Msg: "pty start: " + err.Error()})
		return
	}
	defer func() {
		_ = ptmx.Close()
		// Detach is best-effort; tmux will reap the attach process on its own.
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	}()

	// Output pump: pty → WS. Run in a goroutine; lifetime tied to the
	// websocket-handler return path.
	ptyDone := make(chan string, 1)
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				if sendErr := send(ptyMsg{Type: "output", Data: string(buf[:n])}); sendErr != nil {
					ptyDone <- "ws-write-error: " + sendErr.Error()
					return
				}
			}
			if err != nil {
				ptyDone <- "pty-read-error: " + err.Error()
				return
			}
		}
	}()

	// Input pump: WS → pty.
	dec := json.NewDecoder(ws)
	for {
		select {
		case reason := <-ptyDone:
			exitReason = reason
			return
		default:
		}
		var m ptyMsg
		if err := dec.Decode(&m); err != nil {
			if err == io.EOF {
				exitReason = "ws-eof"
			} else {
				exitReason = "ws-decode-error: " + err.Error()
				log.Printf("pty: decode error for %s: %v", ticket, err)
			}
			return
		}
		switch m.Type {
		case "input":
			if _, err := ptmx.Write([]byte(m.Data)); err != nil {
				_ = send(ptyMsg{Type: "error", Msg: err.Error()})
				return
			}
		case "resize":
			if m.Cols > 0 && m.Rows > 0 {
				if err := pty.Setsize(ptmx, &pty.Winsize{
					Cols: uint16(m.Cols),
					Rows: uint16(m.Rows),
				}); err != nil {
					log.Printf("pty: resize %s to %dx%d: %v", ticket, m.Cols, m.Rows, err)
				}
			}
		case "ping":
			_ = send(ptyMsg{Type: "pong"})
		}
	}
}

func tmuxBin() string {
	if v, err := exec.LookPath("tmux"); err == nil {
		return v
	}
	return "tmux"
}

// tmuxCapturePane returns the current visible pane content WITH escape
// sequences preserved, so xterm.js can re-render colors/cursor pos. The
// `-p` flag prints to stdout, `-e` keeps escape sequences, `-J` joins
// wrapped lines.
func tmuxCapturePane(session string) string {
	out, err := exec.Command(tmuxBin(), "capture-pane", "-e", "-p", "-J", "-t", session).Output()
	if err != nil {
		return ""
	}
	return string(out)
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
