package main

// Action handlers — mutate state by shelling out to `claude-sessions`.
// Adapter pattern: we don't reimplement kill/send/clean, we wrap the
// existing CLI so the safety + lifecycle invariants stay in one place.
//
//   POST /api/sessions/<TICKET>/send   body: {"message": "..."}
//   POST /api/sessions/<TICKET>/kill   body: {} → returns 200 on success,
//                                       409 + error if claude-sessions
//                                       refuses (uncommitted changes etc).
//   POST /api/clean                    purge dead-session metas

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
)

// claudeSessionsBin returns the path to the bin script. Plugin install
// puts it on PATH, so a bare lookup works.
func claudeSessionsBin() string {
	if v, err := exec.LookPath("claude-sessions"); err == nil {
		return v
	}
	return "claude-sessions"
}

func handleSessionSend(w http.ResponseWriter, r *http.Request, ticket string) {
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
	if strings.TrimSpace(body.Message) == "" {
		writeError(w, http.StatusBadRequest, errors.New("message required"))
		return
	}
	cmd := exec.Command(claudeSessionsBin(), "send", ticket, body.Message)
	out, err := cmd.CombinedOutput()
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("send failed: %v: %s", err, string(out)))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stdout": strings.TrimSpace(string(out))})
}

// allowedTmuxKeys is the allowlist of tmux send-keys named keys that
// /api/sessions/<T>/keys and /api/main/keys will dispatch. Anything
// outside this set is a 400 — guards against shell-injection via the
// keys body. tmux send-keys without -l interprets these as named
// keys; arbitrary text would risk arbitrary input.
var allowedTmuxKeys = map[string]struct{}{
	"Up": {}, "Down": {}, "Left": {}, "Right": {},
	"Space": {}, "Enter": {}, "Tab": {}, "Escape": {},
	"BSpace": {}, "Home": {}, "End": {},
	"PageUp": {}, "PageDown": {},
}

// handleSessionKeys — POST /api/sessions/<T>/keys
//
// Body: {"keys": ["Down", "Down", "Enter", ...]}
//
// Used by AskUserQuestionCard (BDM-33) to drive claude's CLI list-
// picker from chat mode. Resolves the session's tmux name via the
// SessionRepo, validates every key against allowedTmuxKeys, and
// shells `tmux send-keys -t <session> <k1> <k2> …`. Each key is its
// own argv entry — tmux interprets named keys without -l, so we must
// NOT pass -l here (that flag would force literal mode).
func handleSessionKeys(w http.ResponseWriter, r *http.Request, deps *apiDeps, ticket string) {
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
	for _, k := range body.Keys {
		if _, ok := allowedTmuxKeys[k]; !ok {
			writeError(w, http.StatusBadRequest, fmt.Errorf("disallowed key %q", k))
			return
		}
	}
	s, err := deps.sessions.Get(ticket)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("ticket %q not found", ticket))
		return
	}
	if s.TmuxSession == "" {
		writeError(w, http.StatusConflict, fmt.Errorf("session %q has no tmux session", ticket))
		return
	}
	if err := sendTmuxKeys(s.TmuxSession, body.Keys); err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "keys": body.Keys})
}

// sendTmuxKeys is the shared send-keys-with-allowlist primitive used
// by both /api/sessions/<T>/keys and /api/main/keys.
func sendTmuxKeys(tmuxSession string, keys []string) error {
	for _, k := range keys {
		if _, ok := allowedTmuxKeys[k]; !ok {
			return fmt.Errorf("disallowed key %q", k)
		}
	}
	args := append([]string{"send-keys", "-t", tmuxSession}, keys...)
	cmd := exec.Command(tmuxBin(), args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("tmux send-keys: %v: %s", err, string(out))
	}
	return nil
}

func handleSessionKill(w http.ResponseWriter, r *http.Request, ticket string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	// Pipe `y\n` so the CLI's interactive confirm proceeds without a TTY.
	cmd := exec.Command(claudeSessionsBin(), "kill", ticket)
	cmd.Stdin = strings.NewReader("y\n")
	out, err := cmd.CombinedOutput()
	if err != nil {
		// If the worktree has uncommitted work, claude-sessions kill aborts
		// the worktree-removal step and surfaces a non-zero exit. Translate
		// to 409 Conflict so the client can show the safety dialog.
		status := http.StatusBadGateway
		if strings.Contains(string(out), "uncommitted") {
			status = http.StatusConflict
		}
		writeError(w, status, fmt.Errorf("kill failed: %v: %s", err, string(out)))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stdout": strings.TrimSpace(string(out))})
}

// handleBroadcast — Phase 7 (BDM-22, B6). Sends the same message to every
// active session. "Active" = state in {starting, working, needs-input,
// reviewing}. Aggregates per-session results so the client can show
// per-target outcome.
//
//	POST /api/broadcast  body: {"message": "..."}
func handleBroadcast(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
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
	if strings.TrimSpace(body.Message) == "" {
		writeError(w, http.StatusBadRequest, errors.New("message required"))
		return
	}
	sl, err := deps.sessions.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	type result struct {
		Ticket string `json:"ticket"`
		OK     bool   `json:"ok"`
		Error  string `json:"error,omitempty"`
	}
	results := []result{}
	for _, s := range sl {
		if !isActiveState(s.State) {
			continue
		}
		cmd := exec.Command(claudeSessionsBin(), "send", s.Ticket, body.Message)
		out, err := cmd.CombinedOutput()
		if err != nil {
			results = append(results, result{Ticket: s.Ticket, OK: false, Error: strings.TrimSpace(string(out))})
		} else {
			results = append(results, result{Ticket: s.Ticket, OK: true})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "results": results})
}

func isActiveState(s string) bool {
	switch s {
	case "starting", "working", "needs-input", "reviewing":
		return true
	}
	return false
}

func handleClean(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	cmd := exec.Command(claudeSessionsBin(), "clean")
	out, err := cmd.CombinedOutput()
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("clean failed: %v: %s", err, string(out)))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stdout": strings.TrimSpace(string(out))})
}
