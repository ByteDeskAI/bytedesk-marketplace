/**
 * What the operational screens (graph, activity, standup, reports, doctor, sessions, search)
 * share. ponytail: one tiny async hook and three helpers, not a data layer — the store owns the
 * board; these screens read routes the board does not cache.
 */
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { routeForId } from "../../app/routes";
import { Link } from "../../lib/router";
import { toast } from "../../lib/toast";
import { fmtDuration } from "../../../metrics.mjs";

export interface Async<T> { data: T | null; error: string | null; loading: boolean; reload: () => void }

/** Fetch on mount and whenever `deps` change; `reload()` after a write. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn().then((d) => { if (live) { setData(d); setError(null); } }, (e: Error) => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/** The three states every screen owes: skeleton, the server's own refusal, then content. */
export function Loaded<T>({ q, rows = 4, children }: { q: Async<T>; rows?: number; children: (data: T) => ReactNode }) {
  if (q.error && !q.data) return <ErrorPanel detail={q.error} action={<Button size="sm" onClick={q.reload}>Try again</Button>} />;
  if (!q.data) return <SkeletonRows rows={rows} />;
  return <>{children(q.data)}</>;
}

/** An entity id in mono that opens its inspector over the current screen. */
export function IdLink({ id, children }: { id: string; children?: ReactNode }) {
  const to = routeForId(id);
  if (!to) return <span className="tm-id">{id}</span>;
  return <Link to={to} inspector className="tm-id">{children ?? id}</Link>;
}

export async function copyText(text: string, what = "text") {
  try {
    await navigator.clipboard.writeText(text);
    toast("ok", `Copied ${what}`);
  } catch {
    toast("bad", "Copy refused", "the browser did not grant clipboard access");
  }
}

/** A copy button that confirms in place, not only in the toast. */
export function CopyButton({ text, what, label, size = "sm" }: { text: string | (() => Promise<string>); what: string; label?: string; size?: "sm" | "md" }) {
  const [done, setDone] = useState(false);
  return (
    <Button size={size} icon={done ? <Check size={14} /> : <Copy size={14} />} aria-label={label ?? `copy ${what}`} onClick={async () => {
      const t = typeof text === "function" ? await text().catch((e: Error) => { toast("bad", "Copy refused", e.message); return null; }) : text;
      if (t == null) return;
      await copyText(t, what);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    }}>{label}</Button>
  );
}

export const fmtMs = (ms: number | null | undefined) => (typeof ms === "number" ? fmtDuration(ms) || "0m" : "—");
export const ago = (ts: string | undefined, now: number) => (ts ? `${fmtMs(Math.max(0, now - Date.parse(ts)))} ago` : "—");
export const clock = (ts: string) => ts.slice(11, 19);
export const day = (ts: string) => ts.slice(0, 10);
export const short = (s: string | null | undefined, n = 12) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : "—");

export function ScreenHead({ title, blurb, actions }: { title: string; blurb?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="tm-screen__head">
      <div>
        <h1>{title}</h1>
        {blurb && <p>{blurb}</p>}
      </div>
      {actions && <div className="tm-screen__actions">{actions}</div>}
    </div>
  );
}
