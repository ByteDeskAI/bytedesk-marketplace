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
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// distFS is provided by either server_embed.go (production, //go:build !dev)
// or server_dev.go (//go:build dev — reads from disk so hot-reload works).
var distFS fs.FS

const buildVersion = "v1.15.6-bdm43"

var startTime = time.Now()

type apiDeps struct {
	projectKey string
	cfg        *WebConfig
	sessions   *SessionRepo
	projects   *ProjectsRepo
	events     *EventsRepo
	stats      *StatsCalculator
	bus        *EventBus
	judge      JudgeProvider
	settings   *SettingsRepo
	chains     *ChainsRepo
	transcript *TranscriptStream
}

func newAPIDeps(projectKey string, cfg *WebConfig, projDir, dataRoot, webPath string) *apiDeps {
	sr := NewSessionRepo(projDir)
	er := NewEventsRepo(projDir)
	pr := NewProjectsRepo(dataRoot)
	sc := NewStatsCalculator(sr, er)
	st := NewSettingsRepo(webPath)
	cr := NewChainsRepo(projDir)
	deps := &apiDeps{projectKey, cfg, sr, pr, er, sc, NewEventBus(), newJudgeProvider(), st, cr, nil}
	deps.transcript = NewTranscriptStream(deps)
	return deps
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
	mux.HandleFunc("/api/stream", func(w http.ResponseWriter, r *http.Request) {
		handleStream(w, r, deps)
	})
	mux.HandleFunc("/api/clean", func(w http.ResponseWriter, r *http.Request) {
		handleClean(w, r)
	})
	mux.HandleFunc("/api/spawn", func(w http.ResponseWriter, r *http.Request) {
		handleSpawn(w, r)
	})
	mux.HandleFunc("/api/broadcast", func(w http.ResponseWriter, r *http.Request) {
		handleBroadcast(w, r, deps)
	})
	mux.HandleFunc("/api/estimate-cost", func(w http.ResponseWriter, r *http.Request) {
		handleEstimateCost(w, r, deps)
	})
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		handleSettings(w, r, deps)
	})
	mux.HandleFunc("/api/wait", func(w http.ResponseWriter, r *http.Request) {
		handleWait(w, r, deps)
	})
	mux.HandleFunc("/api/sweep", func(w http.ResponseWriter, r *http.Request) {
		handleSweep(w, r)
	})
	mux.HandleFunc("/api/rules", func(w http.ResponseWriter, r *http.Request) {
		handleRules(w, r, deps)
	})
	mux.HandleFunc("/api/rules/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/rules/")
		handleRuleDelete(w, r, deps, id)
	})
	mux.HandleFunc("/api/notify-state", func(w http.ResponseWriter, r *http.Request) {
		handleNotifyState(w, r, deps)
	})
	mux.HandleFunc("/api/search", func(w http.ResponseWriter, r *http.Request) {
		handleSearch(w, r, deps)
	})
	mux.HandleFunc("/api/audit/verify", func(w http.ResponseWriter, r *http.Request) {
		handleAuditVerify(w, r, deps)
	})
	mux.HandleFunc("/api/tournament", func(w http.ResponseWriter, r *http.Request) {
		handleTournament(w, r, deps)
	})
	mux.HandleFunc("/api/main", func(w http.ResponseWriter, r *http.Request) {
		handleMainInfo(w, r, deps)
	})
	mux.HandleFunc("/api/main/pty", func(w http.ResponseWriter, r *http.Request) {
		handleMainPty(w, r, deps)
	})
	mux.HandleFunc("/api/main/messages", func(w http.ResponseWriter, r *http.Request) {
		handleMainMessages(w, r, deps)
	})
	mux.HandleFunc("/api/main/transcript", func(w http.ResponseWriter, r *http.Request) {
		handleMainTranscript(w, r, deps)
	})
	mux.HandleFunc("/api/main/send", func(w http.ResponseWriter, r *http.Request) {
		handleMainSend(w, r, deps)
	})
	mux.HandleFunc("/api/main/keys", func(w http.ResponseWriter, r *http.Request) {
		handleMainKeys(w, r, deps)
	})
	mux.HandleFunc("/api/jira/issue", func(w http.ResponseWriter, r *http.Request) {
		handleJiraIssue(w, r, deps)
	})
	mux.HandleFunc("/api/jira/backlog", func(w http.ResponseWriter, r *http.Request) {
		handleJiraBacklog(w, r, deps)
	})
	mux.HandleFunc("/api/tailscale/start", func(w http.ResponseWriter, r *http.Request) {
		handleTailscale(w, r, deps, "start")
	})
	mux.HandleFunc("/api/tailscale/stop", func(w http.ResponseWriter, r *http.Request) {
		handleTailscale(w, r, deps, "stop")
	})
	mux.HandleFunc("/api/tailscale/status", func(w http.ResponseWriter, r *http.Request) {
		handleTailscale(w, r, deps, "status")
	})
	mux.HandleFunc("/api/tailscale/info", func(w http.ResponseWriter, r *http.Request) {
		handleTailscaleInfo(w, r, deps)
	})
	mux.HandleFunc("/api/tailscale/exec", func(w http.ResponseWriter, r *http.Request) {
		handleTailscaleExec(w, r, deps)
	})
	mux.HandleFunc("/api/tailscale/log", func(w http.ResponseWriter, r *http.Request) {
		handleTailscaleLog(w, r, deps)
	})
	mux.HandleFunc("/api/storage", func(w http.ResponseWriter, r *http.Request) {
		handleStorageInfo(w, r, deps)
	})
	mux.HandleFunc("/api/chains", func(w http.ResponseWriter, r *http.Request) {
		handleChainsCollection(w, r, deps)
	})
	mux.HandleFunc("/api/chains/", func(w http.ResponseWriter, r *http.Request) {
		handleChainItem(w, r, deps)
	})
	mux.Handle("/", http.FileServer(http.FS(sub)))

	// Decorator chain (Phase 12.6 / C6). Applied to every request.
	// /healthz, /api/version, and the static SPA at "/" stay reachable
	// without auth so the page can prompt the user for a token; all
	// other /api/* paths are gated when cfg.AuthToken is non-empty.
	gated := func(r *http.Request) bool {
		p := r.URL.Path
		if !strings.HasPrefix(p, "/api/") {
			return false
		}
		if p == "/api/version" {
			return false
		}
		return true
	}
	authedHandler := chain(mux, requestIDMW, logMW, conditionalAuthMW(deps.cfg.AuthToken, gated))
	return authedHandler, nil
}

// conditionalAuthMW applies the bearer/token check only to requests
// that pass the predicate. Lets the SPA (/, /app.js, /app.css) and
// /healthz + /api/version load without a token.
func conditionalAuthMW(token string, gated func(*http.Request) bool) middleware {
	if token == "" {
		return func(h http.Handler) http.Handler { return h }
	}
	inner := authMW(token)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if gated(r) {
				inner(next).ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// handleStream — SSE multiplex. Client subscribes to one or more topics
// (sessions / stats / projects / events) via ?topics=…; server pushes
// `event: <topic>\ndata: {}\n\n` whenever the bus publishes on that
// topic. Browser EventSource handles reconnect.
func handleStream(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	// Parse subscription topics. Empty → all.
	var topics []Topic
	if v := r.URL.Query().Get("topics"); v != "" {
		for _, t := range strings.Split(v, ",") {
			t = strings.TrimSpace(t)
			if t != "" {
				topics = append(topics, Topic(t))
			}
		}
	}
	sub := deps.bus.Subscribe(topics...)
	defer deps.bus.Unsubscribe(sub)

	// Send a hello event so client knows the connection is live.
	fmt.Fprintf(w, "event: hello\ndata: {\"build\":%q}\n\n", buildVersion)
	flusher.Flush()

	keepalive := time.NewTicker(15 * time.Second)
	defer keepalive.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-sub.C():
			if !ok {
				return
			}
			fmt.Fprintf(w, "event: %s\ndata: {}\n\n", msg.Topic)
			flusher.Flush()
		case <-keepalive.C:
			fmt.Fprint(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
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
		out = append(out, sessionToViewWithJudge(s, now, deps.judge))
	}
	writeJSON(w, http.StatusOK, out)
}

func handleSessionDetail(w http.ResponseWriter, r *http.Request, deps *apiDeps) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusBadRequest, errors.New("expected /api/sessions/<TICKET>[/log|/stream]"))
		return
	}
	ticket := parts[0]
	if len(parts) == 2 {
		switch parts[1] {
		case "log":
			handleSessionLog(w, r, deps, ticket)
			return
		case "stream":
			handleSessionStream(w, r, deps, ticket)
			return
		case "send":
			handleSessionSend(w, r, ticket)
			return
		case "keys":
			handleSessionKeys(w, r, deps, ticket)
			return
		case "kill":
			handleSessionKill(w, r, ticket)
			return
		case "review":
			handleSessionReview(w, r, ticket)
			return
		case "pty":
			handleSessionPty(w, r, deps, ticket)
			return
		case "git":
			handleSessionGit(w, r, deps, ticket)
			return
		case "pr":
			handleSessionPR(w, r, deps, ticket)
			return
		case "resume":
			handleSessionResume(w, r, deps, ticket)
			return
		case "rebase":
			handleSessionRebase(w, r, deps, ticket)
			return
		case "stats":
			handleSessionStats(w, r, deps, ticket)
			return
		case "transcript":
			handleSessionTranscriptStream(w, r, deps, ticket)
			return
		case "messages":
			handleSessionMessages(w, r, deps, ticket)
			return
		default:
			writeError(w, http.StatusBadRequest, fmt.Errorf("unknown sub-path %q", parts[1]))
			return
		}
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
	writeJSON(w, http.StatusOK, sessionToViewWithJudge(s, time.Now(), deps.judge))
}

// sessionsRoot — used by log_stream.go.
func (d *apiDeps) sessionsRoot() string {
	pd, _ := projectDir()
	return filepath.Join(pd, "sessions")
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

// sessionToViewWithJudge composes a SessionView and overlays the
// JudgeProvider's verdict (state confidence, drift score, objective).
// Reading the log tail is best-effort: any error → empty tail and the
// judge still runs against an empty string.
func sessionToViewWithJudge(s Session, now time.Time, judge JudgeProvider) SessionView {
	v := sessionToView(s, now)
	if judge == nil {
		return v
	}
	tail := readLogTail(s.LogPath, 4096)
	state, conf, obj := judge.JudgeState(s, tail)
	v.State = state
	v.Confidence = conf
	v.Drift = judge.DriftScore(s, tail)
	v.Objective = obj
	return v
}

func sessionToView(s Session, now time.Time) SessionView {
	v := SessionView{
		Ticket:   s.Ticket,
		Slug:     s.Slug,
		State:    s.State,
		Parent:   s.Parent,
		Branch:   s.Branch,
		Cost:     fmt.Sprintf("$%.2f", s.CostUSD),
		Depth:    s.Depth,
		FullAuto: s.FullAuto,
		Worktree: s.Worktree,
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
