package main

// StatsCalculator — derive the FleetStats wire shape from the session list
// + recent events. This is the Factory-style composition: pulls from
// SessionRepo + EventsRepo and produces a single response.

import (
	"fmt"
	"time"
)

type StatsCalculator struct {
	sessions *SessionRepo
	events   *EventsRepo
}

func NewStatsCalculator(s *SessionRepo, e *EventsRepo) *StatsCalculator {
	return &StatsCalculator{sessions: s, events: e}
}

func (c *StatsCalculator) Compute(now time.Time) (*FleetStats, error) {
	sl, err := c.sessions.List()
	if err != nil {
		return nil, err
	}
	stats := &FleetStats{}
	var totalCost float64
	var totalRuntimeSec int64
	completedToday := 0
	needsInput := 0
	working := 0

	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	for _, s := range sl {
		switch s.State {
		case "needs-input":
			needsInput++
		case "working":
			working++
		case "done", "completed":
			if !s.LastActivity.Before(startOfToday) {
				completedToday++
			}
		}
		totalCost += s.CostUSD
		if !s.Started.IsZero() {
			end := s.LastActivity
			if end.Before(s.Started) {
				end = now
			}
			totalRuntimeSec += int64(end.Sub(s.Started).Seconds())
		}
	}
	stats.ActiveSessions.Value = working + needsInput
	stats.ActiveSessions.Total = len(sl)
	stats.NeedsInput.Value = needsInput
	stats.NeedsInput.Delta = 0 // historical compare lands when we have a snapshot store
	stats.Completed.Value = completedToday
	stats.Completed.Window = "today"
	stats.EstCost24h.Value = fmt.Sprintf("$%.2f", totalCost)
	stats.EstCost24h.DeltaPct = 0
	stats.EstCost24h.Series = []int{}
	stats.Runtime24h.Value = formatRuntime(totalRuntimeSec)
	stats.Runtime24h.Series = []int{}

	since := now.Add(-24 * time.Hour)
	evs, err := c.events.List(EventsFilter{Since: since})
	if err == nil {
		stats.Events24h.Value = len(evs)
	}
	stats.Events24h.DeltaPct = 0
	stats.Events24h.Series = []int{}
	return stats, nil
}
