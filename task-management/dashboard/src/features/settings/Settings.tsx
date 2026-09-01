import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Chip } from "../../components/ui/Chip";
import { ErrorPanel } from "../../components/ui/ErrorPanel";
import { Field, Select, TextArea, TextField } from "../../components/ui/Field";
import { Modal } from "../../components/ui/Modal";
import { SkeletonRows } from "../../components/ui/Skeleton";
import { Toggle } from "../../components/ui/Toggle";
import { fetchNtfy, fetchOverride, fetchSettings, write } from "../../lib/api";
import { useLocation } from "../../lib/router";
import { useMeta, useWrite } from "../../lib/store";
import { setTheme, useTheme, type Theme } from "../../lib/theme";
import type { NtfyInfo, SettingsField, SettingsSnapshot } from "../../lib/types";
import { usePwaShared } from "../../pwa/usePwa";
import { NotificationPrefs, OutboxList } from "../pwa/PwaPanel";
import { TemplatesSection } from "./Templates";
import type { ScreenProps } from "../../app/routes";
import "../../styles/settings.css";

/** The catalog's real shape: `options` are `{value,label}` and numbers carry bounds. */
type CatalogField = Omit<SettingsField, "options"> & { min?: number; max?: number; options?: { value: unknown; label: string }[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Client-side echo of lib/settings.mjs coerce(): the server still decides, this saves a round trip. */
function validate(f: CatalogField, v: unknown): string | null {
  if (f.type === "integer") {
    if (v === "" || v == null) return "required";
    const n = Number(v);
    if (!Number.isInteger(n)) return `${f.key} must be an integer`;
    if (f.min != null && n < f.min) return `${f.key} must be ≥ ${f.min}`;
    if (f.max != null && n > f.max) return `${f.key} must be ≤ ${f.max}`;
  }
  if (f.type === "json" && typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (parsed !== null && typeof parsed !== "object") return `${f.key} must be a JSON array or object`;
    } catch {
      return `${f.key} must be valid JSON`;
    }
  }
  return null;
}

/** What the server should receive for a draft value. */
function outgoing(f: CatalogField, v: unknown): unknown {
  if (f.type === "integer") return Number(v);
  if (f.type === "json") return typeof v === "string" ? (v.trim() ? JSON.parse(v) : null) : v;
  if (f.type === "enum") return f.options?.find((o) => String(o.value) === String(v))?.value ?? v;
  if (f.type === "string") return typeof v === "string" && !v.trim() ? null : v;
  return v;
}

function Control({ f, value, onChange, error }: { f: CatalogField; value: unknown; onChange: (v: unknown) => void; error: string | null }) {
  if (f.readOnly) return <span className="tm-id">{value == null || value === "" ? "—" : String(value)}</span>;
  if (f.type === "boolean") return <Toggle checked={Boolean(value)} onChange={onChange} />;
  if (f.type === "enum")
    return (
      <Select aria-label={f.label} value={String(value)} options={(f.options ?? []).map((o) => ({ value: String(o.value), label: o.label }))} onChange={(e) => onChange(e.target.value)} />
    );
  if (f.type === "json")
    return (
      <Field label={f.label} hint={f.help} error={error}>
        {(p) => <TextArea {...p} mono rows={3} value={typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2)} onChange={(e) => onChange(e.target.value)} />}
      </Field>
    );
  return (
    <TextField aria-label={f.label} aria-invalid={error ? true : undefined} type={f.type === "integer" ? "number" : "text"} mono={f.type === "integer" || /url|server|topic|prefix|dir/i.test(f.key)} value={value == null ? "" : String(value)} min={f.min} max={f.max} onChange={(e) => onChange(e.target.value)} />
  );
}

export default function Settings(_: ScreenProps) {
  const meta = useMeta();
  const pwa = usePwaShared();
  const theme = useTheme();
  const { hash } = location;
  const { path } = useLocation();
  const { run, pending } = useWrite();
  const [snap, setSnap] = useState<SettingsSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [ntfy, setNtfy] = useState<NtfyInfo | null>(null);
  const [override, setOverride] = useState<{ override: { reason: string; ts: string } | null; enforce: boolean } | null>(null);
  const [testEvent, setTestEvent] = useState("stop_gate_blocked");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [confirmOverride, setConfirmOverride] = useState(false);

  const reload = () => {
    fetchSettings().then((s) => { setSnap(s); setDraft({}); setServerErrors({}); }).catch((e: Error) => setLoadError(e.message));
    fetchNtfy().then(setNtfy).catch(() => {});
    fetchOverride().then(setOverride).catch(() => {});
  };
  useEffect(reload, []);
  // Deep links from the command bar: /settings#notifications, #identity, #outbox.
  useEffect(() => {
    const target = hash && document.getElementById(hash.slice(1));
    if (target && snap) target.scrollIntoView({ block: "start" });
  }, [hash, path, snap]);

  const fields = (snap?.fields ?? []) as CatalogField[];
  const byKey = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, f])), [fields]);
  const dirtyKeys = Object.keys(draft).filter((k) => byKey[k] && !same(draft[k], byKey[k].value) && !(byKey[k].type === "integer" && String(draft[k]) === String(byKey[k].value)));
  const errors: Record<string, string | null> = Object.fromEntries(dirtyKeys.map((k) => [k, serverErrors[k] ?? validate(byKey[k], draft[k])]));
  const invalid = dirtyKeys.some((k) => errors[k]);

  const save = () =>
    void run(async () => {
      const patch: Record<string, unknown> = {};
      for (const k of dirtyKeys) patch[k] = outgoing(byKey[k], draft[k]);
      try {
        const res = await write.settings(patch);
        if (res.ignored?.length) setServerErrors(Object.fromEntries(res.ignored.map((k) => [k, "not a writable setting"])));
        reload();
      } catch (err) {
        // The server names the key in its refusal ("wipLimit must be ≤ 99"); pin it to the field.
        const msg = err instanceof Error ? err.message : String(err);
        const key = dirtyKeys.find((k) => msg.includes(k));
        if (key) setServerErrors({ [key]: msg });
        throw err;
      }
    }, { ok: "settings saved to the repo's config.json", reconcile: true });

  if (loadError) return <div className="tm-screen"><ErrorPanel title="Settings could not be loaded" detail={loadError} action={<Button size="sm" onClick={reload}>Retry</Button>} /></div>;
  if (!snap) return <div className="tm-screen"><SkeletonRows rows={6} /></div>;

  const groups = snap.groups.filter((g) => g.id !== "identity");
  const identity = fields.filter((f) => f.group === "identity");
  // The catalog is flat: kind → { group, label, priority }.
  const eventKinds = Object.entries((ntfy?.catalog ?? {}) as Record<string, { group?: string; label?: string }>);
  const kindGroups = ["recommended", "writes", "noise"].map((g) => ({ g, kinds: eventKinds.filter(([, v]) => v.group === g) })).filter((x) => x.kinds.length);
  // ntfy.categories is the list `tm ntfy on <kind>` writes; the toggles edit the same array through the catalog.
  const catField = byKey["ntfy.categories"];
  const categories: string[] = (("ntfy.categories" in draft ? draft["ntfy.categories"] : catField?.value) as string[] | null) ?? [];
  const setCategories = (next: string[]) => { setDraft((d) => ({ ...d, "ntfy.categories": next })); setServerErrors(({ "ntfy.categories": _drop, ...rest }) => rest); };
  const toggleKind = (k: string, on: boolean) => setCategories(on ? [...new Set([...categories, k])] : categories.filter((x) => x !== k));
  const toc = [["appearance", "This browser"], ...groups.map((g) => [g.id, g.label]), ["templates", "Templates"], ["override", "Override"], ["identity-store", "Identity"]] as [string, string][];

  return (
    <div className="tm-screen tm-settings">
      <nav className="tm-settings__toc" aria-label="settings sections">
        {toc.map(([id, l]) => <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ block: "start" }); history.replaceState(history.state, "", `#${id}`); }}>{l}</a>)}
      </nav>
      <div className="tm-screen__head">
        <div>
          <h1>Settings</h1>
          <p>Project-scoped: every switch here writes to this repo's <code>config.json</code>, the same file the CLI, hooks and MCP read. Browser grants stay in this browser.</p>
        </div>
        <div className="tm-screen__actions" aria-live="polite">
          {dirtyKeys.length > 0 && <Chip tone="warn" dot>{dirtyKeys.length} unsaved</Chip>}
          <Button variant="ghost" disabled={!dirtyKeys.length} onClick={() => { setDraft({}); setServerErrors({}); }}>Reset</Button>
          <Button variant="primary" disabled={!dirtyKeys.length || invalid} pending={pending} onClick={save}>Save</Button>
        </div>
      </div>

      <section className="tm-settings__group" id="appearance" aria-labelledby="h-appearance">
        <header><h2 id="h-appearance">This browser</h2><p>Theme and notifications are browser grants; the repo cannot store them for you.</p></header>
        <div className="tm-settings__row">
          <div><strong>Theme</strong><p className="tm-faint">Dark is the family default; auto follows the OS.</p></div>
          <Select aria-label="theme" value={theme} options={[{ value: "auto", label: "Auto (OS)" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} onChange={(e) => setTheme(e.target.value as Theme)} />
        </div>
        <div className="tm-settings__row" id="notifications">
          <div><strong>Notifications</strong><p className="tm-faint">Asked on a click, never on load. Categories are stored in the repo; the grant is not.</p></div>
          {pwa ? <NotificationPrefs pwa={pwa} /> : <span className="tm-faint">…</span>}
        </div>
        <div className="tm-settings__row" id="outbox">
          <div><strong>Offline outbox</strong><p className="tm-faint">Writes made while the server was unreachable, replayed through the same gates.</p></div>
          {pwa ? <OutboxList pwa={pwa} /> : <span className="tm-faint">…</span>}
        </div>
      </section>

      {groups.map((g) => (
        <section key={g.id} className="tm-settings__group" id={g.id} aria-labelledby={`h-${g.id}`}>
          <header>
            <h2 id={`h-${g.id}`}>{g.label}</h2>
            {g.help && <p>{g.help}</p>}
            {g.id === "policy" && override && (
              <div className="tm-row">
                <Chip tone={override.enforce ? "ok" : "warn"} dot>{override.enforce ? "gates enforced" : "gates off (TM_ENFORCE=off or enforce=false)"}</Chip>
              </div>
            )}
            {g.id === "ntfy" && ntfy && (
              <div className="tm-row">
                <Chip tone={ntfy.hasToken ? "ok" : "warn"} dot>{ntfy.hasToken ? "TM_NTFY_TOKEN set" : "TM_NTFY_TOKEN unset"}</Chip>
                <Chip tone={snap.ntfy?.active ? "ok" : "plain" as never} dot>{snap.ntfy?.active ? "pushes active" : "pushes inactive"}</Chip>
              </div>
            )}
          </header>
          {fields.filter((f) => f.group === g.id && f.key !== "ntfy.categories").map((f) => {
            const v = f.key in draft ? draft[f.key] : f.value;
            const err = errors[f.key] ?? null;
            return (
              <div key={f.key} className="tm-settings__row" id={f.key === "board.me" ? "identity" : undefined} data-dirty={dirtyKeys.includes(f.key) || undefined}>
                <div>
                  <strong>{f.label}</strong>
                  <span className="tm-id"> {f.key}</span>
                  {dirtyKeys.includes(f.key) && <Chip tone="warn" dot>changed</Chip>}
                  {f.help && f.type !== "json" && <p className="tm-faint">{f.help}</p>}
                  {err && <p className="tm-field__error" role="alert">{err}</p>}
                </div>
                <Control f={f} value={v} onChange={(next) => { setDraft((d) => ({ ...d, [f.key]: next })); setServerErrors(({ [f.key]: _drop, ...rest }) => rest); }} error={err} />
              </div>
            );
          })}
          {g.id === "ntfy" && catField && (
            <div className="tm-settings__row" data-dirty={dirtyKeys.includes("ntfy.categories") || undefined}>
              <div>
                <strong>Event kinds pushed</strong>
                <span className="tm-id"> ntfy.categories</span>
                {dirtyKeys.includes("ntfy.categories") && <Chip tone="warn" dot>changed</Chip>}
                <p className="tm-faint">What <code>tm ntfy on &lt;kind&gt;</code> switches on. Nothing is pushed until a kind is on; recommended is the set worth a phone buzz.</p>
              </div>
              <div className="tm-kinds">
                {kindGroups.map(({ g: grp, kinds }) => (
                  <fieldset key={grp} className="tm-kinds__group">
                    <legend>
                      <span>{grp}</span>
                      <Button size="sm" variant="ghost" onClick={() => setCategories([...new Set([...categories, ...kinds.map(([k]) => k)])])}>all</Button>
                      <Button size="sm" variant="ghost" onClick={() => setCategories(categories.filter((k) => !kinds.some(([x]) => x === k)))}>none</Button>
                    </legend>
                    {kinds.map(([k, v]) => (
                      <label key={k} className="tm-kinds__row">
                        <Toggle checked={categories.includes(k)} onChange={(on) => toggleKind(k, on)} aria-label={k} />
                        <span className="tm-id">{k}</span>
                        <span className="tm-faint">{v.label}</span>
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            </div>
          )}
          {g.id === "ntfy" && (
            <div className="tm-settings__row">
              <div><strong>Test send</strong><p className="tm-faint">Sends one push for a chosen event kind. The answer is the server's own: sent, or the reason it declined.</p></div>
              <div className="tm-stack" style={{ gap: "var(--tm-s2)" }}>
                <div className="tm-row">
                  <Select aria-label="event kind" value={testEvent} options={(eventKinds.length ? eventKinds : [["stop_gate_blocked", {}]] as typeof eventKinds).map(([k, v]) => ({ value: k, label: v.group ? `${k} · ${v.group}` : k }))} onChange={(e) => setTestEvent(e.target.value)} />
                  <Button size="sm" pending={pending} onClick={() => void run(async () => {
                    const r = await write.ntfyTest(testEvent);
                    setTestResult(r.sent ? `sent${r.status ? ` (HTTP ${r.status})` : ""}` : `not sent — ${r.reason ?? r.error ?? "no reason given"}`);
                  }, { reconcile: false })}>Send test</Button>
                </div>
                {testResult && <span className="tm-id" aria-live="polite">{testResult}</span>}
              </div>
            </div>
          )}
        </section>
      ))}

      <TemplatesSection />

      <section className="tm-settings__group" id="override" aria-labelledby="h-override">
        <header>
          <h2 id="h-override">Override</h2>
          <p>Bypass exactly one gate, once, with the reason logged. The next gate on any surface — CLI, MCP or this board — spends it.</p>
        </header>
        <div className="tm-settings__row">
          <div>
            <strong>Standing override</strong>
            {override?.override ? <p className="tm-faint">“{override.override.reason}” · <span className="tm-id">{override.override.ts}</span></p> : <p className="tm-faint">none</p>}
          </div>
          <div className="tm-row">
            <TextField aria-label="override reason" value={reason} placeholder="why this gate should not apply once" onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" variant="danger" disabled={!reason.trim()} onClick={() => setConfirmOverride(true)}>Set override</Button>
          </div>
        </div>
      </section>

      <section className="tm-settings__group" id="identity-store" aria-labelledby="h-identity">
        <header><h2 id="h-identity">Identity</h2><p>Derived from git. Not editable here.</p></header>
        {identity.map((f) => (
          <div key={f.key} className="tm-settings__row"><div><strong>{f.label}</strong>{f.help && <p className="tm-faint">{f.help}</p>}</div><span className="tm-id">{f.value == null ? "—" : String(f.value)}</span></div>
        ))}
        <div className="tm-settings__row"><div><strong>Plugin</strong></div><span className="tm-id">{meta?.plugin.version ?? "…"}</span></div>
        <div className="tm-settings__row"><div><strong>Store</strong></div><span className="tm-id">{meta?.store.base ?? "…"}</span></div>
        <details className="tm-settings__config">
          <summary>config.json as the server reads it</summary>
          <pre>{JSON.stringify(meta?.config ?? {}, null, 2)}</pre>
        </details>
      </section>

      {dirtyKeys.length > 0 && (
        <div className="tm-settings__bar" role="region" aria-label="unsaved changes">
          <span>{dirtyKeys.length} unsaved change{dirtyKeys.length === 1 ? "" : "s"}</span>
          <span className="tm-grow" />
          <Button variant="ghost" onClick={() => { setDraft({}); setServerErrors({}); }}>Reset</Button>
          <Button variant="primary" disabled={invalid} pending={pending} onClick={save}>Save</Button>
        </div>
      )}

      <Modal open={confirmOverride} onClose={() => setConfirmOverride(false)} title="Set a one-shot override?" footer={<>
        <Button variant="ghost" onClick={() => setConfirmOverride(false)}>Cancel</Button>
        <Button variant="danger" pending={pending} onClick={() => void run(async () => {
          await write.override(reason.trim());
          setReason(""); setConfirmOverride(false);
          fetchOverride().then(setOverride).catch(() => {});
        }, { ok: "override set — the next gate will let one action through", reconcile: false })}>Set override</Button>
      </>}>
        <p>The very next gated action by anyone on this store passes without its check, and the event log records “{reason.trim()}” against it. Nothing else changes.</p>
      </Modal>
    </div>
  );
}
