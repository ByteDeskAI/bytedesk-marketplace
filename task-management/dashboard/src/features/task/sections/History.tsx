import { useEffect, useState } from "react";
import { ErrorPanel } from "../../../components/ui/ErrorPanel";
import { SkeletonRows } from "../../../components/ui/Skeleton";
import { fetchHistory } from "../../../lib/api";
import { useEvents } from "../../../lib/store";
import type { History as HistoryPayload } from "../../../lib/types";

/** Everything the event log says about one entity, newest first. Refetches as the feed moves. */
export function History({ id }: { id: string }) {
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const events = useEvents();
  const tick = events.filter((e) => e.id === id).length;
  useEffect(() => {
    let live = true;
    fetchHistory(id)
      .then((h) => live && setData(h))
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [id, tick]);
  if (error) return <ErrorPanel title="History could not be loaded" detail={error} />;
  if (!data) return <SkeletonRows rows={5} height={28} />;
  const rows = data.events.filter((e) => !e._shadowed).slice().reverse();
  if (!rows.length) return <p className="tm-faint">No events recorded for {id}.</p>;
  return (
    <ol className="tm-history" aria-label={`history of ${id}`}>
      {rows.map((e, i) => (
        <li key={`${e.ts}-${i}`} className="tm-history__row">
          <time className="mono tm-faint" dateTime={e.ts}>{e.ts.slice(0, 19).replace("T", " ")}</time>
          <span className="tm-history__label">{e.label ?? e.event}{e._status ? ` → ${e._status}` : ""}</span>
          <span className="tm-faint tm-truncate">{[e.actor, e.reason, e.patch].filter(Boolean).join(" · ")}</span>
        </li>
      ))}
    </ol>
  );
}
