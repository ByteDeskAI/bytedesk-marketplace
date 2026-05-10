package main

// reaper.go — auto-kill done sessions.
//
// When a fleet session's state transitions to `done` (claude exited;
// pane no longer running claude), the reaper:
//  1. Runs `tmux kill-session -t <S>` to free the tmux session.
//  2. Marks the session meta with `state=done` so /api/sessions
//     returns the right state even after the pane is gone.
//  3. Publishes the `sessions` topic so the dashboard immediately
//     drops the tile from the grid.
//
// The reaper polls every 10s. We deliberately do NOT remove the
// session directory or branch — the user may want to inspect logs,
// open a PR, or replay the session. `claude-sessions cleanup` (the
// existing CLI subcommand) is the canonical destructive cleanup.

import (
	"context"
	"log"
	"os/exec"
	"sync"
	"time"
)

const reaperInterval = 10 * time.Second

type Reaper struct {
	deps    *apiDeps
	mu      sync.Mutex
	reaped  map[string]bool // tickets we've already kill-sessioned
}

func NewReaper(deps *apiDeps) *Reaper {
	return &Reaper{deps: deps, reaped: map[string]bool{}}
}

// Run starts the reap loop. Cancels with ctx.
func (r *Reaper) Run(ctx context.Context) {
	go func() {
		t := time.NewTicker(reaperInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				r.tick()
			}
		}
	}()
}

func (r *Reaper) tick() {
	sessions, err := r.deps.sessions.List()
	if err != nil {
		return
	}
	any := false
	for _, s := range sessions {
		if s.State != "done" && s.State != "completed" {
			continue
		}
		r.mu.Lock()
		already := r.reaped[s.Ticket]
		r.mu.Unlock()
		if already {
			continue
		}
		if s.TmuxSession != "" {
			// Best-effort kill. has-session check first to avoid log spam.
			if err := exec.Command("tmux", "has-session", "-t", s.TmuxSession).Run(); err == nil {
				if err := exec.Command("tmux", "kill-session", "-t", s.TmuxSession).Run(); err != nil {
					log.Printf("reaper: tmux kill-session %q: %v", s.TmuxSession, err)
					continue
				}
				log.Printf("reaper: %s done — killed tmux session %q", s.Ticket, s.TmuxSession)
				any = true
			}
		}
		r.mu.Lock()
		r.reaped[s.Ticket] = true
		r.mu.Unlock()
	}
	if any {
		// Push immediately so the SPA drops the tile without waiting for
		// the next poll tick.
		r.deps.bus.Publish(Message{Topic: TopicSessions})
	}
}
