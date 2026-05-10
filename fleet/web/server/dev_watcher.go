//go:build dev

package main

// Dev-only mtime watcher on dist/. Polls every 500ms; when the most-
// recent mtime advances, publishes Topic("dist-rebuilt") on the bus.
// The browser subscribes via /api/stream?topics=dist-rebuilt and
// reloads itself.

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"time"
)

var startDevDistWatcher = func(ctx context.Context, bus *EventBus) {
	root := os.Getenv("FLEET_WEB_ROOT")
	if root == "" {
		root = "."
	}
	dist := filepath.Join(root, "dist")

	go func() {
		t := time.NewTicker(500 * time.Millisecond)
		defer t.Stop()
		var last time.Time
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				mt := newestMtime(dist)
				if mt.IsZero() {
					continue
				}
				if !last.IsZero() && mt.After(last) {
					log.Printf("dev: dist/ changed at %s — publishing dist-rebuilt", mt.Format(time.RFC3339Nano))
					bus.Publish(Message{Topic: TopicDistRebuilt})
				}
				last = mt
			}
		}
	}()
}

func newestMtime(dir string) time.Time {
	var newest time.Time
	_ = filepath.Walk(dir, func(_ string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		return nil
	})
	return newest
}
