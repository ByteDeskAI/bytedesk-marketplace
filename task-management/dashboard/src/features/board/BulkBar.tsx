import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Select, TextField } from "../../components/ui/Field";
import { write } from "../../lib/api";
import { COLUMNS, label } from "../../lib/keys.mjs";
import { useBoard, useWrite } from "../../lib/store";
import { toast } from "../../lib/toast";
import type { Status } from "../../lib/types";
import { PRIORITIES } from "./model";

/**
 * One op across the selection through `POST /api/bulk`; partial success is reported per id.
 * Assign and label are inline fields — the old board asked with window.prompt.
 */
export function BulkBar({ ids, onClear, onStop }: { ids: string[]; onClear: () => void; onStop: (ids: string[], status: Status) => void }) {
  const board = useBoard();
  const { run, pending } = useWrite();
  const [who, setWho] = useState("");
  const [lbl, setLbl] = useState("");
  const sprint = board?.state?.activeSprint ?? null;
  if (!ids.length) return null;

  const bulk = (op: string, args: Record<string, unknown>, what: string) =>
    run(async () => {
      const r = await write.bulk(ids, op, args);
      if (r.failed.length) toast("warn", `${what}: ${r.ok.length} of ${ids.length} applied`, r.failed.map((f) => `${f.id}: ${f.error}`).join("\n"));
      else toast("ok", `${what}: ${r.ok.length} card${r.ok.length === 1 ? "" : "s"}`);
      return r;
    });

  return (
    <div className="tm-bulk" role="region" aria-label="bulk actions">
      <strong className="tm-bulk__count">{ids.length} selected</strong>
      <Select
        aria-label="move selection to"
        placeholder="move to…"
        value=""
        options={COLUMNS.map((s) => ({ value: s, label: label(s) }))}
        onChange={(e) => {
          const status = e.target.value as Status;
          if (!status) return;
          if (status === "blocked" || status === "parked") onStop(ids, status);
          else void bulk("transition", { status }, `→ ${label(status)}`);
        }}
      />
      <Select aria-label="set priority" placeholder="priority…" value="" options={PRIORITIES.map((p) => ({ value: p, label: p }))} onChange={(e) => e.target.value && void bulk("priority", { priority: e.target.value }, `priority ${e.target.value}`)} />
      <form className="tm-row" onSubmit={(e) => { e.preventDefault(); if (who.trim()) void bulk("assign", { assignee: who.trim() }, `assigned to ${who.trim()}`).then(() => setWho("")); }}>
        <TextField aria-label="assign to" placeholder="assign to…" value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 140 }} />
        <Button size="sm" type="submit" disabled={!who.trim()}>Assign</Button>
      </form>
      <form className="tm-row" onSubmit={(e) => { e.preventDefault(); const v = lbl.trim(); if (!v) return; const remove = v.startsWith("-"); void bulk("labels", remove ? { remove: [v.slice(1)] } : { add: [v] }, `${remove ? "unlabelled" : "labelled"} ${v.replace(/^-/, "")}`).then(() => setLbl("")); }}>
        <TextField aria-label="label (leading - removes)" placeholder="label… (-label removes)" value={lbl} onChange={(e) => setLbl(e.target.value)} style={{ width: 170 }} mono />
        <Button size="sm" type="submit" disabled={!lbl.trim()}>Label</Button>
      </form>
      {sprint && <Button size="sm" onClick={() => void bulk("sprint", { sprint }, `committed to ${sprint}`)}>This sprint</Button>}
      <Button size="sm" onClick={() => void bulk("sprint", { sprint: null }, "uncommitted")}>Uncommit</Button>
      <span className="tm-grow" />
      <Button size="sm" variant="ghost" onClick={onClear} pending={pending}>Clear</Button>
    </div>
  );
}
