package main

// HTTP handler stack. Phase 3a (BDM-17) layers real /api/* routes over the
// Phase 1 foundation. Routes:
//
//   GET /healthz                      foundation health probe
//   GET /api/version                  build + project
//   GET /api/sessions                 SessionView[]
//   GET /api/sessions/:ticket         SessionView (single)
//   GET /api/stats                    FleetStats
//   GET /api/projects                 Project[]
//   GET /api/events?since=…&kinds=…&limit=…   Event[] cross-session feed
//   GET /                             static SPA (embedded dist/)

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"strconv"
	"strings"
	"time"
)

//go:embed all:dist
var distFS embed.FS

const buildVersion = "v1.3.0-bdm17"

var startTime = time.Now()

type apiDeps struct {
	projectKey string
	cfg        *WebConfig
	sessions   *SessionRepo
	projects   *ProjectsRepo
	events     *EventsRepo
	stats      *StatsCalculator
}

func newAPIDeps(projectKey string, cfg *WebConfig, projDir, dataRoot string) *apiDeps {
	sr := NewSessionRepo(projDir)
	er := NewEventsRepo(projDir)
	pr := NewProjectsRepo(dataRoot)
	sc := NewStatsCalculator(sr, er)
	return &apiDeps{projectKey, cfg, sr, pr, er, sc}
}

func buildHandler(deps *apiDeps) (http.Handler, error) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, fmt.Errorf("embed sub: %w", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":      "ok",
			"project_key": deps.projectKey,
			"port":        deps.cfg.Port,
			"bind":        deps.cfg.Bind,
			"uptime":      time.Since(startTime).String(),
		})
	})
	mux.HandleFunc("/api/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"build":   buildVersion,
			"project": deps.projectKey,
		})
	})
	mux.HandleFunc("/api/sessions", func(w http.ResponseWriter, r *http.Request) {
		handleSessions(w, r, deps)
	})
	mux.HandleFunc("/api/sessions/", func(w http.ResponseWriter, r *http.Request) {
		handleSessionDetail(w, r, deps)
	})
	mux.HandleFunc("/api/stats", func(w http.ResponseWriter, r *http.Request) {
		s, err := deps.stats.Compute(time.Now())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, s)
	})
	mux.HandleFunc("/api/projects", func(w http.ResponseWriter, r *http.Request) {
		ps, err := deps.projects.List()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, ps)
	})
	mux.HandleFunc("/api/events", func(w http.ResponseWriter, r *http.Request) {
		handleEvents(w, r, deps)
	})
	mux.Handle("/", http.FileServer(http.FS(sub)))
	return mux, nil
}

func handleSessions(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	sl, err := deps.sessions.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	now := time.Now()
	out := make([]SessionView, 0, len(sl))
	for _, s := range sl {
		out = append(out, sessionToView(s, now))
	}
	writeJSON(w, http.StatusOK, out)
}

func handleSessionDetail(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	ticket := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
	if ticket == "" || strings.Contains(ticket, "/") {
		writeError(w, http.StatusBadRequest, errors.New("expected /api/sessions/<TICKET>"))
		return
	}
	s, err := deps.sessions.Get(ticket)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			writeError(w, http.StatusNotFound, fmt.Errorf("ticket %q not found", ticket))
			return
		}
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, sessionToView(s, time.Now()))
}

func handleEvents(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	q := r.URL.Query()
	f := EventsFilter{}
	if v := q.Get("since"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			f.Since = t
		}
	}
	if v := q.Get("kinds"); v != "" {
		f.Kinds = strings.Split(v, ",")
	}
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			f.Limit = n
		}
	}
	evs, err := deps.events.List(f)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	writeJSON(w, http.StatusOK, evs)
}

func sessionToView(s Session, now time.Time) SessionView {
	v := SessionView{
		Ticket: s.Ticket,
		Slug:   s.Slug,
		State:  s.State,
		Parent: s.Parent,
		Branch: s.Branch,
		Cost:   fmt.Sprintf("$%.2f", s.CostUSD),
	}
	if !s.LastActivity.IsZero() {
		v.Activity = formatRelative(int64(now.Sub(s.LastActivity).Seconds()))
	} else {
		v.Activity = "—"
	}
	if !s.Started.IsZero() {
		end := s.LastActivity
		if end.Before(s.Started) {
			end = now
		}
		v.Runtime = formatRuntime(int64(end.Sub(s.Started).Seconds()))
	} else {
		v.Runtime = "—"
	}
	v.Progress = progressFromState(s.State)
	return v
}

// progressFromState — placeholder until B11 (drift detector / Haiku
// progress estimation) lands. Maps state-name to a notional fraction so
// the Session Table progress bar has something to render.
func progressFromState(state string) float64 {
	switch state {
	case "starting":
		return 0.05
	case "working":
		return 0.50
	case "needs-input":
		return 0.40
	case "blocked":
		return 0.30
	case "reviewing":
		return 0.85
	case "done", "completed":
		return 1.00
	default:
		return 0.10
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
