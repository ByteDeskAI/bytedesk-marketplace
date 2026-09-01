/**
 * What `/api/task/:id/stream` pushes: the server's transcript parser shapes messages as
 * TanStack-style UIMessages. ponytail: a local type instead of the @tanstack/ai dependency —
 * this panel only renders, so the library's hooks (built around sending) bought nothing.
 */
export interface StreamPart {
  type: string;
  text?: string;
  toolName?: string;
  name?: string;
  args?: Record<string, unknown>;
  input?: unknown;
  result?: unknown;
  output?: unknown;
  isError?: boolean;
}
export interface StreamMessage {
  id?: string;
  role: string;
  parts: StreamPart[];
  createdAt?: string | null;
  ts?: string;
  sidechain?: boolean;
}
export interface StreamPayload {
  messages: StreamMessage[];
  session: string | null;
  file: string | null;
  harness: string | null;
  reason: string | null;
}
