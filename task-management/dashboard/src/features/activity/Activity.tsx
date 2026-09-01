import { Activity as ActivityIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { Select, TextField } from "../../components/ui/Field";
import { Toggle } from "../../components/ui/Toggle";
import { fetchEvents } from "../../lib/api";
import { isTypingTarget, label } from "../../lib/keys.mjs";
import { setQuery, useLocation } from "../../lib/router";
import { useEvents, useMeta } from "../../lib/store";
import type { StoreEvent } from "../../lib/types";
import { clock, day, IdLink, Loaded, ScreenHead, short, useAsync } from "../ops/shared";
import "../../styles/activity.css";

type Row = StoreEvent & { said?: string; agent?: string; kind?: string; text?: string; index?: number; ref?: string };

/** What the row is about beyond its label: the patch, the reason, the move, what a subagent said. */
function detail(e: Row): string {
  if (e.event === "update" && e.patch) return e.patch.split(",").join(", ");
  if (e.reason) return e.reason;
  if (e.from || e.to) return `${e.from ?? "?"} → ${e.to ?? e.status ?? "?"}`;
  if (e.said) return `“${e.said}”`;
  if (e.text) return e.text;
  if (e.ref) return e.ref;
  if (e.title) return e.title;
  return "";
}

export default function Activity() {
  const { query } = useLocation();
  const meta = useMeta();
  const live = useEvents();
  const kind = query.get("kind") ?? "";
  const actor = query.get("actor") ?? "";
  const session = query.get("session") ?? "";
  const id = query.get("id") ?? "";
  const noise = query.get("noise") === "1";
  const grouped = query.get("group") === "session";
  const fetched = useAsync(() => fetchEvents({ limit: 500, id: id || undefined }), [id]);

  // The labelled, collapsed tail from the server, plus whatever the feed has delivered since.
  const rows = useMemo<Row[]>(() => {
    const base = (fetched.data ?? []) as Row[];
    const last = base.length ? base[base.length - 1].ts : "";
    // The catalog is flat: kind → { group, label }. An uncatalogued kind reads as words, never as an identifier.
    const catalog = Object.fromEntries(Object.entries((meta?.vocab.eventCatalog ?? {}) as Record<string, { label?: string }>).map(([k, v]) => [k, v.label ?? k]));
    const humanise = (k: string) => k.replace(/[_-]+/g, " ");
    const fresh = live.filter((e) => e.ts > last && (!id || e.id === id)).map((e) => ({ ...e, label: e.label ?? catalog[e.event] ?? humanise(e.event) }));
    return [...base, ...fresh]
      .filter((e) => (noise || !e._shadowed) && (!kind || e.event === kind) && (!actor || e.actor === actor) && (!session || e.session === session))
      .reverse();
  }, [fetched.data, live, meta, id, noise, kind, actor, session]);

  const options = (key: "event" | "actor" | "session") => [...new Set(((fetched.data ?? []) as Row[]).map((e) => e[key]).filter((v): v is string => Boolean(v)))].sort();

  // n / p walk the rows; the list is the focus scope so the board's keys stay out of it.
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target as HTMLElement) || (e.key !== "n" && e.key !== "p")) return;
      const els = [...(list.current?.querySelectorAll<HTMLElement>("[data-tm-event]") ?? [])];
      if (!els.length) return;
      const i = els.indexOf(document.activeElement as HTMLElement);
      els[(i + (e.key === "n" ? 1 : -1) + els.length) % els.length]?.focus();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const groups = useMemo(() => {
    if (!grouped) return [{ key: "", rows }];
    const m = new Map<string, Row[]>();
    for (const r of rows) m.set(r.session ?? "no session", [...(m.get(r.session ?? "no session") ?? []), r]);
    return [...m].map(([key, rows]) => ({ key, rows }));
  }, [rows, grouped]);

  return (
    <div className="tm-screen tm-activity">
      <ScreenHead title="Activity" blurb="Every write the store recorded, newest first, live."
        actions={<>
          <TextField aria-label="entity id" placeholder="id: TM-014" mono value={id} onChange={(e) => setQuery({ id: e.target.value.trim().toUpperCase() || null })} style={{ width: 140 }} />
          <Select aria-label="kind" value={kind} onChange={(e) => setQuery({ kind: e.target.value || null })} placeholder="every kind" options={options("event").map((v) => ({ value: v, label: v }))} />
          <Select aria-label="actor" value={actor} onChange={(e) => setQuery({ actor: e.target.value || null })} placeholder="every actor" options={options("actor").map((v) => ({ value: v, label: v }))} />
          <Select aria-label="session" value={session} onChange={(e) => setQuery({ session: e.target.value || null })} placeholder="every session" options={options("session").map((v) => ({ value: v, label: short(v, 8) }))} />
          <Toggle checked={grouped} onChange={(v) => setQuery({ group: v ? "session" : null })}>by session</Toggle>
          <Toggle checked={noise} onChange={(v) => setQuery({ noise: v ? "1" : null })}>show noise</Toggle>
        </>} />
      <Loaded q={fetched} rows={8}>
        {() => rows.length === 0 ? (
          <EmptyState icon={<ActivityIcon size={28} />} title="Quiet board">{kind || actor || session || id ? "Nothing matches these filters." : "No writes recorded yet. The first tm command or board action lands here."}</EmptyState>
        ) : (
          <ol className="tm-activity__list" ref={list} aria-label={`${rows.length} events`}>
            {groups.map((g) => (
              <li key={g.key} className="tm-activity__group">
                {grouped && <div className="tm-activity__session"><span className="tm-id">{g.key}</span><Chip kind="count">{g.rows.length}</Chip></div>}
                <ol>
                  {g.rows.map((e, i) => {
                    const prev = g.rows[i - 1];
                    const newDay = !prev || day(prev.ts) !== day(e.ts);
                    return (
                      <li key={`${e.ts}-${i}`} className="tm-activity__row" data-tm-event tabIndex={-1} data-status={e._status || undefined} data-shadowed={e._shadowed || undefined}>
                        {newDay && <div className="tm-activity__day">{day(e.ts)}</div>}
                        <time className="tm-id" dateTime={e.ts} title={e.ts}>{clock(e.ts)}</time>
                        <span className="tm-activity__who" title={e.session ?? "no session"}>{e.actor ?? "—"}</span>
                        <span className="tm-activity__what">
                          {e.id && <IdLink id={e.id} />}
                          <span>{e.label ?? e.event}</span>
                          {e._status && <Chip kind="status" value={e._status}>{label(e._status)}</Chip>}
                          {detail(e) && <span className="tm-muted tm-activity__detail">{detail(e)}</span>}
                        </span>
                        <span className="tm-activity__kind tm-id">{e.event}</span>
                      </li>
                    );
                  })}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </Loaded>
    </div>
  );
}
