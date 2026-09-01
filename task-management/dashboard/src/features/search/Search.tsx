import { Search as SearchIcon, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { TextField } from "../../components/ui/Field";
import { Table, type Column } from "../../components/ui/Table";
import { Tabs } from "../../components/ui/Tabs";
import { find } from "../../lib/api";
import { FIELD_NAMES, formatQuery, loadViews, mergeViews, parseQuery, pushViews, saveViews, type SavedViews } from "../../lib/filters";
import { label } from "../../lib/keys.mjs";
import { navigate, setQuery, useLocation } from "../../lib/router";
import { routeForId } from "../../app/routes";
import { useBoard, useMeta } from "../../lib/store";
import type { FindHit, Kind } from "../../lib/types";
import { IdLink, ScreenHead, useAsync } from "../ops/shared";
import "../../styles/search.css";

const KINDS: (Kind | "all")[] = ["all", "task", "epic", "adr", "capability", "sprint"];

export default function Search() {
  const { query } = useLocation();
  const meta = useMeta();
  const board = useBoard();
  const q = query.get("q") ?? "";
  const kind = (query.get("kind") ?? "all") as Kind | "all";
  const [draft, setDraft] = useState(q);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(q), [q]);
  useEffect(() => { input.current?.focus(); }, []);
  const res = useAsync(() => (q.trim() ? find(q) : Promise.resolve(null)), [q]);
  const fields = meta?.vocab.findFields ?? [...FIELD_NAMES];
  const [views, setViews] = useState<SavedViews>(() => mergeViews(loadViews(), board?.settings?.views));
  useEffect(() => { if (board?.settings?.views) setViews((v) => mergeViews(v, board.settings?.views)); }, [board?.settings?.views]);
  const [naming, setNaming] = useState("");

  const submit = () => setQuery({ q: draft.trim() || null }, { replace: false });
  const insert = (field: string) => { const next = `${draft.trim()} ${field}:`.trim(); setDraft(next); input.current?.focus(); };
  const saveView = () => {
    if (!naming.trim() || !q.trim()) return;
    const next = { ...views, [naming.trim()]: parseQuery(q, fields) };
    setViews(next); saveViews(next); void pushViews(next); setNaming("");
  };
  const dropView = (name: string) => { const next = { ...views }; delete next[name]; setViews(next); saveViews(next); void pushViews(next); };

  const hits = (res.data?.hits ?? []).filter((h) => kind === "all" || h.kind === kind);
  const counts = KINDS.map((k) => ({ id: k, label: k, count: k === "all" ? res.data?.hits.length : res.data?.hits.filter((h) => h.kind === k).length }));
  const cols: Column<FindHit>[] = [
    { key: "id", header: "Id", cell: (h) => <IdLink id={h.id} />, width: "9ch" },
    { key: "kind", header: "Kind", cell: (h) => <span className="tm-muted">{h.kind}</span>, width: "10ch" },
    { key: "title", header: "Title", cell: (h) => h.title },
    { key: "status", header: "Status", cell: (h) => h.status ? <Chip kind="status" value={h.status}>{label(h.status)}</Chip> : null },
    { key: "epic", header: "Epic", cell: (h) => h.epic ? <IdLink id={h.epic} /> : null },
    { key: "labels", header: "Labels", cell: (h) => <span className="tm-row">{(h.labels ?? []).map((l) => <Chip key={l} kind="label">{l}</Chip>)}</span> },
  ];

  return (
    <div className="tm-screen tm-search">
      <ScreenHead title="Search" blurb={<>Words match titles and bodies; <code>field:value</code> narrows, <code>-</code> negates.</>} />
      <form className="tm-search__form" onSubmit={(e) => { e.preventDefault(); submit(); }} role="search">
        <TextField ref={input} type="search" name="q" mono value={draft} onChange={(e) => setDraft(e.target.value)} placeholder='status:open -label:stale "half remembered title"' aria-label="query" leading={<SearchIcon size={14} />} />
        <Button type="submit" variant="primary">Find</Button>
      </form>
      <div className="tm-row tm-search__fields" aria-label="fields">
        <span className="tm-caps">fields</span>
        {fields.map((f) => <Chip key={f} kind="label" onClick={() => insert(f)}>{f}:</Chip>)}
      </div>
      {Object.keys(views).length > 0 && (
        <div className="tm-row tm-search__views" aria-label="saved views">
          <span className="tm-caps">views</span>
          {Object.entries(views).map(([name, f]) => <Chip key={name} tone="accent" onClick={() => setQuery({ q: formatQuery(f) }, { replace: false })} onRemove={() => dropView(name)}>{name}</Chip>)}
        </div>
      )}
      {!q.trim() ? (
        <EmptyState icon={<SearchIcon size={28} />} title="Ask the board a question">Try <code>assignee:ryan -label:stale</code>, <code>epic:EP-002 type:bug</code>, or <code>-assignee:</code> for the unassigned queue.</EmptyState>
      ) : res.error ? (
        <ErrorPanel title="That query was refused" detail={res.error} />
      ) : !res.data ? null : (
        <>
          <div className="tm-row">
            <span className="tm-muted">{res.data.query}</span>
            <span className="tm-grow" />
            <TextField placeholder="save as…" value={naming} onChange={(e) => setNaming(e.target.value)} style={{ width: 160 }} aria-label="view name" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveView(); } }} />
            <Button size="sm" icon={<Save size={14} />} onClick={saveView} disabled={!naming.trim()}>Save view</Button>
          </div>
          <Tabs label="kind" tabs={counts} value={kind} onChange={(k) => setQuery({ kind: k === "all" ? null : k })} />
          {hits.length === 0 ? (
            <EmptyState icon={<SearchIcon size={28} />} title={`No hits for ${q}`}>Loosen a filter, or check the spelling of a value — an unknown <em>field</em> is refused, an unknown <em>value</em> simply matches nothing.</EmptyState>
          ) : (
            <Table columns={cols} rows={hits} rowKey={(h) => h.id} onRow={(h) => { const to = routeForId(h.id); if (to) navigate(to, { inspector: true }); }} caption={`${hits.length} results`} />
          )}
        </>
      )}
    </div>
  );
}
