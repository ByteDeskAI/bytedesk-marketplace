package main

// Wire-shape types — what the HTTP routes return. Kept presentation-tuned
// (pre-formatted strings for activity/cost/runtime) to match the client's
// existing SessionRow shape from the Phase 2 scaffold. Phase 3b can move
// to raw values + client-side formatters once SSE arrives and the client
// owns more of the rendering pipeline.

import "time"

// Session is the parsed-from-disk shape (key=value meta file + derived
// fields). Repos return this internally; route handlers convert to
// SessionView.
type Session struct {
	Ticket        string    `json:"-"`
	Slug          string    `json:"-"`
	TmuxSession   string    `json:"-"`
	Worktree      string    `json:"-"`
	Branch        string    `json:"-"`
	LogPath       string    `json:"-"`
	ResultsPath   string    `json:"-"`
	Started       time.Time `json:"-"`
	FullAuto      bool      `json:"-"`
	Parent        string    `json:"-"`
	Depth         int       `json:"-"`
	MaxCostUSD    float64   `json:"-"`
	MaxRuntimeMin int       `json:"-"`
	PromptFile    string    `json:"-"`

	// Derived
	State        string    `json:"-"`
	LastActivity time.Time `json:"-"`
	Tokens       int       `json:"-"`
	CostUSD      float64   `json:"-"`
}

// SessionView is the JSON shape returned by GET /api/sessions.
// Strings are pre-formatted to match the SPA's existing SessionRow.
type SessionView struct {
	Ticket   string  `json:"ticket"`
	Slug     string  `json:"slug"`
	State    string  `json:"state"`
	Parent   string  `json:"parent"`
	Branch   string  `json:"branch"`
	Activity string  `json:"activity"`
	Cost     string  `json:"cost"`
	Runtime  string  `json:"runtime"`
	Progress float64 `json:"progress"`
}

// FleetStats — GET /api/stats. Mirrors the SPA's FleetStats type.
type FleetStats struct {
	ActiveSessions struct {
		Value int `json:"value"`
		Total int `json:"total"`
	} `json:"active_sessions"`
	NeedsInput struct {
		Value int `json:"value"`
		Delta int `json:"delta"`
	} `json:"needs_input"`
	Completed struct {
		Value  int    `json:"value"`
		Window string `json:"window"`
	} `json:"completed"`
	EstCost24h struct {
		Value    string  `json:"value"`
		DeltaPct float64 `json:"delta_pct"`
		Series   []int   `json:"series"`
	} `json:"est_cost_24h"`
	Runtime24h struct {
		Value  string `json:"value"`
		Series []int  `json:"series"`
	} `json:"runtime_24h"`
	Events24h struct {
		Value    int     `json:"value"`
		DeltaPct float64 `json:"delta_pct"`
		Series   []int   `json:"series"`
	} `json:"events_24h"`
}

// Project — GET /api/projects.
type Project struct {
	Key  string `json:"key"`
	Path string `json:"path"`
	Port int    `json:"port"`
	URL  string `json:"url"`
}

// Event — GET /api/events. Each line of the per-session events JSONL
// becomes one of these (with a synthetic id derived from session+offset
// for stable client-side dedup on polling).
type Event struct {
	ID     string                 `json:"id"`
	TS     time.Time              `json:"ts"`
	Ticket string                 `json:"ticket"`
	Depth  int                    `json:"depth"`
	Kind   string                 `json:"kind"`
	Detail map[string]interface{} `json:"detail"`
}
