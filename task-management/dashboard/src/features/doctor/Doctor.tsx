import { HeartPulse, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Checkbox } from "../../components/ui/Checkbox";
import { Chip } from "../../components/ui/Chip";
import { EmptyState } from "../../components/ui/EmptyState";
import { Modal } from "../../components/ui/Modal";
import { fetchDoctor, write } from "../../lib/api";
import { useEvents, useWrite } from "../../lib/store";
import type { Finding } from "../../lib/types";
import { IdLink, Loaded, ScreenHead, useAsync } from "../ops/shared";
import "../../styles/doctor.css";

function Group({ level, rows }: { level: Finding["level"]; rows: Finding[] }) {
  if (!rows.length) return null;
  return (
    <section className="tm-doctor__group" aria-labelledby={`dg-${level}`}>
      <h2 id={`dg-${level}`}>{level === "error" ? "Errors" : "Warnings"} <Chip kind="count">{rows.length}</Chip></h2>
      <ul className="tm-doctor__list">
        {rows.map((f, i) => (
          <li key={`${f.code}-${f.id}-${i}`} className="tm-doctor__finding" data-level={f.level}>
            <Chip tone={f.level === "error" ? "bad" : "warn"} dot>{f.level}</Chip>
            <div className="tm-doctor__main">
              <div className="tm-row"><code className="tm-doctor__code">{f.code}</code>{f.id && <IdLink id={f.id} />}</div>
              <p>{f.message}</p>
            </div>
            {f.fixable ? <Chip tone="ok">fixable</Chip> : <span className="tm-muted tm-doctor__judgement">a judgement — not auto-fixed</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Doctor() {
  const events = useEvents();
  const writes = events.length; // any write can create or clear a finding
  const q = useAsync(fetchDoctor, [writes]);
  const { run, pending } = useWrite();
  const [confirm, setConfirm] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [applied, setApplied] = useState<{ code: string; id?: string; did?: string; error?: string }[] | null>(null);
  const [showText, setShowText] = useState(false);

  const fix = async () => {
    const out = await run(() => write.doctorFix(), { ok: "Repairs applied" });
    setConfirm(false);
    setUnderstood(false);
    if (out) setApplied(out.applied);
    q.reload();
  };

  return (
    <div className="tm-screen tm-doctor">
      <ScreenHead title="Doctor" blurb="Errors make a read lie; warnings are untidy but correct."
        actions={<>
          <Button onClick={() => run(() => write.reindex(), { ok: "index.json rebuilt from the markdown" }).then(q.reload)} pending={pending}>Reindex</Button>
          {q.data && q.data.fixable > 0 && <Button variant="primary" onClick={() => setConfirm(true)}>Fix all unambiguous ({q.data.fixable})</Button>}
        </>} />
      <Loaded q={q} rows={4}>
        {(d) => (
          <>
            {d.findings.length === 0 ? (
              <EmptyState tone="ok" icon={<ShieldCheck size={28} />} title="Store is consistent">{d.text}. Every dependency, link, claim and epic points at something that exists.</EmptyState>
            ) : (
              <>
                <div className="tm-row tm-doctor__summary" role="status">
                  <HeartPulse size={16} />
                  <span><b className="tm-id">{d.errors}</b> error{d.errors === 1 ? "" : "s"}</span>·
                  <span><b className="tm-id">{d.warnings}</b> warning{d.warnings === 1 ? "" : "s"}</span>·
                  <span><b className="tm-id">{d.fixable}</b> fixable</span>
                  <span className="tm-grow" />
                  <Button size="sm" variant="ghost" onClick={() => setShowText((s) => !s)}>{showText ? "Hide" : "Show"} tm doctor output</Button>
                </div>
                {showText && <pre className="tm-doctor__text">{d.text}</pre>}
                <Group level="error" rows={d.findings.filter((f) => f.level === "error")} />
                <Group level="warning" rows={d.findings.filter((f) => f.level === "warning")} />
              </>
            )}
            {applied && (
              <section className="tm-doctor__applied" aria-label="what the last fix did">
                <h2>Last repair</h2>
                <ul>{applied.map((a, i) => <li key={i} data-error={a.error ? true : undefined}><code>{a.code}</code> {a.id && <IdLink id={a.id} />} {a.did ?? a.error}</li>)}</ul>
              </section>
            )}
          </>
        )}
      </Loaded>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Fix all unambiguous findings"
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="primary" disabled={!understood} pending={pending} onClick={() => void fix()}>Fix {q.data?.fixable ?? 0} finding{q.data?.fixable === 1 ? "" : "s"}</Button></>}>
        <p>This rewrites the markdown of every task named in a fixable finding and logs <code>doctor_fix</code>. It repeats until the store stops changing. Dependency cycles, <code>done-unmet</code> and duplicate ids are never touched — those are decisions, not typos.</p>
        <Checkbox checked={understood} onChange={setUnderstood}>I understand these files will be rewritten</Checkbox>
      </Modal>
    </div>
  );
}
