package main

// Phase 12.3 (BDM-28). Bulk + lifecycle action endpoints. Each is a
// thin Adapter over an existing fleet CLI primitive so safety
// invariants remain in one place.
//
//   POST /api/sessions/<TICKET>/resume   (B8) wraps `claude-sessions resume`
//   POST /api/sessions/<TICKET>/rebase   (B9) shells `git fetch && git rebase`
//   POST /api/wait                       (A19) long-poll for state
//   POST /api/sweep                      (A20) wraps `/fleet:cleanup`
//   GET  /api/rules                      (A11) lists pending rules
//   DELETE /api/rules/<id>               (A11) cancels one
//   GET  /api/notify-state               (A12) reports notify-daemon lock holder

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ── B8 session resumption ───────────────────────────────────────────

func handleSessionResume(w http.ResponseWriter, r *http.Request, _ *apiDeps, ticket string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	cmd := exec.Command(claudeSessionsBin(), "resume", ticket)
	out, err := cmd.CombinedOutput()
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("resume failed: %v: %s", err, string(out)))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stdout": strings.TrimSpace(string(out))})
}

// ── B9 auto-rebase ──────────────────────────────────────────────────

func handleSessionRebase(w http.ResponseWriter, r *http.Request, deps *apiDeps, ticket string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	var body struct {
		Onto string `json:"onto"` // default: develop
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	onto := strings.TrimSpace(body.Onto)
	if onto == "" {
		onto = "develop"
	}
	s, err := deps.sessions.Get(ticket)
	if err != nil {
		writeError(w, http.StatusNotFound, fmt.Errorf("ticket %q not found", ticket))
		return
	}
	if s.Worktree == "" {
		writeError(w, http.StatusBadRequest, errors.New("session has no worktree"))
		return
	}

	fetch := exec.Command("git", "-C", s.Worktree, "fetch", "origin", onto)
	if out, err := fetch.CombinedOutput(); err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("fetch %s: %v: %s", onto, err, string(out)))
		return
	}
	rebase := exec.Command("git", "-C", s.Worktree, "rebase", "origin/"+onto)
	out, err := rebase.CombinedOutput()
	if err != nil {
		writeError(w, http.StatusConflict, fmt.Errorf("rebase: %v: %s", err, string(out)))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "onto": onto, "stdout": strings.TrimSpace(string(out))})
}

// ── A19 wait-for-state ──────────────────────────────────────────────
//
// Long-poll endpoint. Holds the connection up to `timeout` seconds (max
// 90s) waiting for the named ticket to enter the named state. Returns
// {matched, state, elapsed_seconds}.

func handleWait(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	var body struct {
		Ticket  string `json:"ticket"`
		State   string `json:"state"`
		Timeout int    `json:"timeout"` // seconds
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Errorf("invalid json: %w", err))
		return
	}
	if body.Ticket == "" || body.State == "" {
		writeError(w, http.StatusBadRequest, errors.New("ticket + state required"))
		return
	}
	if body.Timeout <= 0 || body.Timeout > 90 {
		body.Timeout = 90
	}

	deadline := time.Now().Add(time.Duration(body.Timeout) * time.Second)
	ctx, cancel := context.WithDeadline(r.Context(), deadline)
	defer cancel()

	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	start := time.Now()
	for {
		s, err := deps.sessions.Get(body.Ticket)
		if err == nil && s.State == body.State {
			writeJSON(w, http.StatusOK, map[string]any{
				"matched":         true,
				"state":           s.State,
				"elapsed_seconds": time.Since(start).Seconds(),
			})
			return
		}
		select {
		case <-ctx.Done():
			st := ""
			if s2, err := deps.sessions.Get(body.Ticket); err == nil {
				st = s2.State
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"matched":         false,
				"state":           st,
				"elapsed_seconds": time.Since(start).Seconds(),
			})
			return
		case <-t.C:
			// loop
		}
	}
}

// ── A20 sweep merged sessions ───────────────────────────────────────

func handleSweep(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST required"))
		return
	}
	cmd := exec.Command(claudeSessionsBin(), "cleanup")
	out, err := cmd.CombinedOutput()
	if err != nil {
		writeError(w, http.StatusBadGateway, fmt.Errorf("sweep: %v: %s", err, string(out)))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stdout": strings.TrimSpace(string(out))})
}

// ── A11 rules list/cancel ───────────────────────────────────────────

type Rule struct {
	ID      string                 `json:"id"`
	Path    string                 `json:"path"`
	Created time.Time              `json:"created"`
	Body    map[string]interface{} `json:"body,omitempty"`
}

func handleRules(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	dir := filepath.Join(filepath.Dir(deps.sessionsRoot()), "rules")
	switch r.Method {
	case http.MethodGet:
		entries, _ := os.ReadDir(dir)
		out := []Rule{}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			full := filepath.Join(dir, e.Name())
			info, _ := e.Info()
			rule := Rule{
				ID:      strings.TrimSuffix(e.Name(), filepath.Ext(e.Name())),
				Path:    full,
				Created: info.ModTime(),
			}
			if data, err := os.ReadFile(full); err == nil {
				_ = json.Unmarshal(data, &rule.Body)
			}
			out = append(out, rule)
		}
		writeJSON(w, http.StatusOK, out)
	default:
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET only"))
	}
}

func handleRuleDelete(w http.ResponseWriter, r *http.Request, deps *apiDeps, id string) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, errors.New("DELETE required"))
		return
	}
	dir := filepath.Join(filepath.Dir(deps.sessionsRoot()), "rules")
	// Try common extensions.
	for _, ext := range []string{"", ".json", ".rule"} {
		path := filepath.Join(dir, id+ext)
		if _, err := os.Stat(path); err == nil {
			if err := os.Remove(path); err != nil {
				writeError(w, http.StatusInternalServerError, err)
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": path})
			return
		}
	}
	writeError(w, http.StatusNotFound, fmt.Errorf("rule %q not found", id))
}

// ── A12 notify-daemon state ─────────────────────────────────────────

func handleNotifyState(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	dataDir := filepath.Dir(deps.sessionsRoot()) // .../projects/<KEY>
	notifyDir := filepath.Join(dataDir, "notify")
	pidFile := filepath.Join(notifyDir, "pid")

	resp := map[string]any{
		"holder_pid": 0,
		"alive":      false,
		"standby":    true,
		"notify_dir": notifyDir,
	}

	data, err := os.ReadFile(pidFile)
	if err != nil {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil || pid <= 0 {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	resp["holder_pid"] = pid
	if proc, err := os.FindProcess(pid); err == nil {
		// Signal 0 probes liveness without delivering a signal.
		if err := proc.Signal(nil); err == nil {
			resp["alive"] = true
			resp["standby"] = false
		}
	}
	writeJSON(w, http.StatusOK, resp)
}
