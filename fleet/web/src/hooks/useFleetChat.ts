// useFleetChat — chat-mode state hook. One per session ticket (or one
// per (ticket, agent_id) pair for sub-agent threads).
//
// Mirrors the surface of @tanstack/ai-react's useChat
// ({ messages, sendMessage, isLoading }) but runs against fleet's
// existing transcript SSE feed instead of an outbound LLM call. The
// jsonl is the source of truth — claude writes it; we just project it.
//
// Bootstrap: GET /api/sessions/<T>/messages?limit=N&agent_id=<id>
// Live deltas: SSE /api/sessions/<T>/transcript — `transcript` events
//   are projected into UIMessage updates (new assistant turns, tool
//   results folding into prior tool-call parts, etc.).

import { useEffect, useRef, useState } from 'preact/hooks';
import { sendMessage as sendMessageAPI, type UIMessage, type UIPart, type TranscriptEvent } from '../api';

export interface FleetChatState {
  messages: UIMessage[];
  sendMessage: (text: string) => Promise<void>;
  sendKeys: (keys: string[]) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  /** Fetch the next batch of older history. Returns the count of
   *  messages added (0 means no more / already loading). */
  loadMore: () => Promise<number>;
  hasMore: boolean;
  loadingMore: boolean;
  /** SSE connection state — `live` while the EventSource is open and
   *  receiving events; `reconnecting` between drops; `closed` only
   *  during teardown. Hosts can render a small status pill. */
  connection: 'live' | 'reconnecting' | 'closed';
}

interface Options {
  agentID?: string;     // for sub-agent threads
  limit?: number;       // initial history cap (default 200)
  // Custom endpoints — used by the main tile (MainChatTile) which
  // hits /api/main/{messages,transcript} instead of the per-session
  // routes. `sendURL: null` disables the composer entirely (sub-agent
  // threads + main tile read-only fallback).
  messagesURL?: string;
  transcriptURL?: string;
  sendURL?: string | null;
  keysURL?: string | null; // POST {keys: string[]}
}

export function useFleetChat(ticket: string | null, opts: Options = {}): FleetChatState {
  const { agentID, limit = 200 } = opts;
  const baseURL = ticket ? `/api/sessions/${encodeURIComponent(ticket)}` : '';
  const messagesURL = opts.messagesURL ?? `${baseURL}/messages`;
  const transcriptURL = opts.transcriptURL ?? `${baseURL}/transcript`;
  const sendURL = opts.sendURL === null ? null : (opts.sendURL ?? `${baseURL}/send`);
  const keysURL = opts.keysURL === null ? null : (opts.keysURL ?? `${baseURL}/keys`);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [connection, setConnection] = useState<'live' | 'reconnecting' | 'closed'>('reconnecting');

  // Live tool-call index across renders so SSE deltas can fold a
  // tool_result into the prior tool_use's UIMessage. Keyed by tool_use_id.
  const indexRef = useRef<Map<string, { messageID: string; partIdx: number }>>(new Map());
  // Latest messages snapshot for loadMore — we want the cursor to
  // reflect the freshest oldest-id without re-running the effect that
  // owns SSE on every messages update.
  const messagesRef = useRef<UIMessage[]>([]);
  messagesRef.current = messages;
  // Pending optimistic user messages awaiting their canonical
  // user_text SSE event. Used by applyDelta to replace the
  // optimistic id with the canonical one rather than render twice.
  const pendingUserRef = useRef<Array<{ id: string; text: string }>>([]);

  useEffect(() => {
    if (!ticket) {
      setMessages([]);
      indexRef.current.clear();
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (agentID) params.set('agent_id', agentID);
    if (limit) params.set('limit', String(limit));
    const fullMessagesURL = `${messagesURL}${params.toString() ? `?${params.toString()}` : ''}`;
    fetch(fullMessagesURL)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((seed: UIMessage[]) => {
        if (cancelled) return;
        setMessages(seed);
        // Reset pagination state on every (ticket, agentID) switch.
        // If we got fewer than `limit` we know there's no older
        // history left; otherwise keep hasMore=true and let loadMore
        // discover the boundary.
        setHasMore(seed.length >= limit);
        // Rebuild tool-call index from the seed.
        indexRef.current.clear();
        for (const m of seed) {
          for (let i = 0; i < m.parts.length; i++) {
            const p = m.parts[i];
            if (p.type === 'tool-call' && p.tool_use_id) {
              indexRef.current.set(p.tool_use_id, { messageID: m.id, partIdx: i });
            }
          }
        }
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    const es = new EventSource(transcriptURL);
    es.onopen = () => { if (!cancelled) setConnection('live'); };
    es.addEventListener('transcript', (ev) => {
      if (cancelled) return;
      // Receiving a transcript event implies the connection is healthy.
      setConnection('live');
      try {
        const e = JSON.parse((ev as MessageEvent).data) as TranscriptEvent;
        // Filter by agent so a sub-agent thread ignores parent events
        // and vice versa.
        if ((agentID || '') !== (e.agent_id || '')) return;
        applyDelta(e, setMessages, indexRef.current, pendingUserRef.current);
      } catch { /* ignore parse errors */ }
    });
    es.onerror = () => { if (!cancelled) setConnection('reconnecting'); };

    return () => { cancelled = true; setConnection('closed'); es.close(); };
  }, [ticket, agentID, limit, messagesURL, transcriptURL]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (sendURL === null) {
      // Read-only mode (sub-agent thread; main tile fallback). Composer
      // should already be hidden — guarding here for safety.
      return;
    }
    // Optimistic: append the user message to the chat immediately so
    // the user gets feedback. The canonical entry from claude's jsonl
    // arrives later via SSE (`user_text` event); applyDelta dedupes
    // by checking the pending map, so the optimistic id is replaced
    // in-place rather than rendering twice (BDM-39).
    const optimisticID = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    pendingUserRef.current.push({ id: optimisticID, text: trimmed });
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticID,
        role: 'user',
        timestamp: new Date().toISOString(),
        parts: [{ type: 'text', text: trimmed }],
      },
    ]);
    try {
      if (sendURL === `/api/sessions/${encodeURIComponent(ticket || '')}/send` && ticket) {
        await sendMessageAPI(ticket, trimmed);
        return;
      }
      const r = await fetch(sendURL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      });
      if (!r.ok) {
        throw new Error(`${r.status} ${r.statusText}`);
      }
    } catch (err) {
      // Rollback on failure.
      pendingUserRef.current = pendingUserRef.current.filter((p) => p.id !== optimisticID);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticID));
      throw err;
    }
  };

  const sendKeys = async (keys: string[]) => {
    if (!keys.length || keysURL === null) return;
    const r = await fetch(keysURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  };

  // Pagination — fetch older history when the user scrolls near the
  // top. Cursor is the oldest currently-loaded message's id; server
  // returns the previous batch (or empty when there's nothing older).
  const loadMore = async (): Promise<number> => {
    if (!ticket || loadingMore || !hasMore) return 0;
    const oldest = messagesRef.current[0];
    if (!oldest) return 0;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      if (agentID) params.set('agent_id', agentID);
      params.set('limit', String(limit));
      params.set('before', oldest.id);
      const r = await fetch(`${messagesURL}?${params.toString()}`);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const more = (await r.json()) as UIMessage[];
      if (more.length === 0) {
        setHasMore(false);
        return 0;
      }
      // Prepend, dedupe by id (defense — server should already exclude
      // the cursor and everything after).
      const existingIDs = new Set(messagesRef.current.map((m) => m.id));
      const fresh = more.filter((m) => !existingIDs.has(m.id));
      if (fresh.length === 0) {
        setHasMore(false);
        return 0;
      }
      // Update tool-call index for prepended tool-calls.
      for (const m of fresh) {
        for (let i = 0; i < m.parts.length; i++) {
          const p = m.parts[i];
          if (p.type === 'tool-call' && p.tool_use_id) {
            indexRef.current.set(p.tool_use_id, { messageID: m.id, partIdx: i });
          }
        }
      }
      setMessages((prev) => [...fresh, ...prev]);
      // If we got fewer than the requested page size, we've hit the
      // beginning of the file.
      if (more.length < limit) setHasMore(false);
      return fresh.length;
    } catch (e) {
      setError((e as Error).message);
      return 0;
    } finally {
      setLoadingMore(false);
    }
  };

  return { messages, sendMessage, sendKeys, isLoading, error, loadMore, hasMore, loadingMore, connection };
}

// applyDelta translates a single TranscriptEvent into a state-setter
// update. Ports the server's projection rules so the wire shape stays
// consistent: tool_use → new tool-call part; tool_result → fold into
// prior tool-call; text/thinking → append part to prior turn or open
// a new one.
function applyDelta(
  e: TranscriptEvent,
  setMessages: (updater: (prev: UIMessage[]) => UIMessage[]) => void,
  index: Map<string, { messageID: string; partIdx: number }>,
  pendingUser: Array<{ id: string; text: string }>,
) {
  setMessages((prev) => {
    const next = prev.slice();
    const last = next.length > 0 ? next[next.length - 1] : null;

    const append = (part: UIPart, role: UIMessage['role']) => {
      // Coalesce consecutive parts onto the same role+second-bucket
      // message so a streaming tool sequence renders as one bubble.
      if (last && last.role === role && bucketKey(last.timestamp) === bucketKey(e.timestamp)) {
        last.parts = [...last.parts, part];
        next[next.length - 1] = { ...last };
        return next.length - 1;
      }
      const msg: UIMessage = {
        id: synthID(e),
        role,
        timestamp: e.timestamp,
        agent_id: e.agent_id,
        parts: [part],
      };
      next.push(msg);
      return next.length - 1;
    };

    switch (e.type) {
      case 'text': {
        if (!e.text) return prev;
        append({ type: 'text', text: e.text }, 'assistant');
        return next;
      }
      case 'thinking': {
        if (!e.text) return prev;
        append({ type: 'thinking', text: e.text }, 'assistant');
        return next;
      }
      case 'tool_use': {
        const part: UIPart = {
          type: 'tool-call',
          tool_use_id: synthToolID(e),
          tool_name: e.tool_name,
          state: 'running',
        };
        const mIdx = append(part, 'assistant');
        if (part.tool_use_id) {
          index.set(part.tool_use_id, { messageID: next[mIdx].id, partIdx: next[mIdx].parts.length - 1 });
        }
        return next;
      }
      case 'tool_result':
      case 'tool_error': {
        // Fold into the most-recent tool-call. Without tool_use_id on
        // the SSE event we can't pair precisely; the next /messages
        // refresh will reconcile.
        for (let i = next.length - 1; i >= 0; i--) {
          const m = next[i];
          for (let j = m.parts.length - 1; j >= 0; j--) {
            const p = m.parts[j];
            if (p.type === 'tool-call' && p.state === 'running') {
              const updated: UIPart = {
                ...p,
                state: e.type === 'tool_error' ? 'error' : 'done',
                output: e.text || p.output,
              };
              const newParts = m.parts.slice();
              newParts[j] = updated;
              next[i] = { ...m, parts: newParts };
              return next;
            }
          }
        }
        return prev;
      }
      case 'system': {
        const subtype = (e.detail?.subtype as string) || '';
        if (subtype !== 'compact_boundary' && subtype !== 'api_error') return prev;
        next.push({
          id: synthID(e),
          role: 'system',
          timestamp: e.timestamp,
          parts: [{ type: 'system', subtype, text: subtype === 'compact_boundary' ? '↺ context compacted' : '⚠ API error' }],
        });
        return next;
      }
      case 'user_text': {
        if (!e.text) return prev;
        // If we have a pending optimistic with matching text, replace
        // it in-place rather than rendering a duplicate.
        const matchIdx = pendingUser.findIndex((p) => p.text === e.text);
        if (matchIdx >= 0) {
          const opt = pendingUser[matchIdx];
          pendingUser.splice(matchIdx, 1);
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].id === opt.id) {
              next[i] = {
                id: synthID(e),
                role: 'user',
                timestamp: e.timestamp,
                agent_id: e.agent_id,
                parts: [{ type: 'text', text: e.text }],
              };
              return next;
            }
          }
        }
        next.push({
          id: synthID(e),
          role: 'user',
          timestamp: e.timestamp,
          agent_id: e.agent_id,
          parts: [{ type: 'text', text: e.text }],
        });
        return next;
      }
      case 'last-prompt': {
        if (!e.text) return prev;
        next.push({
          id: synthID(e),
          role: 'user',
          timestamp: e.timestamp,
          parts: [{ type: 'text', text: e.text }],
        });
        return next;
      }
      // pr-link, stop, etc. — metadata; UI surfaces via TicketStats.
      default:
        return prev;
    }
  });
}

function synthID(e: TranscriptEvent): string {
  return `${e.agent_id || 'p'}-${e.timestamp}-${e.type}`;
}

function synthToolID(e: TranscriptEvent): string {
  return `${synthID(e)}-${e.tool_name || 'tool'}`;
}

function bucketKey(ts: string): string {
  // 2-second bucket — coalesce a streaming sequence into one bubble
  // without merging genuinely separate turns.
  if (!ts) return '';
  const t = new Date(ts).getTime();
  return String(Math.floor(t / 2000));
}
