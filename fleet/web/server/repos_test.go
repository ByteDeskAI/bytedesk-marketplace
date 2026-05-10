package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// helper to lay out a fake project tree with N sessions.
func mkProject(t *testing.T, sessions map[string]map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for ticket, meta := range sessions {
		sd := filepath.Join(dir, "sessions", ticket)
		if err := os.MkdirAll(sd, 0o755); err != nil {
			t.Fatal(err)
		}
		var buf []byte
		for k, v := range meta {
			buf = append(buf, []byte(k+"="+v+"\n")...)
		}
		if err := os.WriteFile(filepath.Join(sd, "meta"), buf, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestSessionRepoListEmpty(t *testing.T) {
	dir := t.TempDir()
	r := NewSessionRepo(dir)
	got, err := r.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty list, got %d", len(got))
	}
}

func TestSessionRepoListReadsMeta(t *testing.T) {
	started := time.Now().Add(-2 * time.Hour).UTC().Format(time.RFC3339)
	dir := mkProject(t, map[string]map[string]string{
		"BDP-100": {
			"ticket":    "BDP-100",
			"slug":      "feature-foo",
			"session":   "BDP-100",
			"branch":    "feature/BDP-100-feature-foo",
			"started":   started,
			"depth":     "0",
			"full_auto": "1",
		},
		"BDP-101": {
			"ticket":  "BDP-101",
			"slug":    "feature-bar",
			"session": "BDP-101",
			"branch":  "feature/BDP-101-feature-bar",
			"started": started,
			"parent":  "BDP-100",
			"depth":   "1",
		},
	})
	r := NewSessionRepo(dir)
	got, err := r.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 sessions, got %d", len(got))
	}
	byTicket := map[string]Session{}
	for _, s := range got {
		byTicket[s.Ticket] = s
	}
	if byTicket["BDP-100"].Slug != "feature-foo" {
		t.Errorf("BDP-100 slug: got %q", byTicket["BDP-100"].Slug)
	}
	if byTicket["BDP-101"].Parent != "BDP-100" {
		t.Errorf("BDP-101 parent: got %q", byTicket["BDP-101"].Parent)
	}
	if byTicket["BDP-101"].Depth != 1 {
		t.Errorf("BDP-101 depth: got %d", byTicket["BDP-101"].Depth)
	}
	if !byTicket["BDP-100"].FullAuto {
		t.Errorf("BDP-100 full_auto: expected true")
	}
}

func TestSessionStateFromLog(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name, content, want string
	}{
		{"empty", "", "starting"},
		{"working", "thinking about the next step…", "working"},
		{"needs-input", "do you want to allow this command? y/n", "needs-input"},
		{"error", "tests failed: cannot find module 'foo'", "error"},
		{"done", "✓ all green; merged to main", "done"},
		{"idle", "the cat sat on the mat", "idle"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			path := filepath.Join(dir, c.name+".log")
			if err := os.WriteFile(path, []byte(c.content), 0o644); err != nil {
				t.Fatal(err)
			}
			got := sessionStateFromLog(path)
			if got != c.want {
				t.Errorf("sessionStateFromLog(%q) = %q, want %q", c.content, got, c.want)
			}
		})
	}
}

func TestProgressFromState(t *testing.T) {
	cases := map[string]float64{
		"starting":    0.05,
		"working":     0.50,
		"needs-input": 0.40,
		"reviewing":   0.85,
		"done":        1.00,
		"completed":   1.00,
	}
	for state, want := range cases {
		if got := progressFromState(state); got != want {
			t.Errorf("progressFromState(%q) = %v, want %v", state, got, want)
		}
	}
}

func TestFormatRuntime(t *testing.T) {
	cases := []struct {
		secs int64
		want string
	}{
		{0, "<1m"},
		{59, "<1m"},
		{60, "1m"},
		{3599, "59m"},
		{3600, "1h"},
		{3660, "1h 1m"},
		{7320, "2h 2m"},
	}
	for _, c := range cases {
		if got := formatRuntime(c.secs); got != c.want {
			t.Errorf("formatRuntime(%d) = %q, want %q", c.secs, got, c.want)
		}
	}
}

func TestRouteSessionsReturnsList(t *testing.T) {
	started := time.Now().Add(-30 * time.Minute).UTC().Format(time.RFC3339)
	projDir := mkProject(t, map[string]map[string]string{
		"BDP-200": {
			"ticket": "BDP-200", "slug": "checkout", "branch": "feature/BDP-200",
			"started": started, "depth": "0",
		},
	})
	deps := newAPIDeps("test-key", &WebConfig{Bind: "127.0.0.1", Port: 7681}, projDir, t.TempDir(), t.TempDir())
	h, err := buildHandler(deps)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body []SessionView
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 1 {
		t.Fatalf("expected 1 session, got %d", len(body))
	}
	if body[0].Ticket != "BDP-200" {
		t.Errorf("expected ticket BDP-200, got %q", body[0].Ticket)
	}
	if body[0].Slug != "checkout" {
		t.Errorf("expected slug 'checkout', got %q", body[0].Slug)
	}
}

func TestRouteStatsAggregates(t *testing.T) {
	now := time.Now()
	started := now.Add(-1 * time.Hour).UTC().Format(time.RFC3339)
	projDir := mkProject(t, map[string]map[string]string{
		"BDP-301": {"ticket": "BDP-301", "started": started},
		"BDP-302": {"ticket": "BDP-302", "started": started},
		"BDP-303": {"ticket": "BDP-303", "started": started},
	})
	// Empty logs → all sessions report state "starting" (which doesn't count
	// as active or completed). The aggregation should still produce a valid
	// stats object with total = 3.
	deps := newAPIDeps("test-key", &WebConfig{Bind: "127.0.0.1", Port: 7681}, projDir, t.TempDir(), t.TempDir())
	h, _ := buildHandler(deps)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/stats", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body FleetStats
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.ActiveSessions.Total != 3 {
		t.Errorf("expected total=3, got %d", body.ActiveSessions.Total)
	}
}

func TestRouteProjectsEnumerates(t *testing.T) {
	dataRoot := t.TempDir()
	for _, key := range []string{"abc123def456", "deadbeefcafe"} {
		webDir := filepath.Join(dataRoot, "projects", key, "web")
		if err := os.MkdirAll(webDir, 0o755); err != nil {
			t.Fatal(err)
		}
		cfg := &WebConfig{Bind: "127.0.0.1", Port: 7700}
		if err := os.WriteFile(filepath.Join(webDir, "config.toml"), []byte(formatTOML(cfg)), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	deps := newAPIDeps("abc123def456", &WebConfig{Bind: "127.0.0.1", Port: 7700}, filepath.Join(dataRoot, "projects", "abc123def456"), dataRoot, t.TempDir())
	h, _ := buildHandler(deps)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var body []Project
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 2 {
		t.Fatalf("expected 2 projects, got %d", len(body))
	}
}
