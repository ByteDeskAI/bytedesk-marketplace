package main

// Phase 12.10 (BDM-28, B17). Wraps the tailscale CLI to expose the
// dashboard over the user's tailnet.
//
//   POST /api/tailscale/start    body: {"funnel":bool}  → tailscale {serve|funnel} --bg
//   POST /api/tailscale/stop                            → tailscale serve --remove
//   GET  /api/tailscale/status                          → tailscale serve status --json
//
// Settings persist the toggle separately; this just runs the CLI.
// Output is best-effort — tailscale must be installed and the user
// authenticated; we surface stderr verbatim on errors.

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
)

func handleTailscale(w http.ResponseWriter, r *http.Request, deps *apiDeps, sub string) {
	if _, err := exec.LookPath("tailscale"); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":    false,
			"error": "tailscale CLI not on PATH",
		})
		return
	}

	switch sub {
	case "start":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("POST"))
			return
		}
		var body struct {
			Funnel bool `json:"funnel"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		origin := fmt.Sprintf("http://%s:%d", deps.cfg.Bind, deps.cfg.Port)
		args := []string{"serve", "--bg", origin}
		if body.Funnel {
			args = []string{"funnel", "--bg", origin}
		}
		cmd := exec.Command("tailscale", args...)
		out, err := cmd.CombinedOutput()
		if err != nil {
			writeError(w, http.StatusBadGateway, fmt.Errorf("tailscale: %v: %s", err, string(out)))
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stdout": strings.TrimSpace(string(out))})

	case "stop":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, errors.New("POST"))
			return
		}
		// Best-effort remove for both modes.
		_, _ = exec.Command("tailscale", "serve", "--bg=false").CombinedOutput()
		out, err := exec.Command("tailscale", "serve", "reset").CombinedOutput()
		if err != nil {
			// Older tailscale may not support `reset`; try removing by URL.
			origin := fmt.Sprintf("http://%s:%d", deps.cfg.Bind, deps.cfg.Port)
			out, err = exec.Command("tailscale", "serve", "--remove", origin).CombinedOutput()
			if err != nil {
				writeError(w, http.StatusBadGateway, fmt.Errorf("tailscale stop: %v: %s", err, string(out)))
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stdout": strings.TrimSpace(string(out))})

	case "status":
		out, _ := exec.Command("tailscale", "serve", "status", "--json").Output()
		var parsed any
		_ = json.Unmarshal(out, &parsed)
		writeJSON(w, http.StatusOK, map[string]any{"raw": parsed, "rawText": string(out)})

	default:
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown tailscale subpath %q", sub))
	}
}
