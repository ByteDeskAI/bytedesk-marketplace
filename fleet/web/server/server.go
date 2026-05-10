package main

// HTTP handler skeleton. Phase 1 (BDM-15) only ships:
//   - GET /healthz        → JSON { status, project_key, port, bind, uptime }
//   - GET /api/version    → JSON { build, project }
//   - GET /                → static SPA (embedded dist/) — placeholder index.html
//
// Real routes (sessions, events, cost, PTY, SSE, command dispatch) land in
// subsequent phases.

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"time"
)

//go:embed all:dist
var distFS embed.FS

const buildVersion = "v1.2.0-bdm16"

var startTime = time.Now()

func buildHandler(projectKey string, cfg *WebConfig) (http.Handler, error) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, fmt.Errorf("embed sub: %w", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":      "ok",
			"project_key": projectKey,
			"port":        cfg.Port,
			"bind":        cfg.Bind,
			"uptime":      time.Since(startTime).String(),
		})
	})
	mux.HandleFunc("/api/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"build":   buildVersion,
			"project": projectKey,
		})
	})
	mux.Handle("/", http.FileServer(http.FS(sub)))
	return mux, nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
