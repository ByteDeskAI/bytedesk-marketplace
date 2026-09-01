import { Bell, Download, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { Toggle } from "../../components/ui/Toggle";
import { Link } from "../../lib/router";
import { CATEGORIES } from "../../pwa/notify.mjs";
import type { Entry, Pwa } from "../../pwa/usePwa";
import "../../styles/settings.css";

const CATS = CATEGORIES as Record<string, string>;

/** The offline queue, one row per write: what it was, what happened, retry or drop it. */
export function OutboxList({ pwa }: { pwa: Pwa }) {
  if (!pwa.queue.length) return <p className="tm-faint">Nothing queued. Writes made while the server is unreachable wait here and replay through the same gates.</p>;
  return (
    <ul className="tm-outbox" aria-label="offline outbox">
      {pwa.queue.map((e: Entry) => (
        <li key={e.key} className="tm-outbox__row" data-status={e.status}>
          <span className="tm-stack" style={{ gap: "var(--tm-s1)" }}>
            <span className="tm-row">
              <Chip tone={e.status === "failed" ? "bad" : "info"} dot>{e.status === "failed" ? "refused" : "queued"}</Chip>
              {e.taskId && <Link to={`/tasks/${e.taskId}`} inspector className="tm-id">{e.taskId}</Link>}
              <span className="tm-truncate">{e.action}</span>
            </span>
            {e.error && <span className="tm-faint" style={{ overflowWrap: "anywhere" }}>{e.error}</span>}
          </span>
          <span className="tm-row" style={{ gap: "var(--tm-s1)" }}>
            {e.status === "failed" && <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} aria-label={`retry ${e.action}`} onClick={() => pwa.retryEntry(e.key)} />}
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label={`discard ${e.action}`} onClick={() => pwa.discardEntry(e.key)} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Permission + per-category switches. Shared by the popover and the settings page. */
export function NotificationPrefs({ pwa }: { pwa: Pwa }) {
  const granted = pwa.permission === "granted";
  return (
    <div className="tm-stack" style={{ gap: "var(--tm-s3)" }}>
      <div className="tm-row">
        <Chip tone={granted ? "ok" : pwa.permission === "denied" ? "bad" : "warn"} dot>
          {pwa.permission === "unsupported" ? "not supported here" : granted ? "allowed" : pwa.permission === "denied" ? "blocked by the browser" : "not asked yet"}
        </Chip>
        {!granted && pwa.permission !== "unsupported" && pwa.permission !== "denied" && (
          <Button size="sm" variant="primary" onClick={() => void pwa.askPermission()}>Allow notifications</Button>
        )}
      </div>
      {Object.entries(CATS).map(([key, text]) => (
        <Toggle key={key} checked={pwa.categories.includes(key)} disabled={!granted} onChange={() => pwa.toggleCategory(key)}>{text}</Toggle>
      ))}
    </div>
  );
}

/** The bell in the command bar: a popover with permission, categories, install, and the outbox. */
export function PwaPanel({ pwa }: { pwa: Pwa }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const pending = pwa.queue.length;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  return (
    <div className="tm-pwa" ref={root}>
      <Button variant="ghost" size="sm" icon={<Bell size={16} />} aria-label={`notifications${pending ? `, ${pending} in the outbox` : ""}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} />
      {pending > 0 && <span className="tm-pwa__badge" aria-hidden>{pending}</span>}
      {open && (
        <div className="tm-pwa__panel" id={id} role="dialog" aria-label="notifications and offline queue">
          {pwa.stale && <Chip tone="warn" dot>showing an offline copy of the board</Chip>}
          <span className="tm-caps">Browser notifications</span>
          <NotificationPrefs pwa={pwa} />
          {pwa.installer && (
            <div className="tm-row">
              <Download size={14} />
              <span className="tm-grow">Install the board as an app</span>
              <Button size="sm" onClick={() => void pwa.install()}>Install</Button>
              <Button size="sm" variant="ghost" onClick={pwa.dismissInstall}>Not now</Button>
            </div>
          )}
          <span className="tm-caps">Offline outbox</span>
          <OutboxList pwa={pwa} />
          <Link to="/settings#notifications" onClick={() => setOpen(false)}>All notification settings</Link>
        </div>
      )}
    </div>
  );
}
