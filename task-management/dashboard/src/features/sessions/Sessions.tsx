import { Radio } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { Select } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { Progress } from "../../components/ui/Progress";
import { Table, type Column } from "../../components/ui/Table";
import { fetchClaims, fetchHandoff, fetchParallel, fetchSessions, fetchStale, fetchWorktrees, write } from "../../lib/api";
import { label } from "../../lib/keys.mjs";
import { setQuery, useLocation } from "../../lib/router";
import { useBoard, useEvents, useMeta, useNow, useWrite } from "../../lib/store";
import type { Claim, Worktree } from "../../lib/types";
import { ago, CopyButton, fmtMs, IdLink, Loaded, ScreenHead, short, useAsync } from "../ops/shared";
import "../../styles/sessions.css";

type ClaimRow = Claim & { id: string; live: boolean; stale: boolean };
/** The server sends `{id,title}` per batch task; the type said `string[]`. Read both. */
type BatchTask = string | { id: string; title?: string };
const tid = (t: BatchTask) => (typeof t === "string" ? t : t.id);

export default function Sessions() {
  const board = useBoard();
  const meta = useMeta();
  const now = useNow();
  const events = useEvents();
  const { query } = useLocation();
  const epic = query.get("epic") ?? "";
  const writes = events.filter((e) => ["claim", "release", "claim_stolen", "claims_swept", "worktree_new", "worktree_rm", "done", "update"].includes(e.event)).length;
  const claims = useAsync(fetchClaims, [writes]);
  const sessions = useAsync(fetchSessions, [writes]);
  const worktrees = useAsync(fetchWorktrees, [writes]);
  const stale = useAsync(fetchStale, [writes, now]);
  const parallel = useAsync(() => fetchParallel(epic || undefined), [epic, writes]);
  const { run, pending } = useWrite();
  const [sweep, setSweep] = useState(false);
  const [rm, setRm] = useState<Worktree | null>(null);
  const [force, setForce] = useState(false);
  const [newWt, setNewWt] = useState("");
  const ttl = Number(meta?.config.claimTtlMinutes ?? 240) * 60_000;
  const title = (id: string) => board?.tasks.find((t) => t.id === id)?.title ?? "";

  const rows = useMemo<ClaimRow[]>(() => {
    if (!claims.data) return [];
    const live = new Map((sessions.data?.sessions ?? []).map((s) => [s.session, s.live]));
    return Object.entries(claims.data.claims).map(([id, c]) => ({ id, ...c, live: live.get(c.session) ?? false, stale: claims.data!.stale.includes(id) }));
  }, [claims.data, sessions.data]);

  const cols: Column<ClaimRow>[] = [
    { key: "task", header: "Task", cell: (r) => <><IdLink id={r.id} /> <span className="tm-truncate tm-sessions__title">{title(r.id)}</span></> },
    { key: "session", header: "Session", cell: (r) => r.session ? <span className="tm-row"><span className="tm-id" title={r.session}>{short(r.session, 8)}</span>{r.session === (sessions.data as { mine?: string } | null)?.mine && <Chip tone="accent">this session</Chip>}<CopyButton text={r.session} what="session id" /></span> : <span className="tm-muted">unowned</span> },
    { key: "actor", header: "Actor", cell: (r) => r.actor ?? "—" },
    { key: "worktree", header: "Worktree", cell: (r) => <span className="tm-id tm-truncate" title={r.worktree}>{r.worktree ? r.worktree.replace(meta?.store.root ?? "", ".") : "—"}</span> },
    { key: "branch", header: "Branch", cell: (r) => <span className="tm-id">{r.branch ?? "—"}</span> },
    { key: "age", header: "Age", num: true, cell: (r) => ago(r.ts, now) },
    { key: "expires", header: "Expires", cell: (r) => r.stale ? <Chip tone="warn" dot>expired</Chip> : r.ts ? <span className="tm-id">in {fmtMs(Math.max(0, Date.parse(r.ts) + ttl - now))}</span> : "—" },
    { key: "state", header: "State", cell: (r) => <Chip tone={r.live ? "ok" : undefined} dot>{r.live ? "live" : "idle"}</Chip> },
    { key: "act", header: "", cell: (r) => <Button size="sm" pending={pending} onClick={(e) => { e.stopPropagation(); void run(() => write.release(r.id), { ok: `${r.id} released` }).then(claims.reload); }}>Release</Button> },
  ];

  const tmWorktrees = (worktrees.data ?? []).filter((w) => w.taskId);
  const candidates = (board?.tasks ?? []).filter((t) => ["open", "in_progress", "blocked", "parked"].includes(t.status) && !tmWorktrees.some((w) => w.taskId === t.id));
  const subagents = events.filter((e) => e.event === "subagent_stop").slice(-12).reverse() as (typeof events[number] & { agent?: string; agent_type?: string; said?: string; tasks?: string[] })[];

  return (
    <div className="tm-screen tm-sessions">
      <ScreenHead title="Sessions" blurb={<>harness <span className="tm-id">{sessions.data?.harness ?? meta?.harness ?? "none detected"}</span> · claims expire after <span className="tm-id">{Math.round(ttl / 60_000)}m</span> without a live session</>}
        actions={<Button variant="danger" onClick={() => setSweep(true)} disabled={!claims.data?.stale.length}>Sweep expired claims{claims.data?.stale.length ? ` (${claims.data.stale.length})` : ""}</Button>} />

      <Loaded q={claims} rows={2}>
        {(c) => (
          <section className="tm-sessions__wip" aria-label="work in progress">
            <div className="tm-row">
              <span className="tm-caps">WIP</span>
              <span className="tm-id">{c.inProgress} / {c.wipLimit}</span>
              <span className="tm-grow" />
              <Loaded q={stale} rows={1}>{(s) => s.tasks.length ? <span className="tm-row"><Chip tone="warn" dot>{s.tasks.length} stale</Chip>{s.tasks.map((id) => <IdLink key={id} id={id} />)}</span> : <span className="tm-muted">nothing stale (after {s.minutes}m)</span>}</Loaded>
            </div>
            <Progress value={c.inProgress} max={c.wipLimit} label={`${c.inProgress} of ${c.wipLimit} in progress`} tone={c.inProgress < c.wipLimit ? "ok" : undefined} />
          </section>
        )}
      </Loaded>

      <section aria-labelledby="claims-h" className="tm-stack">
        <h2 id="claims-h">Claims <Chip kind="count">{rows.length}</Chip></h2>
        <Loaded q={claims} rows={3}>
          {() => <Table columns={cols} rows={rows} rowKey={(r) => r.id} caption="claims by session" empty={<EmptyState icon={<Radio size={28} />} title="No session holds a claim">A claim is taken by <code>tm start</code>, <code>tm claim</code> or a board transition. It carries the session, worktree and branch, and expires after {Math.round(ttl / 60_000)} minutes if the session vanishes.</EmptyState>} />}
        </Loaded>
      </section>

      <section aria-labelledby="wt-h" className="tm-stack">
        <div className="tm-row">
          <h2 id="wt-h">Worktrees <Chip kind="count">{tmWorktrees.length}</Chip></h2>
          <span className="tm-grow" />
          <Select aria-label="task for a new worktree" value={newWt} onChange={(e) => setNewWt(e.target.value)} placeholder="new worktree for…" options={candidates.map((t) => ({ value: t.id, label: `${t.id} ${t.title}` }))} />
          <Button disabled={!newWt} pending={pending} onClick={() => void run(() => write.worktree(newWt, "create"), { ok: `worktree for ${newWt} created` }).then(() => { setNewWt(""); worktrees.reload(); })}>Create</Button>
        </div>
        <Loaded q={worktrees} rows={2}>
          {() => tmWorktrees.length === 0 ? <p className="tm-muted">No task worktrees. <code>tm worktree new &lt;id&gt;</code> makes an isolated checkout with node_modules shared.</p> : (
            <ul className="tm-sessions__rows">
              {tmWorktrees.map((w) => (
                <li key={w.path} className="tm-sessions__row">
                  <div className="tm-sessions__main">
                    <span className="tm-id tm-truncate" title={w.path}>{w.path.replace(meta?.store.root ?? "", ".")}</span>
                    <span className="tm-muted tm-id">{w.branch ?? "no branch"} · <IdLink id={w.taskId!} /></span>
                  </div>
                  {w.dirty && <Chip tone="warn" dot>dirty</Chip>}
                  {(w.ahead ?? 0) > 0 && <Chip kind="count">{w.ahead} ahead</Chip>}
                  {!w.exists && <Chip tone="bad" dot>missing</Chip>}
                  <CopyButton text={() => fetchHandoff(w.taskId!).then((h) => h.text)} what="handoff" label="Copy handoff" />
                  <Button size="sm" variant="danger" onClick={() => { setRm(w); setForce(false); }}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </section>

      <section aria-labelledby="par-h" className="tm-stack">
        <div className="tm-row">
          <h2 id="par-h">Parallel batches</h2>
          <span className="tm-grow" />
          <Select aria-label="epic" value={epic} onChange={(e) => setQuery({ epic: e.target.value || null })} placeholder="every epic" options={(board?.epics ?? []).map((ep) => ({ value: ep.id, label: `${ep.id} ${ep.title}` }))} />
        </div>
        <p className="tm-muted">Unblocked, unclaimed tasks whose <code>touches</code> do not collide — each batch can run side by side, one worktree per task.</p>
        <Loaded q={parallel} rows={2}>
          {(p) => p.batches.length === 0 ? <p className="tm-muted">Nothing startable right now.</p> : (
            <ol className="tm-sessions__batches">
              {p.batches.map((b, i) => (
                <li key={i} className="tm-sessions__batch">
                  <div className="tm-row"><span className="tm-caps">batch {i + 1}</span><Chip kind="count">{b.tasks.length} tasks</Chip>{b.touches.length > 0 && <span className="tm-muted tm-id">{b.touches.length} paths</span>}</div>
                  <ul>
                    {(b.tasks as BatchTask[]).map((t) => (
                      <li key={tid(t)} className="tm-row">
                        <IdLink id={tid(t)} /> <span className="tm-truncate">{title(tid(t))}</span>
                        <span className="tm-grow" />
                        <CopyButton text={() => fetchHandoff(tid(t)).then((h) => h.text)} what="handoff" label="handoff" />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </Loaded>
      </section>

      {subagents.length > 0 && (
        <section aria-labelledby="sub-h" className="tm-stack">
          <h2 id="sub-h">Subagents <Chip kind="count">{subagents.length}</Chip></h2>
          <ul className="tm-sessions__rows">
            {subagents.map((e, i) => (
              <li key={i} className="tm-sessions__row">
                <div className="tm-sessions__main">
                  <span className="tm-row"><span className="tm-id">{short(e.agent, 10)}</span>{e.agent_type && <Chip kind="label">{e.agent_type}</Chip>}{(e.tasks ?? []).map((t) => <IdLink key={t} id={t} />)}<span className="tm-muted tm-id">{ago(e.ts, now)}</span></span>
                  {e.said && <span className="tm-muted tm-sessions__said">“{e.said}”</span>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal open={sweep} onClose={() => setSweep(false)} title="Sweep expired claims"
        footer={<><Button onClick={() => setSweep(false)}>Cancel</Button><Button variant="danger" pending={pending} onClick={() => void run(() => write.sweep(), { ok: "expired claims released" }).then(() => { setSweep(false); claims.reload(); })}>Release {claims.data?.stale.length ?? 0}</Button></>}>
        <p>Releases every claim whose session is gone or older than {Math.round(ttl / 60_000)} minutes: {claims.data?.stale.map((id) => <IdLink key={id} id={id} />).reduce<React.ReactNode[]>((a, b, i) => (i ? [...a, ", ", b] : [b]), [])}. The tasks keep their status; only the lock goes. Logged as <code>claims_swept</code>.</p>
      </Modal>
      <Modal open={Boolean(rm)} onClose={() => setRm(null)} title={`Remove worktree for ${rm?.taskId ?? ""}`}
        footer={<><Button onClick={() => setRm(null)}>Cancel</Button><Button variant="danger" pending={pending} onClick={() => rm && void run(() => write.worktree(rm.taskId!, "remove", force), { ok: `worktree for ${rm.taskId} removed` }).then(() => { setRm(null); worktrees.reload(); })}>Remove{force ? " (force)" : ""}</Button></>}>
        <p>Unlinks the shared node_modules and .env first, then removes <span className="tm-id">{rm?.path}</span>. {rm?.dirty ? "It has uncommitted changes: without force the server refuses." : "It is clean."}</p>
        <Checkbox checked={force} onChange={setForce}>force — discard uncommitted changes in this worktree</Checkbox>
      </Modal>
    </div>
  );
}
