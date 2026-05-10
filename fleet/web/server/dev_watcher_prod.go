//go:build !dev

package main

// Production: no-op. The dev tag overrides startDevDistWatcher in
// dev_watcher.go.

import "context"

var startDevDistWatcher = func(_ context.Context, _ *EventBus) {}
