import type { Project } from '../api';
import { usePolling } from './usePolling';

const POLL_INTERVAL_MS = 30_000;

export function useProjects() {
  return usePolling<Project[]>('/api/projects', POLL_INTERVAL_MS);
}
