package main

// EventBus — Mediator pattern. One bus per project; subscribers register
// for topics, the bus fans out published events. Phase 3b uses an internal
// 1s ticker to detect session/stats/projects/events changes and publish
// the appropriate topic; Phase 4+ can swap in fsnotify without changing
// the bus interface or client semantics.

import (
	"context"
	"sync"
	"sync/atomic"
)

type Topic string

const (
	TopicSessions Topic = "sessions"
	TopicStats    Topic = "stats"
	TopicProjects Topic = "projects"
	TopicEvents   Topic = "events"
)

type Message struct {
	Topic Topic       `json:"topic"`
	Body  interface{} `json:"body,omitempty"`
}

// Subscription represents one consumer's view of the bus. The channel
// is closed when Unsubscribe is called or the bus shuts down.
type Subscription struct {
	id     uint64
	topics map[Topic]struct{}
	ch     chan Message
}

func (s *Subscription) C() <-chan Message { return s.ch }

type EventBus struct {
	mu     sync.RWMutex
	subs   map[uint64]*Subscription
	nextID atomic.Uint64
	closed atomic.Bool
}

func NewEventBus() *EventBus {
	return &EventBus{subs: map[uint64]*Subscription{}}
}

// Subscribe creates a new subscription for the given topics. An empty
// topic list means subscribe to ALL topics.
func (b *EventBus) Subscribe(topics ...Topic) *Subscription {
	id := b.nextID.Add(1)
	tset := make(map[Topic]struct{}, len(topics))
	for _, t := range topics {
		tset[t] = struct{}{}
	}
	sub := &Subscription{
		id:     id,
		topics: tset,
		ch:     make(chan Message, 16),
	}
	b.mu.Lock()
	b.subs[id] = sub
	b.mu.Unlock()
	return sub
}

func (b *EventBus) Unsubscribe(s *Subscription) {
	b.mu.Lock()
	if _, ok := b.subs[s.id]; ok {
		delete(b.subs, s.id)
		close(s.ch)
	}
	b.mu.Unlock()
}

// Publish fans out to subscribers whose topic set is empty (all-topics)
// or contains msg.Topic. Slow consumers drop messages (channel buffer 16);
// the bus does not block the publisher.
func (b *EventBus) Publish(msg Message) {
	if b.closed.Load() {
		return
	}
	b.mu.RLock()
	for _, sub := range b.subs {
		if len(sub.topics) > 0 {
			if _, ok := sub.topics[msg.Topic]; !ok {
				continue
			}
		}
		select {
		case sub.ch <- msg:
		default:
			// drop on slow consumer
		}
	}
	b.mu.RUnlock()
}

// Close shuts down the bus. Existing subscribers see channel close.
func (b *EventBus) Close() {
	if !b.closed.CompareAndSwap(false, true) {
		return
	}
	b.mu.Lock()
	for _, sub := range b.subs {
		close(sub.ch)
	}
	b.subs = map[uint64]*Subscription{}
	b.mu.Unlock()
}

// Run starts a goroutine that periodically polls the SessionRepo +
// EventsRepo + ProjectsRepo, hashes the result, and publishes a message
// on the relevant topic if the hash changed. Server's lifetime cancels
// via ctx.
func (b *EventBus) Run(ctx context.Context, deps *apiDeps, intervalMs int) {
	go runWatcher(ctx, b, deps, intervalMs)
}
