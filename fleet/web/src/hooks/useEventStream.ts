import type { FleetEvent } from '../api';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 5_000;
const LIMIT = 100;

export function useEventStream() {
  return usePolling<FleetEvent[]>(`/api/events?limit=${LIMIT}`, POLL_INTERVAL_MS);
}
