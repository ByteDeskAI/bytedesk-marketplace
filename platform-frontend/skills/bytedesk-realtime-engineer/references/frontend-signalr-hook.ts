"use client";

import { useState } from "react";
import { useTopic } from "@/lib/ws/use-topic";

export interface ResourceRealtimeEvent {
  type?: string;
  resourceId?: string;
  message?: string;
  timestamp?: string;
}

const MAX_EVENTS = 200;

/**
 * Domain hook template for ByteDesk product realtime.
 *
 * Keep the SignalR connection hidden behind useTopic. Components consume this
 * hook's typed state, never raw transport details.
 */
export function useResourceRealtime(resourceId: string | null) {
  const [events, setEvents] = useState<ResourceRealtimeEvent[]>([]);

  const { connected, lastEvent } = useTopic<ResourceRealtimeEvent>(
    resourceId ? `resource:${resourceId}` : null,
    {
      onEvent: (event) => {
        if (!event?.type) return;
        setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), event]);
      },
    },
  );

  return {
    connected,
    events,
    lastEvent,
  };
}