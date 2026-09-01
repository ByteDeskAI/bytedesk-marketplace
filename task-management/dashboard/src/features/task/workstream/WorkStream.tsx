import { useEffect, useRef, useState } from "react";
import { Chip } from "../../../components/ui/Chip";
import type { StreamMessage, StreamPart, StreamPayload } from "./types";

/**
 * The work behind an in-progress task. Read-only by construction: the only network call is
 * an EventSource GET, so watching a run can never be a way to steer one.
 */
export function WorkStream({ taskId }: { taskId: string }) {
  const [payload, setPayload] = useState<StreamPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const tail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPayload(null);
    setFailed(false);
    const src = new EventSource(`/api/task/${encodeURIComponent(taskId)}/stream`);
    src.onmessage = (e) => {
      try {
        setPayload(JSON.parse(e.data) as StreamPayload);
      } catch {
        /* a truncated frame; the next push is whole */
      }
    };
    src.onerror = () => setFailed(true);
    return () => src.close();
  }, [taskId]);

  useEffect(() => {
    tail.current?.scrollIntoView({ block: "end" });
  }, [payload?.messages.length]);

  const messages = payload?.messages ?? [];
  return (
    <section className="tm-stream" aria-label="work stream">
      <div className="tm-row tm-stream__head">
        <span className="tm-caps">work</span>
        <Chip kind="count">{messages.length}</Chip>
        {payload?.harness && <Chip kind="plain" tone="accent">{payload.harness}</Chip>}
        {payload?.session ? <Chip kind="plain" tone="ok" dot>live</Chip> : <Chip kind="plain" dot>idle</Chip>}
      </div>
      <div className="tm-stream__scroll">
        {messages.length ? (
          messages.map((m, i) => <Message key={m.id ?? i} m={m} />)
        ) : (
          <p className="tm-faint">
            {failed ? "the stream dropped — it reconnects on its own" : payload ? payload.reason ?? "nothing yet — this task holds a claim but the session has not written" : "connecting…"}
          </p>
        )}
        <div ref={tail} />
      </div>
    </section>
  );
}

const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

function Message({ m }: { m: StreamMessage }) {
  return (
    <div className="tm-stream__msg" data-role={m.role}>
      <div className="tm-row" style={{ gap: "var(--tm-s2)" }}>
        <span className="tm-caps">{m.role}</span>
        {m.sidechain && <Chip kind="plain" tone="info">subagent</Chip>}
        <span className="tm-faint mono">{clock(m.createdAt ?? m.ts)}</span>
      </div>
      {m.parts.map((p, i) => <Part key={i} part={p} />)}
    </div>
  );
}

const str = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v, null, 1));

function Part({ part }: { part: StreamPart }) {
  if (part.type === "text") return <pre className="tm-stream__text">{part.text}</pre>;
  if (part.type === "tool-call") {
    const args = Object.values(part.args ?? (part.input as Record<string, unknown> | undefined) ?? {}).filter(Boolean);
    return (
      <div className="tm-stream__tool">
        <Chip kind="plain" tone="info">{part.toolName ?? part.name ?? "tool"}</Chip>
        {args.length > 0 && <span className="tm-faint mono tm-truncate">{str(args[0])}</span>}
      </div>
    );
  }
  if (part.type === "tool-result") {
    const out = str(part.result ?? part.output);
    if (!out) return null;
    return <pre className="tm-stream__tool" data-error={part.isError || undefined}>{out}</pre>;
  }
  return null; // an unknown part type is a newer harness, not a crash
}
