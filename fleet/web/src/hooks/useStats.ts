import type { FleetStats } from '../api';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 5_000;

export function useStats() {
  return usePolling<FleetStats>('/api/stats', POLL_INTERVAL_MS, 'stats');
}
