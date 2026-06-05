import type { StatusResponse, DocsResponse, DocResponse } from './types';

const BASE = '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  status: () => get<StatusResponse>('/api/status'),
  docs: () => get<DocsResponse>('/api/docs'),
  doc: (id: string) => get<DocResponse>(`/api/docs/${encodeURIComponent(id)}`),
};

export function relTime(ts: string): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function initials(name: string | null): string {
  if (!name) return '?';
  return name.split(' ').map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2) || '?';
}

export function createSSE(
  onEvent: (raw: string) => void,
  onOpen?: () => void,
  onError?: () => void,
): () => void {
  const es = new EventSource('/events');
  es.onopen = () => onOpen?.();
  es.onmessage = (e: MessageEvent<string>) => onEvent(e.data);
  es.onerror = () => onError?.();
  return () => es.close();
}
