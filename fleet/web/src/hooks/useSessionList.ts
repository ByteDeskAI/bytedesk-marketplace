import type { SessionRow } from '../api';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 5_000;

export function useSessionList() {
  return usePolling<SessionRow[]>('/api/sessions', POLL_INTERVAL_MS, 'sessions');
}
