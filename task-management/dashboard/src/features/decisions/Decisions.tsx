import { BookOpenCheck, Plus } from "lucide-react";
import { useState } from "react";
import type { ScreenProps } from "../../app/routes";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Field, TextArea, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { write } from "../../lib/api";
import { Link, navigate } from "../../lib/router";
import { useBoard, useLoading, useWrite } from "../../lib/store";
import type { Adr } from "../../lib/types";
import "../../styles/decisions.css";
import "../../styles/detail.css";

const ORDER = ["proposed", "accepted", "superseded"];
export const adrTone = (s: string) => (s === "accepted" ? "ok" : s === "proposed" ? "info" : undefined);

/** Architecture decisions, grouped by lifecycle. Create opens the inspector on the new record. */
export default function Decisions(_: ScreenProps) {
  const board = useBoard();
  const { error } = useLoading();
  const [creating, setCreating] = useState(false);
  const adrs = board?.adrs ?? [];
  const groups = ORDER.map((s) => ({ status: s, rows: adrs.filter((a) => (a.status || "proposed") === s) }));
  const other = adrs.filter((a) => !ORDER.includes(a.status || "proposed"));
  return (
    <div className="tm-screen">
      <div className="tm-screen__head">
        <div>
          <h1>Decisions</h1>
        </div>
        <div className="tm-screen__actions">
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>New decision</Button>
        </div>
      </div>
      {!board ? (
        error ? <ErrorPanel title="The board could not be loaded" detail={error} /> : <SkeletonRows rows={5} />
      ) : adrs.length === 0 ? (
        <EmptyState icon={<BookOpenCheck size={28} />} title="No decisions recorded" action={<Button onClick={() => setCreating(true)}>Write the first ADR</Button>}>
          A decision made in a multi-option question lands here on its own; the rest are written.
        </EmptyState>
      ) : (
        <div className="tm-adrs">
          {[...groups, ...(other.length ? [{ status: "other", rows: other }] : [])].map((g) =>
            g.rows.length ? (
              <section key={g.status} className="tm-adrs__group" aria-label={g.status}>
                <div className="tm-row"><span className="tm-caps">{g.status}</span><Chip kind="count">{g.rows.length}</Chip></div>
                <ul className="tm-adrs__list">
                  {g.rows.map((a) => <AdrRow key={a.id} adr={a} />)}
                </ul>
              </section>
            ) : null,
          )}
        </div>
      )}
      <CreateAdr open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function AdrRow({ adr }: { adr: Adr }) {
  return (
    <li>
      <Link to={`/decisions/${adr.id}`} inspector className="tm-adr">
        <span className="tm-id">{adr.id}</span>
        <span className="tm-adr__title">{adr.title}</span>
        <span className="tm-row" style={{ gap: "var(--tm-s2)", flexWrap: "wrap" }}>
          {adr.epic && <Chip kind="plain">{adr.epic}</Chip>}
          {adr.supersedes && <Chip kind="plain" title={`supersedes ${adr.supersedes}`}>⇐ {adr.supersedes}</Chip>}
          <Chip kind="plain" tone={adrTone(adr.status || "proposed")} dot>{adr.status || "proposed"}</Chip>
          {adr.date && <span className="tm-faint mono">{adr.date}</span>}
        </span>
      </Link>
    </li>
  );
}

export function CreateAdr({ open, onClose, supersedes }: { open: boolean; onClose: () => void; supersedes?: string }) {
  const { run, pending, error } = useWrite();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    const r = await run(() => (supersedes ? write.supersedeAdr(supersedes, { title: t, body: body || undefined }) : write.createAdr({ title: t, body: body || undefined })), { ok: supersedes ? `${supersedes} superseded` : "ADR recorded" });
    if (r?.id) {
      setTitle("");
      setBody("");
      onClose();
      navigate(`/decisions/${r.id}`, { inspector: "/decisions" });
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={supersedes ? `Supersede ${supersedes}` : "New decision"}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" pending={pending} disabled={!title.trim()} onClick={() => void submit()}>{supersedes ? "Supersede" : "Record"}</Button>
        </>
      }
    >
      <form className="tm-stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Title" error={error}>{(p) => <TextField {...p} autoFocus value={title} placeholder="Markdown is the source of truth" onChange={(e) => setTitle(e.target.value)} />}</Field>
        <Field label="Body" hint="Context, decision, consequences. Markdown. Empty gets the three-heading skeleton.">{(p) => <TextArea {...p} rows={8} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}
