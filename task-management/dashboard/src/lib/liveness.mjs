/**
 * Last write per entity. Pure, so unit tests can import it without React.
 */
export const LIVE_WINDOW_MS = 45_000;

/** The last time each entity was written, newest wins. */
export function lastWriteByEntity(events) {
  const seen = new Map();
  for (const e of events) {
    if (!e.id) continue;
    const t = Date.parse(e.ts);
    if (Number.isNaN(t)) continue;
    const prev = seen.get(e.id);
    if (prev === undefined || t > prev) seen.set(e.id, t);
  }
  return seen;
}
