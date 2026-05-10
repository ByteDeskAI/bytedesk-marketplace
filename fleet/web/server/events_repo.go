package main

// EventsRepo — read per-session events JSONL files (written by the
// PostToolUse `event-emitter.sh` hook) across the project. Returns merged
// + sorted events for the cross-session feed in panel 6 of the dashboard.

import (
	"bufio"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type EventsRepo struct {
	projectDir string
}

func NewEventsRepo(projectDir string) *EventsRepo {
	return &EventsRepo{projectDir: projectDir}
}

// Filter for List. Zero values mean "no filter".
type EventsFilter struct {
	Since time.Time
	Kinds []string // empty = all kinds
	Limit int      // 0 = no limit (capped to 1000 server-side)
}

// List walks every sessions/*/events file, parses each JSONL line, applies
// the filter, returns events newest-first (descending by ts).
func (r *EventsRepo) List(f EventsFilter) ([]Event, error) {
	sessionsDir := filepath.Join(r.projectDir, "sessions")
	entries, err := os.ReadDir(sessionsDir)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return []Event{}, nil
		}
		return nil, err
	}
	const hardCap = 1000
	limit := f.Limit
	if limit <= 0 || limit > hardCap {
		limit = hardCap
	}
	kindAllowed := func(k string) bool {
		if len(f.Kinds) == 0 {
			return true
		}
		for _, want := range f.Kinds {
			if k == want {
				return true
			}
		}
		return false
	}

	all := make([]Event, 0, 64)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		path := filepath.Join(sessionsDir, e.Name(), "events")
		evs, err := parseEventsFile(path, e.Name())
		if err != nil {
			continue
		}
		for _, ev := range evs {
			if !f.Since.IsZero() && ev.TS.Before(f.Since) {
				continue
			}
			if !kindAllowed(ev.Kind) {
				continue
			}
			all = append(all, ev)
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].TS.After(all[j].TS) })
	if len(all) > limit {
		all = all[:limit]
	}
	return all, nil
}

func parseEventsFile(path, ticketFromDir string) ([]Event, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := make([]Event, 0, 32)
	scan := bufio.NewScanner(f)
	scan.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	idx := 0
	for scan.Scan() {
		line := scan.Bytes()
		if len(line) == 0 {
			continue
		}
		var raw struct {
			TS     string                 `json:"ts"`
			Ticket string                 `json:"ticket"`
			Depth  int                    `json:"depth"`
			Kind   string                 `json:"kind"`
			Detail map[string]interface{} `json:"detail"`
		}
		if err := json.Unmarshal(line, &raw); err != nil {
			continue
		}
		ts, err := time.Parse(time.RFC3339, raw.TS)
		if err != nil {
			ts = time.Time{}
		}
		ticket := raw.Ticket
		if ticket == "" || ticket == "unknown" {
			ticket = ticketFromDir
		}
		// Stable id: sha1(path + offset). Lets the client dedup on poll.
		h := sha1.New()
		h.Write([]byte(path))
		h.Write([]byte(strings.Repeat("\x00", 1)))
		h.Write([]byte(itoa(idx)))
		idHex := hex.EncodeToString(h.Sum(nil))[:16]

		out = append(out, Event{
			ID:     idHex,
			TS:     ts,
			Ticket: ticket,
			Depth:  raw.Depth,
			Kind:   raw.Kind,
			Detail: raw.Detail,
		})
		idx++
	}
	return out, nil
}
