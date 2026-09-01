import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Field, TextArea, TextField } from "../../components/ui/Field";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { fetchTemplate, fetchTemplates, write } from "../../lib/api";
import { useWrite } from "../../lib/store";
import type { TemplateSummary } from "../../lib/types";

// Mirrors safeName() in lib/templates.mjs so a bad name is refused before the round trip.
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const nameError = (n: string) => (!n ? "required" : !SAFE.test(n) || n.includes("..") ? "letters, digits, . _ - only; no .." : null);

type Draft = { name: string; isNew: boolean; description: string; fields: string; body: string };

/** Task starters under templates/ — list, read, create, edit. `description` is the one reserved key. */
export function TemplatesSection() {
  const { run, pending } = useWrite();
  const [list, setList] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  const reload = () => fetchTemplates().then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void reload(); }, []);

  const edit = (name: string) =>
    fetchTemplate(name)
      .then((t) => {
        const { description, ...rest } = t.fields ?? {};
        setDraft({ name, isNew: false, description: String(description ?? ""), fields: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "", body: t.body });
      })
      .catch((e: Error) => setError(e.message));

  const parseFields = (s: string): Record<string, unknown> | null => {
    if (!s.trim()) return {};
    try {
      const v = JSON.parse(s);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* fall through */ }
    return null;
  };

  const save = () => {
    if (!draft) return;
    const fields = parseFields(draft.fields);
    if (!fields) { setFieldsError("fields must be a JSON object"); return; }
    setFieldsError(null);
    const payload = { description: draft.description || undefined, fields, body: draft.body };
    void run(async () => {
      if (draft.isNew) await write.createTemplate({ name: draft.name, ...payload });
      else await write.editTemplate(draft.name, payload);
      setDraft(null);
      await reload();
    }, { ok: `template ${draft.name} saved`, reconcile: false });
  };

  const nErr = draft?.isNew ? nameError(draft.name) : null;

  return (
    <section className="tm-settings__group" id="templates" aria-labelledby="h-templates">
      <header>
        <h2 id="h-templates">Templates</h2>
        <p>Starters for <code>tm task new --template &lt;name&gt;</code> and the New task modal. Frontmatter fields land on the task; the body is its opening text.</p>
      </header>
      {error && <ErrorPanel title="Templates could not be read" detail={error} action={<Button size="sm" onClick={() => { setError(null); void reload(); }}>Retry</Button>} />}
      {!list && !error && <SkeletonRows rows={3} />}
      {list && (
        <div className="tm-settings__row">
          <div>
            <strong>{list.length} template{list.length === 1 ? "" : "s"}</strong>
            {list.length === 0 && <p className="tm-faint">None yet. <code>tm template seed</code> writes the starters; or create one here.</p>}
          </div>
          <div className="tm-templates" role="list">
            {list.map((t) => (
              <div key={t.name} className="tm-templates__row" role="listitem">
                <span className="tm-id">{t.name}</span>
                <span className="tm-faint tm-grow">{t.description}</span>
                <Button size="sm" variant="ghost" onClick={() => void edit(t.name)}>Edit</Button>
              </div>
            ))}
            <div className="tm-row">
              <Button size="sm" onClick={() => setDraft({ name: "", isNew: true, description: "", fields: "", body: "## Problem\n\n## Proposal\n" })}>New template</Button>
            </div>
          </div>
        </div>
      )}
      {draft && (
        <div className="tm-settings__row tm-templates__editor" data-dirty>
          <div>
            <strong>{draft.isNew ? "New template" : `Edit ${draft.name}`}</strong>
            <p className="tm-faint">Saved to <span className="tm-id">templates/{draft.name || "<name>"}.md</span> in the store.</p>
          </div>
          <div className="tm-stack">
            {draft.isNew && (
              <Field label="Name" error={nErr}>{(p) => <TextField {...p} mono value={draft.name} placeholder="bug" onChange={(e) => setDraft({ ...draft, name: e.target.value.trim() })} />}</Field>
            )}
            <Field label="Description">{(p) => <TextField {...p} value={draft.description} placeholder="what this starter is for" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />}</Field>
            <Field label="Fields (JSON object)" hint='e.g. {"type":"bug","priority":"high","labels":["needs-triage"]}' error={fieldsError}>
              {(p) => <TextArea {...p} mono rows={3} value={draft.fields} onChange={(e) => setDraft({ ...draft, fields: e.target.value })} />}
            </Field>
            <Field label="Body">{(p) => <TextArea {...p} mono rows={8} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />}</Field>
            <div className="tm-row">
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              <Button variant="primary" pending={pending} disabled={Boolean(nErr)} onClick={save}>Save template</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
