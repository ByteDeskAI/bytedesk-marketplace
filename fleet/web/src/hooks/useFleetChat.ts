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
import { fetchMessages, sendMessage as sendMessageAPI, type UIMessage, type UIPart, type TranscriptEvent } from '../api';

export interface FleetChatState {
  messages: UIMessage[];
  sendMessage: (text: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

interface Options {
  agentID?: string;     // for sub-agent threads
  limit?: number;       // initial history cap (default 200)
}

export function useFleetChat(ticket: string | null, opts: Options = {}): FleetChatState {
  const { agentID, limit = 200 } = opts;
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live tool-call index across renders so SSE deltas can fold a
  // tool_result into the prior tool_use's UIMessage. Keyed by tool_use_id.
  const indexRef = useRef<Map<string, { messageID: string; partIdx: number }>>(new Map());

  useEffect(() => {
    if (!ticket) {
      setMessages([]);
      indexRef.current.clear();
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchMessages(ticket, { agent_id: agentID, limit })
      .then((seed) => {
        if (cancelled) return;
        setMessages(seed);
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

    const es = new EventSource(`/api/sessions/${encodeURIComponent(ticket)}/transcript`);
    es.addEventListener('transcript', (ev) => {
      if (cancelled) return;
      try {
        const e = JSON.parse((ev as MessageEvent).data) as TranscriptEvent;
        // Filter by agent so a sub-agent thread ignores parent events
        // and vice versa.
        if ((agentID || '') !== (e.agent_id || '')) return;
        applyDelta(e, setMessages, indexRef.current);
      } catch { /* ignore parse errors */ }
    });
    es.onerror = () => { /* EventSource auto-reconnects */ };

    return () => { cancelled = true; es.close(); };
  }, [ticket, agentID, limit]);

  const sendMessage = async (text: string) => {
    if (!ticket || !text.trim()) return;
    // Sub-agents have no own input channel — typing always lands in
    // the parent's PTY. Caller (composer) should already gate on this.
    await sendMessageAPI(ticket, text);
  };

  return { messages, sendMessage, isLoading, error };
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
