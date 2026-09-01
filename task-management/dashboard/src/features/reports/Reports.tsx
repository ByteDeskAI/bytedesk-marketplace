import { Compass, Download, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { Bars } from "../../components/ui/Bars";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { Field, Select } from "../../components/ui/Field";
import { Table, type Column } from "../../components/ui/Table";
import { Toggle } from "../../components/ui/Toggle";
import { exportUrl, fetchStale, fetchTaskTime, fetchTime } from "../../lib/api";
import { label } from "../../lib/keys.mjs";
import { useBoard, useEvents, useMeta, useNow } from "../../lib/store";
import { fmtMs, IdLink, Loaded, ScreenHead, useAsync } from "../ops/shared";
import "../../styles/reports.css";

type WipRow = { id: string; ms: number; human?: string };

export default function Reports() {
  const board = useBoard();
  const meta = useMeta();
  const now = useNow();
  const events = useEvents();
  const done = events.filter((e) => e.event === "done" || e.event === "reopened").length;
  const time = useAsync(fetchTime, [done]);
  const stale = useAsync(fetchStale, [done, now]);
  const [pick, setPick] = useState<string | null>(null);
  const detail = useAsync(() => (pick ? fetchTaskTime(pick) : Promise.resolve(null)), [pick]);
  const title = (id: string) => board?.tasks.find((t) => t.id === id)?.title ?? "";

  const days = useMemo(() => {
    const by = time.data?.throughput.byDay ?? {};
    return Object.keys(by).sort().slice(-30).map((d) => ({ label: d.slice(5), value: by[d] }));
  }, [time.data]);

  // export
  const [format, setFormat] = useState("md");
  const [epic, setEpic] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);
  const [withEvents, setWithEvents] = useState(false);
  const params = { format, epic: epic || undefined, status: status || undefined, open, events: withEvents && format === "json" };

  const wipCols: Column<WipRow>[] = [
    { key: "id", header: "Task", cell: (r) => <><IdLink id={r.id} /> <span className="tm-truncate">{title(r.id)}</span></> },
    { key: "ms", header: "In progress for", num: true, cell: (r) => fmtMs(r.ms) },
  ];

  return (
    <div className="tm-screen tm-reports">
      <ScreenHead title="Reports" blurb="Cycle time and throughput, derived from the event log." />
      <Loaded q={time} rows={3}>
        {(t) => t.completed === 0 && !t.wip.length ? (
          <EmptyState icon={<Compass size={28} />} title="Not enough history">Finish a task and the first cycle time appears here.</EmptyState>
        ) : (
          <>
            {/* One measure strip in mono — the profile bans hero metric grids. */}
            <dl className="tm-measures" aria-label="cycle time">
              <div><dt>completed</dt><dd>{t.completed}</dd></div>
              <div><dt>median cycle</dt><dd>{t.median ?? fmtMs(t.medianMs)}</dd></div>
              <div><dt>mean cycle</dt><dd>{t.mean ?? fmtMs(t.meanMs)}</dd></div>
              <div><dt>in progress</dt><dd>{t.wip.length}<span className="tm-measures__note">of {String(meta?.config.wipLimit ?? "—")}</span></dd></div>
              <div><dt>oldest open</dt><dd>{t.oldestOpen ? fmtMs(t.oldestOpen.ms) : "—"}{t.oldestOpen && <span className="tm-measures__note"><IdLink id={t.oldestOpen.id} /></span>}</dd></div>
              <div><dt>per day</dt><dd>{t.throughput.perDay.toFixed(1)}<span className="tm-measures__note">{t.throughput.total} finished</span></dd></div>
            </dl>
            <section className="tm-reports__section" aria-labelledby="tp">
              <h2 id="tp">Throughput by day</h2>
              {days.length ? <Bars rows={days} label="tasks finished per day" /> : <p className="tm-muted">no finished work yet</p>}
            </section>
            <div className="tm-reports__two">
              <section className="tm-reports__section" aria-labelledby="wip">
                <h2 id="wip">In progress now</h2>
                <Table columns={wipCols} rows={t.wip as WipRow[]} rowKey={(r) => r.id} onRow={(r) => setPick(r.id)} caption="work in progress with elapsed time" empty={<p className="tm-muted">nothing is in progress</p>} />
                <Loaded q={stale} rows={1}>
                  {(s) => (
                    <div className="tm-row">
                      <span className="tm-caps">stale after {s.minutes}m</span>
                      {s.tasks.length ? s.tasks.map((id) => <Chip key={id} tone="warn" dot onClick={() => setPick(id)}>{id}</Chip>) : <span className="tm-muted">none</span>}
                    </div>
                  )}
                </Loaded>
              </section>
              <section className="tm-reports__section" aria-labelledby="tis">
                <div className="tm-row"><h2 id="tis">Time in status</h2><span className="tm-grow" />{pick && <IdLink id={pick} />}</div>
                {!pick ? <p className="tm-muted">Pick a task from the table, or search for one, to see how long it sat in each status.</p> : (
                  <Loaded q={detail} rows={3}>
                    {(d) => d ? (
                      <div className="tm-stack">
                        <div className="tm-row"><span className="tm-caps">cycle</span><span className="tm-id">{fmtMs(d.cycle)}</span></div>
                        <Bars label={`time in status for ${d.id}`} format={(v) => fmtMs(v)} rows={Object.entries(d.inStatus).filter(([, ms]) => ms > 0).map(([s, ms]) => ({ label: label(s), value: ms, tone: s }))} />
                        <ol className="tm-reports__timeline" aria-label="timeline">
                          {d.timeline.map((e, i) => <li key={i}><time className="tm-id">{e.ts.replace("T", " ").slice(0, 16)}</time> {e.event}{e.status ? <> → <Chip kind="status" value={e.status}>{label(e.status)}</Chip></> : null}</li>)}
                        </ol>
                      </div>
                    ) : null}
                  </Loaded>
                )}
                <Select aria-label="pick a task" value={pick ?? ""} onChange={(e) => setPick(e.target.value || null)} placeholder="pick any task…" options={(board?.tasks ?? []).map((x) => ({ value: x.id, label: `${x.id} ${x.title}` }))} />
              </section>
            </div>
          </>
        )}
      </Loaded>
      <section className="tm-reports__section tm-reports__export" aria-labelledby="ex">
        <h2 id="ex">Export</h2>
        <p className="tm-muted">md is a report for a PR or standup; csv uses Jira's columns and status names; json is the whole store as one document.</p>
        <div className="tm-reports__form">
          <Field label="format">{(p) => <Select {...p} value={format} onChange={(e) => setFormat(e.target.value)} options={(meta?.vocab.exportFormats ?? ["md", "csv", "json"]).map((f) => ({ value: f, label: f }))} />}</Field>
          <Field label="epic">{(p) => <Select {...p} value={epic} onChange={(e) => setEpic(e.target.value)} placeholder="every epic" options={(board?.epics ?? []).map((ep) => ({ value: ep.id, label: `${ep.id} ${ep.title}` }))} />}</Field>
          <Field label="status">{(p) => <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)} placeholder="every status" options={(meta?.vocab.columns ?? []).map((s) => ({ value: s, label: label(s) }))} />}</Field>
          <Toggle checked={open} onChange={setOpen}>open work only</Toggle>
          <Toggle checked={withEvents} onChange={setWithEvents} disabled={format !== "json"}>include events (json)</Toggle>
        </div>
        <div className="tm-row">
          <a className="tm-btn" data-variant="primary" href={exportUrl({ ...params, download: true })}><Download size={14} /> Download {format}</a>
          <a className="tm-btn" href={exportUrl(params)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open in a tab</a>
          <Button variant="ghost" size="sm" onClick={() => { setEpic(""); setStatus(""); setOpen(false); setWithEvents(false); }}>Reset</Button>
        </div>
      </section>
    </div>
  );
}
