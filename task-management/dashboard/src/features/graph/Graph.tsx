import { GitFork } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { Dag } from "../../components/ui/Dag";
import { EmptyState } from "../../components/ui/EmptyState";
import { Menu } from "../../components/ui/Menu";
import { Modal } from "../../components/ui/Modal";
import { Select } from "../../components/ui/Field";
import { Toggle } from "../../components/ui/Toggle";
import { fetchGraph, fetchWhy, write } from "../../lib/api";
import { label } from "../../lib/keys.mjs";
import { navigate, setQuery, useLocation } from "../../lib/router";
import { useBoard, useEvents, useWrite } from "../../lib/store";
import type { GraphEdge } from "../../lib/types";
import { CopyButton, IdLink, Loaded, ScreenHead, useAsync } from "../ops/shared";
import "../../styles/graph.css";

/** Every simple cycle the edges close. Small graphs; DFS is plenty. ponytail: O(n·e). */
function findCycles(edges: GraphEdge[]): string[][] {
  const out = new Map<string, string[]>();
  for (const e of edges) if (e.type !== "subtask") out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const walk = (id: string, path: string[]) => {
    const i = path.indexOf(id);
    if (i >= 0) { const c = path.slice(i); const key = [...c].sort().join(); if (!seen.has(key)) { seen.add(key); cycles.push(c); } return; }
    for (const next of out.get(id) ?? []) walk(next, [...path, id]);
  };
  for (const id of out.keys()) walk(id, []);
  return cycles;
}

export default function Graph() {
  const { path, query } = useLocation();
  const board = useBoard();
  const events = useEvents();
  const epic = query.get("epic") ?? "";
  const all = query.get("all") === "1";
  const subtasks = query.get("subtasks") !== "0";
  const focus = query.get("focus");
  const [whyOpen, setWhyOpen] = useState(!!focus);
  // A dep/undep/done anywhere redraws; the feed already knows. Count writes, not rows.
  const writes = useMemo(() => events.filter((e) => ["dep", "undep", "done", "create", "reopened", "unblocked"].includes(e.event)).length, [events]);
  const g = useAsync(() => fetchGraph({ epic: epic || undefined, all, subtasks }), [epic, all, subtasks, writes]);
  const why = useAsync(() => (focus ? fetchWhy(focus) : Promise.resolve(null)), [focus, writes]);
  const { run, pending } = useWrite();
  const plate = useRef<HTMLDivElement>(null);
  const dialogActions = useRef<HTMLDivElement>(null);
  const restorePlateFocus = useRef(false);

  const cycles = useMemo(() => (g.data ? findCycles(g.data.edges) : []), [g.data]);
  const nodes = g.data?.nodes ?? [];
  const order = nodes.map((n) => n.id);
  const focused = focus && nodes.find((n) => n.id === focus) ? focus : null;

  // Selection does not open a modal: keyboard users can keep walking the graph.
  useEffect(() => {
    const el = plate.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (!order.length) return;
      const i = focused ? order.indexOf(focused) : -1;
      if (e.key === "j" || e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setQuery({ focus: order[(i + 1) % order.length] }); el.focus(); }
      if (e.key === "k" || e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setQuery({ focus: order[(i < 0 ? order.length - 1 : i - 1 + order.length) % order.length] }); el.focus(); }
      // Descendant buttons and SVG nodes own their Enter/Space activation.
      if (e.target !== el) return;
      if (e.key === " " && focused) { e.preventDefault(); setWhyOpen(true); }
      if (e.key === "Enter" && focused) { e.preventDefault(); navigate(`/tasks/${focused}`, { inspector: true }); }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [order.join(), focused]); // eslint-disable-line react-hooks/exhaustive-deps

  // The menu handles Escape in document capture. Cancel the dialog's default
  // Escape action as well, so the first press closes only the open menu.
  useEffect(() => {
    if (!whyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dialogActions.current?.querySelector('[role="menu"]')) e.preventDefault();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [whyOpen]);

  // Wait until Modal has closed the native dialog and removed the root's inert
  // state. Direct links have no prior graph focus for the browser to restore.
  useEffect(() => {
    if (whyOpen || path !== "/graph" || !restorePlateFocus.current) return;
    restorePlateFocus.current = false;
    const frame = requestAnimationFrame(() => plate.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [whyOpen, path]);

  const closeWhy = () => {
    if (!whyOpen) return; // Ignore the native close notification after our state change.
    restorePlateFocus.current = path === "/graph";
    setWhyOpen(false);
  };

  const showWhy = (id: string) => {
    plate.current?.focus();
    setQuery({ focus: id });
    setWhyOpen(true);
  };

  const edgesOf = (id: string) => (g.data?.edges ?? []).filter((e) => e.from === id || e.to === id);
  const removeDep = (e: GraphEdge) => run(() => write.dep(e.to, { remove: [e.from] }), { ok: `${e.to} no longer blocked by ${e.from}` }).then(() => g.reload());

  return (
    <div className="tm-screen tm-graph">
      <ScreenHead title="Graph" blurb="Blockers sit left of what they block; a red outline is a cycle."
        actions={<>
          <Select aria-label="epic" value={epic} onChange={(e) => setQuery({ epic: e.target.value || null, focus: null })} placeholder="every epic"
            options={(board?.epics ?? []).map((ep) => ({ value: ep.id, label: `${ep.id} ${ep.title}` }))} />
          <Toggle checked={all} onChange={(v) => setQuery({ all: v ? "1" : null })}>include done</Toggle>
          <Toggle checked={subtasks} onChange={(v) => setQuery({ subtasks: v ? null : "0" })}>subtasks</Toggle>
          {g.data && <CopyButton text={g.data.mermaid} what="Mermaid" label="Copy Mermaid" />}
        </>} />
      <Loaded q={g} rows={6}>
        {(data) => data.edges.length === 0 ? (
          <EmptyState icon={<GitFork size={28} />} title="No dependencies drawn">
            Nothing here blocks anything else. Add an edge with <code>tm dep &lt;id&gt; &lt;blocker&gt;</code> or from a task's Blocked-by section{all ? "" : ", or include done work"}.
          </EmptyState>
        ) : (
          <div className="tm-graph__layout">
            <div className="tm-graph__plate" ref={plate} tabIndex={0} role="application" aria-label={`dependency graph: ${data.nodes.length} tasks, ${data.edges.length} edges. j and k walk tasks, Enter opens a task, Space shows why.`}>
              <div className="tm-row tm-graph__counts">
                <Chip kind="count">{data.nodes.length} tasks</Chip>
                <Chip kind="count">{data.edges.length} edges</Chip>
                {cycles.length > 0 && <Chip tone="bad" dot>{cycles.length} cycle{cycles.length > 1 ? "s" : ""}</Chip>}
                {data.activeEpic && !epic && <Chip tone="accent">active {data.activeEpic}</Chip>}
                <Button size="sm" disabled={!focused} onClick={() => focused && showWhy(focused)}>Why</Button>
              </div>
              <div className="tm-graph__scroll">
                <Dag nodes={data.nodes} edges={data.edges} selected={focused} cycles={cycles} onSelect={showWhy} />
              </div>
              <ul className="tm-graph__edges" aria-label="edges">
                {data.edges.map((e, i) => (
                  <li key={i}><IdLink id={e.from} /> <span className="tm-muted">{e.type === "subtask" ? "parent of" : "blocks"}</span> <IdLink id={e.to} /></li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Loaded>
      <Modal open={whyOpen && !!focused} onClose={closeWhy} title={focused ?? undefined}
        footer={focused && <div className="tm-graph__dialog-actions" ref={dialogActions}>
          <span className="tm-grow" />
          <Menu label="edges" trigger={(p) => <Button size="sm" {...p}>Edges</Button>} items={edgesOf(focused).length ? edgesOf(focused).map((e) => ({
            label: e.type === "subtask" ? `${e.from} parent of ${e.to} (subtask)` : `remove: ${e.from} blocks ${e.to}`,
            disabled: e.type === "subtask" || pending,
            tone: "bad" as const,
            onSelect: () => void removeDep(e),
          })) : [{ label: "no edges on this task", onSelect: () => {}, disabled: true }]} />
          <Button size="sm" variant="primary" onClick={() => { restorePlateFocus.current = false; setWhyOpen(false); navigate(`/tasks/${focused}`, { inspector: true }); }}>Open</Button>
        </div>}>
        {focused && (
          <Loaded q={why} rows={3}>
            {(w) => w ? (
              <div className="tm-stack tm-graph__why">
                <div className="tm-row">
                  <Chip kind="status" value={w.status}>{label(w.status)}</Chip>
                  <Chip tone={w.startable ? "ok" : "warn"} dot>{w.startable ? "startable" : "not startable"}</Chip>
                </div>
                <strong>{w.title}</strong>
                {w.reasons.length > 0 && (
                  <ul className="tm-graph__reasons">
                    {w.reasons.map((r, i) => <li key={i} data-blocking={r.blocking || undefined}><span className="tm-caps">{r.kind}</span> {r.text}</li>)}
                  </ul>
                )}
                {w.chain.length > 0 && (
                  <ol className="tm-graph__chain" aria-label="blocker chain to the root">
                    {w.chain.map((c) => (
                      <li key={c.id} style={{ paddingLeft: `calc(${c.depth} * var(--tm-s5))` }}>
                        <Chip kind="status" value={c.status}>{label(c.status)}</Chip> <IdLink id={c.id} /> <span className="tm-truncate">{c.title}</span>
                        {c.reason && <div className="tm-muted tm-graph__reason">“{c.reason}”</div>}
                      </li>
                    ))}
                  </ol>
                )}
                {w.roots.length > 0 && <p className="tm-muted">start here: {w.roots.map((r) => <IdLink key={r} id={r} />).reduce<React.ReactNode[]>((a, b, i) => (i ? [...a, ", ", b] : [b]), [])}</p>}
                <pre className="tm-graph__text">{w.text}</pre>
              </div>
            ) : null}
          </Loaded>
        )}
      </Modal>
    </div>
  );
}
