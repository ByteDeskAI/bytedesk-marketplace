import { useState, type DragEvent, type ReactNode } from "react";
import { Chip } from "../../components/ui/Chip";
import { Kbd } from "../../components/ui/Kbd";
import { COLUMNS, label } from "../../lib/keys.mjs";
import type { Status } from "../../lib/types";

/**
 * One status column: the heading is the shortcut (the digit is printed beside it), the list is
 * a drop target for a status change. Children are the cards; the count is the caller's.
 */
export function Column({ status, count, children, onDropStatus, compact }: { status: Status; count: number; children: ReactNode; onDropStatus: (id: string, status: Status) => void; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const digit = COLUMNS.indexOf(status) + 1;
  const accept = (e: DragEvent) => e.dataTransfer.types.includes("text/tm-id");
  return (
    <section className="tm-col" data-tm-column={status} data-status={status} data-over={over || undefined}>
      {!compact && (
        <header className="tm-col__head">
          <Chip kind="status" value={status}>{label(status)}</Chip>
          <span className="tm-col__count" aria-hidden>{count}</span>
          <span className="tm-grow" />
          <Kbd>{String(digit)}</Kbd>
        </header>
      )}
      <ul
        className="tm-col__list"
        role="list"
        aria-label={`${label(status)}, ${count}`}
        onDragOver={(e) => {
          if (!accept(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false);
          const id = e.dataTransfer.getData("text/tm-id");
          if (!id) return;
          e.preventDefault();
          onDropStatus(id, status);
        }}
      >
        {children}
      </ul>
    </section>
  );
}
