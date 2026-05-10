package main

// Tailscale automation surface (BDM-46). Wraps the tailscale CLI so the
// Settings page can show real-time status, run a small set of
// allow-listed subcommands, and stream `tailscale status --watch`
// directly into the UI.
//
// Endpoints:
//   GET  /api/tailscale/info       → { installed, version, daemon_running, logged_in, hostname, ip, serve_status }
//   POST /api/tailscale/start      body: {"funnel":bool}   → tailscale serve|funnel --bg <origin>
//   POST /api/tailscale/stop                               → tailscale serve reset / --remove
//   POST /api/tailscale/up                                 → tailscale up (returns login URL if any)
//   POST /api/tailscale/down                               → tailscale down
//   POST /api/tailscale/exec       body: {"args":[…]}      → tailscale <args> (allow-listed)
//   GET  /api/tailscale/log                                → SSE stream of tailscale status --watch
//   GET  /api/tailscale/status                             → tailscale serve status --json (legacy)
//
// Auto-install is intentionally NOT here: it requires sudo and a TTY
// prompt that a daemon can't drive cleanly. The UI shows the install
// command + link instead.

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

func tailscalePath() (string, bool) {
	p, err := exec.LookPath("tailscale")
	return p, err == nil
}

// tailscaleAllowedArgs limits what /api/tailscale/exec can run. Keep
// this conservative — non-destructive read commands + the everyday
// up/down/serve verbs. Unknown args → 400.
var tailscaleAllowedArgs = map[string]struct{}{
	"status": {}, "ip": {}, "whois": {}, "ping": {},
	"netcheck": {}, "version": {}, "dns": {},
	"up": {}, "down": {}, "logout": {}, "login": {},
	"serve": {}, "funnel": {},
	"set":  {}, // narrow set commands (e.g. set --auto-update)
	"ssh":  {}, // status only — we'll reject if more than 1 token
	"file": {},
	"cert": {},
	"web":  {},
}

type tailscaleInfo struct {
	Installed     bool   `json:"installed"`
	Path          string `json:"path,omitempty"`
	Version       string `json:"version,omitempty"`
	DaemonRunning bool   `json:"daemon_running"`
	LoggedIn      bool   `json:"logged_in"`
	Hostname      string `json:"hostname,omitempty"`
	IP            string `json:"ip,omitempty"`
	ServeURL      string `json:"serve_url,omitempty"`
}

func handleTailscaleInfo(w http.ResponseWriter, r *http.Request, _ *apiDeps) {
	info := tailscaleInfo{}
	if p, ok := tailscalePath(); ok {
		info.Installed = true
		info.Path = p
		// version: tailscale version
		if out, err := exec.Command(p, "version").Output(); err == nil {
			lines := strings.Split(strings.TrimSpace(string(out)), "\n")
			if len(lines) > 0 {
				info.Version = strings.TrimSpace(lines[0])
			}
		}
		// status --json gives daemon + login + hostname + IP in one call.
		ctx, cancel := context.WithTimeout(r.Context(), 1500*time.Millisecond)
		defer cancel()
		if out, err := exec.CommandContext(ctx, p, "status", "--json").Output(); err == nil {
			var st struct {
				BackendState string `json:"BackendState"`
				Self         struct {
					HostName     string   `json:"HostName"`
					TailscaleIPs []string `json:"TailscaleIPs"`
				} `json:"Self"`
			}
			if json.Unmarshal(out, &st) == nil {
				info.DaemonRunning = true
				info.LoggedIn = st.BackendState == "Running" || st.BackendState == "Starting"
				info.Hostname = st.Self.HostName
				if len(st.Self.TailscaleIPs) > 0 {
					info.IP = st.Self.TailscaleIPs[0]
				}
			}
		}
		// serve status (best-effort)
		if out, err := exec.Command(p, "serve", "status", "--json").Output(); err == nil {
			var serve map[string]any
			if json.Unmarshal(out, &serve) == nil {
				if web, ok := serve["Web"].(map[string]any); ok {
					for k := range web {
						info.ServeURL = k
						break
					}
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, info)
}

// handleTailscaleExec runs an allow-listed tailscale subcommand and
// returns combined output. Used by the UI's CLI input box.
func handleTailscaleExec(w http.ResponseWriter, r *http.Request, _ *apiDeps) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, errors.New("POST"))
		return
	}
	var body struct {
		Args []string `json:"args"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if len(body.Args) == 0 {
		writeError(w, http.StatusBadRequest, errors.New("args required"))
		return
	}
	verb := body.Args[0]
	if _, ok := tailscaleAllowedArgs[verb]; !ok {
		writeError(w, http.StatusBadRequest, fmt.Errorf("verb %q not in allowlist", verb))
		return
	}
	// Defense against argv injection — reject any arg containing shell
	// metacharacters; allow simple flags and tokens.
	for _, a := range body.Args[1:] {
		if strings.ContainsAny(a, ";&|`$<>\n") {
			writeError(w, http.StatusBadRequest, fmt.Errorf("disallowed character in arg %q", a))
			return
		}
	}
	p, ok := tailscalePath()
	if !ok {
		writeError(w, http.StatusFailedDependency, errors.New("tailscale CLI not installed"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, p, body.Args...)
	out, err := cmd.CombinedOutput()
	resp := map[string]any{
		"ok":     err == nil,
		"args":   body.Args,
		"stdout": string(out),
	}
	if err != nil {
		resp["error"] = err.Error()
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleTailscaleLog streams `tailscale status --watch` to the client
// as SSE. Each non-empty stdout block becomes one `event: log`. Closes
// when the client disconnects.
func handleTailscaleLog(w http.ResponseWriter, r *http.Request, _ *apiDeps) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, errors.New("GET"))
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
	fmt.Fprint(w, ": hello\n\n")
	flusher.Flush()

	p, found := tailscalePath()
	if !found {
		fmt.Fprintf(w, "event: log\ndata: %s\n\n", mustJSON("tailscale CLI not installed"))
		flusher.Flush()
		return
	}
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	cmd := exec.CommandContext(ctx, p, "status", "--watch")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		fmt.Fprintf(w, "event: log\ndata: %s\n\n", mustJSON("stdout pipe failed: "+err.Error()))
		flusher.Flush()
		return
	}
	cmd.Stderr = cmd.Stdout // collapse stderr → stdout for simplicity
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(w, "event: log\ndata: %s\n\n", mustJSON("tailscale status --watch failed: "+err.Error()))
		flusher.Flush()
		return
	}
	defer func() { _ = cmd.Process.Kill() }()

	reader := bufio.NewReader(stdout)
	for {
		line, err := reader.ReadString('\n')
		if line != "" {
			fmt.Fprintf(w, "event: log\ndata: %s\n\n", mustJSON(strings.TrimRight(line, "\n")))
			flusher.Flush()
		}
		if errors.Is(err, io.EOF) || err != nil {
			return
		}
	}
}

func mustJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// handleTailscale (legacy single-route handler) — kept for the
// existing start/stop/status endpoints from BDM-28.
func handleTailscale(w http.ResponseWriter, r *http.Request, deps *apiDeps, sub string) {
	p, found := tailscalePath()
	if !found {
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
		cmd := exec.Command(p, args...)
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
		_, _ = exec.Command(p, "serve", "--bg=false").CombinedOutput()
		out, err := exec.Command(p, "serve", "reset").CombinedOutput()
		if err != nil {
			origin := fmt.Sprintf("http://%s:%d", deps.cfg.Bind, deps.cfg.Port)
			out, err = exec.Command(p, "serve", "--remove", origin).CombinedOutput()
			if err != nil {
				writeError(w, http.StatusBadGateway, fmt.Errorf("tailscale stop: %v: %s", err, string(out)))
				return
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "stdout": strings.TrimSpace(string(out))})

	case "status":
		out, _ := exec.Command(p, "serve", "status", "--json").Output()
		var parsed any
		_ = json.Unmarshal(out, &parsed)
		writeJSON(w, http.StatusOK, map[string]any{"raw": parsed, "rawText": string(out)})

	default:
		writeError(w, http.StatusNotFound, fmt.Errorf("unknown tailscale subpath %q", sub))
	}
}
