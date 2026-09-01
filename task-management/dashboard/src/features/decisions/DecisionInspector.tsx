import { useState } from "react";
import type { ScreenProps } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { Combobox } from "../../components/ui/Combobox";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { InlineEdit } from "../../components/ui/InlineEdit";
import { Inspector, Section } from "../../components/ui/Inspector";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { write } from "../../lib/api";
import { closeInspector, Link } from "../../lib/router";
import { useBoard, useEntity, useWrite } from "../../lib/store";
import type { Adr } from "../../lib/types";
import { MarkdownEdit } from "../task/sections/MarkdownEdit";
import { adrTone, CreateAdr } from "./Decisions";
import "../../styles/decisions.css";
import "../../styles/detail.css";

/** One ADR: accept while proposed, supersede any time, edit title/body/deciders in place. */
export default function DecisionInspector({ params }: ScreenProps) {
  const id = params.id;
  const { entity, detail, loading, error } = useEntity<Adr>(id);
  const board = useBoard();
  const { run, pending } = useWrite();
  const [superseding, setSuperseding] = useState(false);
  const close = () => closeInspector("/decisions");
  if (error || (!entity && !loading)) {
    return (
      <Inspector title={id} onClose={close} id={id}>
        <ErrorPanel title={`${id} is not on this board`} detail={error} />
      </Inspector>
    );
  }
  if (!entity) return <Inspector title={id} onClose={close} id={id}><SkeletonRows /></Inspector>;
  const adr = entity;
  const status = adr.status || "proposed";
  const body = detail?.body ?? "";
  const successor = (board?.adrs ?? []).find((a) => a.supersedes === adr.id);
  const related = (board?.tasks ?? []).filter((t) => (t.links ?? []).some((l) => l.id === adr.id));
  const deciders = adr.deciders ?? [];
  return (
    <Inspector
      id={adr.id}
      onClose={close}
      meta={
        <div className="tm-row" style={{ flexWrap: "wrap", gap: "var(--tm-s2)" }}>
          <span className="tm-id" style={{ color: "var(--tm-ink)" }}>{adr.id}</span>
          <Chip kind="plain" tone={adrTone(status)} dot>{status}</Chip>
          {adr.epic && <Link to={`/epics/${adr.epic}`} inspector className="tm-chip" data-kind="plain">{adr.epic}</Link>}
          {adr.supersedes && <Link to={`/decisions/${adr.supersedes}`} inspector className="tm-chip" data-kind="plain">supersedes {adr.supersedes}</Link>}
          {successor && <Link to={`/decisions/${successor.id}`} inspector className="tm-chip" data-kind="plain">superseded by {successor.id}</Link>}
          {adr.date && <span className="tm-faint mono">{adr.date}</span>}
        </div>
      }
      actions={
        <>
          {status === "proposed" && <Button size="sm" variant="primary" pending={pending} onClick={() => void run(() => write.acceptAdr(adr.id), { ok: `${adr.id} accepted` })}>Accept</Button>}
          {status !== "superseded" && <Button size="sm" onClick={() => setSuperseding(true)}>Supersede…</Button>}
        </>
      }
      title={<InlineEdit value={adr.title} label={`title of ${adr.id}`} placeholder="Title" onSave={(v) => { if (v) void run(() => write.editAdr(adr.id, { title: v }), { optimistic: { id: adr.id, patch: { title: v } } }); }} />}
    >
      <Section title="deciders">
        <Combobox values={deciders} options={[]} creatable label={`deciders of ${adr.id}`} placeholder="add a name…" chipKind="plain" onChange={(next) => void run(() => write.editAdr(adr.id, { deciders: next }), { optimistic: { id: adr.id, patch: { deciders: next } } })} />
      </Section>
      <Section title="record">
        <MarkdownEdit key={`${adr.id}-${detail ? "full" : "pending"}`} value={body} loading={!detail} label={`body of ${adr.id}`} placeholder="Context / Decision / Consequences (markdown)" onSave={(v) => run(() => write.editAdr(adr.id, { body: v }))} />
      </Section>
      {related.length > 0 && (
        <Section title="referenced by">
          <ul className="tm-links">
            {related.map((t) => (
              <li key={t.id} className="tm-links__row"><Link to={`/tasks/${t.id}`} inspector className="mono">{t.id}</Link><span className="tm-truncate">{t.title}</span></li>
            ))}
          </ul>
        </Section>
      )}
      <CreateAdr open={superseding} onClose={() => setSuperseding(false)} supersedes={adr.id} />
    </Inspector>
  );
}
