import { Bookmark, ChevronDown, Filter, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { Field, Select, TextField } from "../../components/ui/Field";
import { Menu } from "../../components/ui/Menu";
import { Modal } from "../../components/ui/Modal";
import { Toggle } from "../../components/ui/Toggle";
import { write } from "../../lib/api";
import { FIELD_NAMES, formatQuery, isActive, labelOptions, loadViews, mergeViews, options, parseQuery, pushViews, saveViews, type SavedViews } from "../../lib/filters";
import { useBoard, useMeta, useWrite } from "../../lib/store";
import { EMPTY, PRIORITIES, useIsPhone, type Filters } from "./model";

export interface ToolbarProps {
  filters: Filters;
  setFilters: (f: Filters) => void;
  grouped?: boolean;
  setGrouped?: (on: boolean) => void;
  onCreateTask: () => void;
  onCreateEpic: () => void;
}

/**
 * Filters read and write the URL (`?q=` in tm find syntax), so a filtered board is a link.
 * Saved views live in the repo's config with localStorage as the first-paint cache.
 */
export function Toolbar({ filters, setFilters, grouped, setGrouped, onCreateTask, onCreateEpic }: ToolbarProps) {
  const board = useBoard();
  const meta = useMeta();
  const { run } = useWrite();
  const phone = useIsPhone();
  const tasks = board?.tasks ?? [];
  const activeEpic = board?.state?.activeEpic ?? null;
  const activeSprint = board?.state?.activeSprint ?? null;
  const [views, setViews] = useState<SavedViews>(() => loadViews());
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  // One filter language: the query box speaks tm find syntax and the pickers below only write
  // into it. The draft follows the URL so a chip removal or a saved view shows up in the box.
  const fields = meta?.vocab.findFields ?? FIELD_NAMES;
  const [draft, setDraft] = useState(() => formatQuery(filters));
  const applied = formatQuery(filters);
  useEffect(() => setDraft(applied), [applied]);
  const apply = () => { if (draft.trim() !== applied) setFilters(parseQuery(draft.trim(), fields)); };
  useEffect(() => {
    setViews((local) => {
      const merged = mergeViews(local, board?.settings?.views);
      saveViews(merged);
      return merged;
    });
  }, [board?.settings?.views]);

  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const chips = useMemo(() => {
    const out: { key: keyof Filters; text: string }[] = [];
    for (const k of Object.keys(filters) as (keyof Filters)[]) {
      const v = filters[k];
      if (!v) continue;
      out.push({ key: k, text: k === "text" ? `“${v}”` : `${k}:${v}` });
    }
    return out;
  }, [filters]);

  const saveView = () => {
    const next = { ...views, [name.trim()]: filters };
    setViews(next);
    saveViews(next);
    void pushViews(next);
    setSaving(false);
  };
  const dropView = (n: string) => {
    const next = { ...views };
    delete next[n];
    setViews(next);
    saveViews(next);
    void pushViews(next);
  };

  const sel = (key: "epic" | "assignee" | "actor" | "priority" | "type" | "label", label: string, opts: string[]) => (
    <Select aria-label={`filter by ${label}`} placeholder={label} value={filters[key] ?? ""} options={opts.map((v) => ({ value: v, label: key === "epic" ? `${v} ${board?.epics.find((e) => e.id === v)?.title ?? ""}`.trim() : v }))} onChange={(e) => set({ [key]: e.target.value || null })} className="tm-toolbar__select" />
  );

  return (
    <div className="tm-toolbar" role="toolbar" aria-label="board controls">
      <div className="tm-toolbar__row">
        <Select
          aria-label="active epic"
          placeholder="no active epic"
          value={activeEpic ?? ""}
          options={(board?.epics ?? []).filter((e) => e.status !== "done" || e.id === activeEpic).map((e) => ({ value: e.id, label: `${e.id} ${e.title}`, disabled: e.status === "done" }))}
          onChange={(e) => void run(() => write.activeEpic(e.target.value || null), { ok: e.target.value ? `${e.target.value} is the active epic` : "active epic cleared" })}
          className="tm-toolbar__epic"
          title="the epic tm task new files under"
        />
        {activeSprint && (
          <Chip tone={filters.sprint === activeSprint ? "accent" : undefined} dot={false} onClick={() => set({ sprint: filters.sprint === activeSprint ? null : activeSprint })} aria-pressed={filters.sprint === activeSprint}>
            this sprint
          </Chip>
        )}
        <Menu
          label="saved views"
          trigger={(p) => (
            <Button size="sm" variant="ghost" {...p}><Bookmark size={14} /> views <ChevronDown size={12} /></Button>
          )}
          items={[
            ...Object.keys(views).sort().map((n) => ({ label: n, onSelect: () => setFilters({ ...EMPTY, ...views[n] }) })),
            ...(Object.keys(views).length ? ["sep" as const] : []),
            { label: "Save current view…", onSelect: () => { setName(""); setSaving(true); }, disabled: !isActive(filters) },
          ]}
        />
        {setGrouped && (
          <Toggle checked={Boolean(grouped)} onChange={(on) => { setGrouped(on); void write.settings({ grouped: on }); }}>by epic</Toggle>
        )}
        <span className="tm-grow" />
        <Button size="sm" onClick={onCreateEpic}>New epic</Button>
        <Button size="sm" variant="primary" onClick={onCreateTask}><Plus size={14} /> New task</Button>
      </div>
      <div className="tm-toolbar__row">
        <TextField
          type="search"
          mono
          className="tm-toolbar__query"
          aria-label="filter query in tm find syntax"
          placeholder={phone ? "status:open label:ui …" : "filter — status:open assignee:ryan -label:stale, or words"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={apply}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } if (e.key === "Escape") { e.stopPropagation(); setDraft(applied); } }}
          leading={<Search size={13} aria-hidden />}
        />
      </div>
      <details className="tm-toolbar__filters">
        <summary className="tm-toolbar__summary"><Filter size={13} aria-hidden /> filters{chips.length ? <span className="tm-id"> · {chips.length}</span> : null}</summary>
        <div className="tm-toolbar__row">
          {sel("epic", "epic", options(tasks, "epic"))}
          {sel("assignee", "assignee", options(tasks, "assignee"))}
          {sel("actor", "actor", options(tasks, "actor"))}
          {sel("priority", "priority", meta?.vocab.priorities ?? [...PRIORITIES])}
          {sel("type", "type", meta?.vocab.types ?? options(tasks, "type"))}
          {sel("label", "label", labelOptions(tasks, board?.labelCatalog ?? []))}
        </div>
      </details>
      {chips.length > 0 && (
        <div className="tm-toolbar__chips" aria-label="active filters">
          {chips.map((c) => (
            <Chip key={c.key} kind={c.key === "text" ? "plain" : "label"} onRemove={() => set({ [c.key]: c.key === "text" ? "" : null })}>{c.text}</Chip>
          ))}
          <button type="button" className="tm-toolbar__clear" onClick={() => setFilters(EMPTY)}><X size={12} aria-hidden /> clear</button>
        </div>
      )}
      <Modal open={saving} onClose={() => setSaving(false)} title="Save view" footer={<><Button variant="ghost" onClick={() => setSaving(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={saveView}>Save</Button></>}>
        <form className="tm-stack" onSubmit={(e) => { e.preventDefault(); if (name.trim()) saveView(); }}>
          <Field label="name" hint="saved in the repo's config, so it follows the project">{(p) => <TextField {...p} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
          {Object.keys(views).length > 0 && (
            <div className="tm-stack" style={{ gap: "var(--tm-s2)" }}>
              <span className="tm-caps">existing</span>
              {Object.keys(views).sort().map((n) => (
                <div key={n} className="tm-row"><span className="tm-grow">{n}</span><Button size="sm" variant="ghost" onClick={() => dropView(n)} aria-label={`delete view ${n}`}>delete</Button></div>
              ))}
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
}
