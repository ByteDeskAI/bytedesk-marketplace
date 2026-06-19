// useSSE — single shared EventSource per app, topic-keyed callbacks.
// When the server publishes on a topic the bus mediates, the connected
// client gets `event: <topic>` and the registered callback fires. Hooks
// (useSessionList, useStats, ...) use this to trigger an immediate
// refetch on top of their polling fallback.
//
// On disconnect, EventSource auto-reconnects. We don't try to reproduce
// state — refetch on reconnect handles that.

import { useEffect } from 'preact/hooks';

type TopicCallback = () => void;

interface SSEClient {
  source: EventSource | null;
  listeners: Map<string, Set<TopicCallback>>;
  refCount: number;
}

const client: SSEClient = {
  source: null,
  listeners: new Map(),
  refCount: 0,
};

function ensureOpen() {
  if (client.source) return;
  const src = new EventSource('/api/stream');
  src.addEventListener('hello', () => {
    /* connection ack */
  });
  // EventSource auto-reconnects on error; nothing to do.
  for (const [topic] of client.listeners) {
    src.addEventListener(topic, makeDispatcher(topic));
  }
  client.source = src;
}

function makeDispatcher(topic: string) {
  return () => {
    const set = client.listeners.get(topic);
    if (!set) return;
    for (const cb of set) {
      try {
        cb();
      } catch {
        /* swallow consumer errors */
      }
    }
  };
}

function subscribe(topic: string, cb: TopicCallback) {
  let set = client.listeners.get(topic);
  if (!set) {
    set = new Set();
    client.listeners.set(topic, set);
    if (client.source) {
      client.source.addEventListener(topic, makeDispatcher(topic));
    }
  }
  set.add(cb);
  client.refCount++;
  ensureOpen();
}

function unsubscribe(topic: string, cb: TopicCallback) {
  const set = client.listeners.get(topic);
  if (set) {
    set.delete(cb);
    if (set.size === 0) client.listeners.delete(topic);
  }
  client.refCount = Math.max(0, client.refCount - 1);
  if (client.refCount === 0 && client.source) {
    client.source.close();
    client.source = null;
  }
}

/**
 * Subscribe to one or more SSE topics. The callback fires whenever the
 * server publishes on any of the listed topics. Cleanup on unmount.
 */
export function useSSE(topics: string | string[], callback: TopicCallback) {
  useEffect(() => {
    const ts = Array.isArray(topics) ? topics : [topics];
    ts.forEach((t) => subscribe(t, callback));
    return () => {
      ts.forEach((t) => unsubscribe(t, callback));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(topics) ? topics.join(',') : topics]);
}
