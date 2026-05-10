package main

// runWatcher — internal poll-tick that hashes the session/stats/projects/
// events outputs, detects changes, and publishes on the bus. Stays in the
// standard library (no fsnotify dep). A future phase can swap this for
// real fsnotify without changing the EventBus interface or the client.

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"time"
)

func runWatcher(ctx context.Context, bus *EventBus, deps *apiDeps, intervalMs int) {
	if intervalMs <= 0 {
		intervalMs = 1000
	}
	t := time.NewTicker(time.Duration(intervalMs) * time.Millisecond)
	defer t.Stop()

	var lastSessions, lastStats, lastProjects, lastEvents string

	tick := func() {
		now := time.Now()
		// Sessions
		if sl, err := deps.sessions.List(); err == nil {
			h := hashJSON(sl)
			if h != lastSessions {
				lastSessions = h
				bus.Publish(Message{Topic: TopicSessions})
			}
		}
		// Stats (cheap; computed on demand)
		if s, err := deps.stats.Compute(now); err == nil {
			h := hashJSON(s)
			if h != lastStats {
				lastStats = h
				bus.Publish(Message{Topic: TopicStats})
			}
		}
		// Projects (slower-changing — could poll less frequently in a
		// future tightening)
		if ps, err := deps.projects.List(); err == nil {
			h := hashJSON(ps)
			if h != lastProjects {
				lastProjects = h
				bus.Publish(Message{Topic: TopicProjects})
			}
		}
		// Events (most volatile — polled every tick)
		if evs, err := deps.events.List(EventsFilter{Limit: 100}); err == nil {
			h := hashJSON(evs)
			if h != lastEvents {
				lastEvents = h
				bus.Publish(Message{Topic: TopicEvents})
			}
		}
	}

	tick() // emit initial state on connect
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			tick()
		}
	}
}

func hashJSON(v interface{}) string {
	b, _ := json.Marshal(v)
	sum := sha1.Sum(b)
	return hex.EncodeToString(sum[:])
}
