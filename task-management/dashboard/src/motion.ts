/**
 * Motion as information.
 *
 * Two jobs only: show that work is *happening*, and show that something *changed*. Anything that
 * moves without carrying one of those is decoration, and decoration on a board you leave open all
 * day becomes wallpaper — after which the motion that does mean something is invisible too.
 *
 * Three rules fall out of that, and the tests hold them:
 *   - the liveness pulse is driven by real writes, not by a status. A card claimed four hours ago
 *     and a card being worked on right now are both `in_progress`; only one of them should move.
 *   - nothing loops on an idle board. The pulse has a window and then stops.
 *   - `prefers-reduced-motion` removes all of it and loses no information, because everything
 *     motion says here is also said by a number, a column, or a timestamp.
 *
 * Durations and curves come from @atlaskit/motion so the board moves like the rest of ADS rather
 * than to timings someone made up.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { StoreEvent } from "./types";

/**
 * How long after a write a card counts as "being worked on".
 *
 * Long enough to survive the gap between a tool call and the next store write, short enough that a
 * session which stopped stops pulsing while you are still looking at it. The board's own clock
 * ticks every 15s, so this is comfortably above one tick.
 */
export const LIVE_WINDOW_MS = 45_000;

/** The last time each entity was written, newest wins. */
export function lastWriteByEntity(events: StoreEvent[]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const e of events) {
    if (!e.id) continue;
    const t = Date.parse(e.ts);
    if (Number.isNaN(t)) continue;
    const prev = seen.get(e.id);
    if (prev === undefined || t > prev) seen.set(e.id, t);
  }
  return seen;
}

/**
 * Which cards are being worked on *now*, as opposed to merely claimed.
 *
 * Derived from the event feed the board already holds — every write by every session and by the
 * CLI arrives there over SSE, so this needs no new endpoint and no per-card transcript read.
 */
export function useLiveWork(events: StoreEvent[], now: number): Set<string> {
  const writes = useMemo(() => lastWriteByEntity(events), [events]);
  return useMemo(() => {
    const live = new Set<string>();
    for (const [id, t] of writes) if (now - t < LIVE_WINDOW_MS) live.add(id);
    return live;
  }, [writes, now]);
}

/**
 * True for a moment each time `value` changes — the hook behind every "that number just moved"
 * flash. Returns false on first render: a board that has just loaded has not changed, and
 * flashing every count on arrival would teach you to ignore the flash.
 */
export function useChanged(value: unknown, ms = 900): boolean {
  const previous = useRef(value);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    setChanged(true);
    const t = setTimeout(() => setChanged(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return changed;
}
