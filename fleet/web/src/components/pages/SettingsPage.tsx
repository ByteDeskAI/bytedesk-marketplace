// SettingsPage — Phase 10 (BDM-26). Two sections wired today:
//
//   - Mobile push (B15): ntfy URL/topic/kinds. The notify daemon
//     already supports a webhook sink; this page just stores config.
//   - Tailscale share (B17): toggle bit + suggested CLI snippet so the
//     user can `tailscale serve` / `tailscale funnel` the dashboard.
//
// Theme section is stubbed; Phase 11 will fill in the live preview.

import { useEffect, useState } from 'preact/hooks';
import { AppShell } from '../templates/AppShell';
import { Button } from '../atoms/Button';
import {
  loadSettings, saveSettings,
  tailscaleStart, tailscaleStop,
  tailscaleInfo, tailscaleExec, tailscaleLogURL,
  fetchStorageInfo,
  type FleetSettings, type TailscaleInfo, type StorageInfo,
} from '../../api';
import { useTheme, type ThemeName, type FontName } from '../../hooks/useTheme';

const THEME_OPTIONS: { id: ThemeName; label: string }[] = [
  { id: 'operator',  label: 'Operator' },
  { id: 'day',       label: 'Operator Day' },
];

const ACCENTS = ['#ff9e3d', '#38bdf8', '#4ade80', '#fbbf24', '#ef4444', '#c084fc', '#fb923c', '#e6e8eb'];

const FONT_OPTIONS: { id: FontName; label: string }[] = [
  { id: 'inter',          label: 'IBM Plex Sans (default)' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono' },
  { id: 'system',         label: 'System' },
];

// Inline-paragraph styling used inside .settings__rows. Matches the
// mono editorial voice of the surrounding chrome.
const HELP_STYLE: preact.JSX.CSSProperties = {
  margin: 0,
  padding: 'var(--space-2)',
  background: 'var(--color-bg-app)',
  borderLeft: '2px solid var(--color-accent)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-secondary)',
  lineHeight: 'var(--leading-base)',
};

export function SettingsPage() {
  const [s, setS] = useState<FleetSettings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    loadSettings().then(setS).catch((e) => setErr((e as Error).message));
  }, []);

  async function persist() {
    if (!s) return;
    setSaving(true);
    setErr(null);
    try {
      // Mirror the live theme state into the server-persisted settings
      // so a different browser sees the same defaults next load.
      const merged: FleetSettings = {
        ...s,
        theme: { theme: theme.theme, accent: theme.accent, font: theme.font },
      };
      const next = await saveSettings(merged);
      setS(next);
      setSavedAt(Date.now());
      window.setTimeout(() => setSavedAt(null), 2500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell activeView="settings" topBarTitle="Settings">
      {err ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginBottom: 'var(--space-3)',
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
        }}>
          <span class="tape tape--err">ERROR</span>
          <span style={{ color: 'var(--color-state-error)' }}>{err}</span>
        </div>
      ) : null}
      {!s ? (
        <div class="empty-state">
          <span class="empty-state__icon">◌</span>
          Loading settings…
        </div>
      ) : (
        <div class="settings">
          <Section title="Mobile push (B15)">
            <p style={HELP_STYLE}>
              Routes selected event kinds to an <code>ntfy</code> topic. The notify daemon already
              supports webhook sinks; this page persists the config.
            </p>
            <Field label="Enabled">
              <input
                type="checkbox"
                checked={s.mobile.enabled}
                onChange={(e) => setS({ ...s, mobile: { ...s.mobile, enabled: (e.currentTarget as HTMLInputElement).checked } })}
              />
            </Field>
            <Field label="ntfy URL">
              <input
                class="settings__input"
                type="url"
                value={s.mobile.ntfy_url}
                placeholder="https://ntfy.sh"
                onInput={(e) => setS({ ...s, mobile: { ...s.mobile, ntfy_url: (e.currentTarget as HTMLInputElement).value } })}
              />
            </Field>
            <Field label="Topic">
              <input
                class="settings__input"
                type="text"
                placeholder="fleet-alerts-abc123"
                value={s.mobile.topic}
                onInput={(e) => setS({ ...s, mobile: { ...s.mobile, topic: (e.currentTarget as HTMLInputElement).value } })}
              />
            </Field>
            <Field label="API key (optional)">
              <input
                class="settings__input"
                type="password"
                placeholder="leave blank for public ntfy.sh; paid tier needs Bearer token"
                value={s.mobile.api_key ?? ''}
                onInput={(e) => setS({ ...s, mobile: { ...s.mobile, api_key: (e.currentTarget as HTMLInputElement).value } })}
              />
            </Field>
            <Field label="Event kinds">
              <KindsChecklist
                selected={s.mobile.kinds}
                onChange={(next) => setS({ ...s, mobile: { ...s.mobile, kinds: next } })}
              />
            </Field>
            {s.mobile.enabled && s.mobile.topic ? (
              <pre class="code-block">
                {`curl -d "fleet event" ${s.mobile.ntfy_url.replace(/\/$/, '')}/${s.mobile.topic}`}
              </pre>
            ) : null}
          </Section>

          <Section title="Theme (C7)">
            <p style={HELP_STYLE}>
              Live preview — changes apply to this browser immediately. Saving persists them
              to the project's <code>settings.toml</code>.
            </p>
            <Field label="Theme">
              <div style={{ display: 'flex', gap: 0 }}>
                <div class="filter-chips">
                  {THEME_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      class={`filter-chip${theme.theme === opt.id ? ' filter-chip--active' : ''}`}
                      onClick={() => setTheme({ ...theme, theme: opt.id })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </Field>
            <Field label="Accent color">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ACCENTS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={`Accent ${hex}`}
                    aria-pressed={theme.accent === hex}
                    class={`settings__swatch${theme.accent === hex ? ' settings__swatch--active' : ''}`}
                    onClick={() => setTheme({ ...theme, accent: hex })}
                    style={{ background: hex }}
                  />
                ))}
              </div>
            </Field>
            <Field label="Font">
              <select
                class="settings__input"
                value={theme.font}
                onChange={(e) => setTheme({ ...theme, font: (e.currentTarget as HTMLSelectElement).value as FontName })}
              >
                {FONT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
            </Field>
          </Section>

          <TailscaleSection settings={s} setS={setS} setErr={setErr} />

          <StorageSection />

          <Section title="Jira (A15 / B7)">
            <p style={HELP_STYLE}>
              Used by SpawnModal's <strong>From Jira</strong> + <strong>From Backlog</strong> tabs.
              Leave the API token blank to use the <code>JIRA_API_TOKEN</code> env var instead.
            </p>
            <Field label="Base URL">
              <input
                class="settings__input"
                type="url"
                placeholder="https://acme.atlassian.net"
                value={s.jira?.base_url ?? ''}
                onInput={(e) => setS({ ...s, jira: { ...(s.jira ?? { base_url: '', email: '', api_token: '', jql: '' }), base_url: (e.currentTarget as HTMLInputElement).value } })}
              />
            </Field>
            <Field label="Email">
              <input
                class="settings__input"
                type="email"
                placeholder="you@example.com"
                value={s.jira?.email ?? ''}
                onInput={(e) => setS({ ...s, jira: { ...(s.jira ?? { base_url: '', email: '', api_token: '', jql: '' }), email: (e.currentTarget as HTMLInputElement).value } })}
              />
            </Field>
            <Field label="API token (optional)">
              <input
                class="settings__input"
                type="password"
                placeholder="leave blank to use $JIRA_API_TOKEN"
                value={s.jira?.api_token ?? ''}
                onInput={(e) => setS({ ...s, jira: { ...(s.jira ?? { base_url: '', email: '', api_token: '', jql: '' }), api_token: (e.currentTarget as HTMLInputElement).value } })}
              />
            </Field>
            <Field label="Default JQL">
              <input
                class="settings__input"
                type="text"
                placeholder="statusCategory != Done ORDER BY priority DESC"
                value={s.jira?.jql ?? ''}
                onInput={(e) => setS({ ...s, jira: { ...(s.jira ?? { base_url: '', email: '', api_token: '', jql: '' }), jql: (e.currentTarget as HTMLInputElement).value } })}
              />
            </Field>
          </Section>

          <Section title="AI / Haiku (B10 / B11 / B12)">
            <p style={HELP_STYLE}>
              Routes state-confidence + drift + cost-estimate through real Haiku via
              the <code>@anthropic-ai/claude-agent-sdk</code> Node sidecar. Falls back
              to the heuristic when the API key env var is empty.
            </p>
            <Field label="Enabled">
              <input
                type="checkbox"
                checked={s.ai?.enabled ?? false}
                onChange={(e) => setS({ ...s, ai: { ...(s.ai ?? { enabled: false, model: 'claude-haiku-4-5-20251001', key_env: 'ANTHROPIC_API_KEY' }), enabled: (e.currentTarget as HTMLInputElement).checked } })}
              />
            </Field>
            <Field label="Model">
              <input
                class="settings__input"
                type="text"
                placeholder="claude-haiku-4-5-20251001"
                value={s.ai?.model ?? ''}
                onInput={(e) => setS({ ...s, ai: { ...(s.ai ?? { enabled: false, model: '', key_env: 'ANTHROPIC_API_KEY' }), model: (e.currentTarget as HTMLInputElement).value } })}
              />
            </Field>
            <Field label="Key env var">
              <input
                class="settings__input"
                type="text"
                placeholder="ANTHROPIC_API_KEY"
                value={s.ai?.key_env ?? ''}
                onInput={(e) => setS({ ...s, ai: { ...(s.ai ?? { enabled: false, model: '', key_env: '' }), key_env: (e.currentTarget as HTMLInputElement).value } })}
              />
            </Field>
          </Section>

          <div class="modal__actions" style={{ justifyContent: 'flex-start' }}>
            <Button variant="primary" onClick={persist} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {savedAt ? <span class="tape tape--ok">SAVED</span> : null}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class="settings__section">
      <h2 class="settings__section-title">{title}</h2>
      <div class="settings__rows">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <label class="settings__field">
      <span class="settings__label">{label}</span>
      <span class="settings__control">{children}</span>
    </label>
  );
}

// ── ntfy kinds checklist (BDM-46) ────────────────────────────────────
// Replaces the freeform comma-string with a fixed set of checkboxes
// covering every event kind the notify daemon emits. The wire shape
// stays the same (comma-joined string) so settings.toml + daemon
// don't need to change.
const NTFY_KINDS: { id: string; label: string; desc: string }[] = [
  { id: 'merge',           label: 'merge',           desc: 'PR merged' },
  { id: 'pr_opened',       label: 'pr_opened',       desc: 'PR created' },
  { id: 'pr_link',         label: 'pr_link',         desc: 'PR URL emitted' },
  { id: 'review_summary',  label: 'review_summary',  desc: 'reviewer agent posted summary' },
  { id: 'review_comment',  label: 'review_comment',  desc: 'inline PR comment' },
  { id: 'commit_pushed',   label: 'commit_pushed',   desc: 'git push landed' },
  { id: 'session_done',    label: 'session_done',    desc: 'agent reached terminal state' },
  { id: 'session_error',   label: 'session_error',   desc: 'agent surfaced an error' },
  { id: 'tournament_done', label: 'tournament_done', desc: 'all variants reached terminal state' },
];
function KindsChecklist({ selected, onChange }: { selected: string; onChange: (next: string) => void }) {
  const set = new Set(selected.split(',').map((s) => s.trim()).filter(Boolean));
  const toggle = (id: string) => {
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onChange([...set].join(','));
  };
  return (
    <div class="settings__kinds">
      {NTFY_KINDS.map((k) => (
        <label key={k.id} class="settings__kind">
          <input type="checkbox" checked={set.has(k.id)} onChange={() => toggle(k.id)} />
          <span class="settings__kind-id">{k.label}</span>
          <span class="settings__kind-desc">{k.desc}</span>
        </label>
      ))}
    </div>
  );
}

// ── Tailscale automation (BDM-46) ────────────────────────────────────
function TailscaleSection({
  settings, setS, setErr,
}: {
  settings: FleetSettings;
  setS: (s: FleetSettings) => void;
  setErr: (e: string | null) => void;
}) {
  const [info, setInfo] = useState<TailscaleInfo | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [cli, setCli] = useState('status');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      const r = await tailscaleInfo();
      setInfo(r);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, 5000);
    return () => window.clearInterval(id);
  }, []);

  // Live log stream.
  useEffect(() => {
    const es = new EventSource(tailscaleLogURL());
    es.addEventListener('log', (ev) => {
      try {
        const line = JSON.parse((ev as MessageEvent).data) as string;
        setLogLines((prev) => {
          const next = [...prev, line];
          if (next.length > 200) next.splice(0, next.length - 200);
          return next;
        });
      } catch { /* ignore */ }
    });
    return () => es.close();
  }, []);

  const runCli = async () => {
    const args = cli.trim().split(/\s+/).filter(Boolean);
    if (args.length === 0) return;
    setBusy(true);
    try {
      const r = await tailscaleExec(args);
      setLogLines((prev) => [...prev, `$ tailscale ${args.join(' ')}`, ...(r.stdout || '').split('\n').filter(Boolean)]);
      if (r.error) setErr(r.error);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <Section title="Tailscale automation (B17 / BDM-46)">
      <p style={HELP_STYLE}>
        Real-time status + CLI passthrough. Auto-install is intentionally not
        wired (requires <code>sudo</code>) — install the CLI from{' '}
        <a href="https://tailscale.com/download" target="_blank" rel="noopener noreferrer">tailscale.com/download</a>{' '}
        and this panel takes over.
      </p>
      <div class="settings__ts-status">
        <span class={`tape ${info?.installed ? 'tape--ok' : 'tape--warn'}`}>
          CLI {info?.installed ? 'installed' : 'missing'}
        </span>
        <span class={`tape ${info?.daemon_running ? 'tape--ok' : 'tape--warn'}`}>
          daemon {info?.daemon_running ? 'running' : 'down'}
        </span>
        <span class={`tape ${info?.logged_in ? 'tape--ok' : 'tape--warn'}`}>
          {info?.logged_in ? 'logged in' : 'logged out'}
        </span>
        {info?.version ? <span class="settings__ts-version">{info.version}</span> : null}
        {info?.hostname ? <span class="settings__ts-host">{info.hostname}</span> : null}
        {info?.ip ? <span class="settings__ts-ip">{info.ip}</span> : null}
      </div>

      <Field label="Enabled (informational)">
        <input
          type="checkbox"
          checked={settings.tailscale.enabled}
          onChange={(e) => setS({ ...settings, tailscale: { ...settings.tailscale, enabled: (e.currentTarget as HTMLInputElement).checked } })}
        />
      </Field>
      <Field label="Funnel (public)">
        <input
          type="checkbox"
          checked={settings.tailscale.funnel}
          onChange={(e) => setS({ ...settings, tailscale: { ...settings.tailscale, funnel: (e.currentTarget as HTMLInputElement).checked } })}
        />
      </Field>

      <Field label="Share / unshare">
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button
            disabled={!info?.installed || busy}
            title={!info?.installed ? 'Install tailscale CLI first' : undefined}
            onClick={async () => {
              try { const r = await tailscaleStart(settings.tailscale.funnel); setErr(r.error ?? null); refresh(); }
              catch (e) { setErr((e as Error).message); }
            }}
          >Start share</Button>
          <Button
            disabled={!info?.installed || busy}
            title={!info?.installed ? 'Install tailscale CLI first' : undefined}
            onClick={async () => {
              try { await tailscaleStop(); setErr(null); refresh(); }
              catch (e) { setErr((e as Error).message); }
            }}
          >Stop share</Button>
        </div>
      </Field>

      {info?.serve_url ? (
        <Field label="Active share">
          <a class="settings__ts-link" href={info.serve_url} target="_blank" rel="noopener noreferrer">{info.serve_url}</a>
        </Field>
      ) : null}

      <Field label="CLI">
        <form
          style={{ display: 'flex', gap: 'var(--space-2)', flex: 1 }}
          onSubmit={(e) => { e.preventDefault(); void runCli(); }}
        >
          <span class="settings__ts-prompt">tailscale</span>
          <input
            class="settings__input"
            type="text"
            value={cli}
            onInput={(e) => setCli((e.currentTarget as HTMLInputElement).value)}
            disabled={!info?.installed || busy}
            title={!info?.installed ? 'Install tailscale CLI first' : undefined}
            placeholder="status / ip / netcheck / serve --bg / …"
          />
          <Button
            onClick={runCli}
            disabled={!info?.installed || busy}
            title={!info?.installed ? 'Install tailscale CLI first' : undefined}
          >{busy ? '…' : 'Run'}</Button>
        </form>
      </Field>

      <Field label="Live log + CLI output">
        <pre class="settings__ts-console">
          {logLines.length === 0 ? '(waiting for tailscale status output…)' : logLines.join('\n')}
        </pre>
      </Field>
    </Section>
  );
}

// ── Storage diagnostics (BDM-47) ─────────────────────────────────────
function StorageSection() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetchStorageInfo().then(setInfo).catch((e) => setErr((e as Error).message));
  }, []);
  if (err) return (
    <Section title="Storage">
      <p style={{ color: 'var(--color-state-error)' }}>{err}</p>
    </Section>
  );
  if (!info) return (
    <Section title="Storage">
      <p style={HELP_STYLE}>Loading…</p>
    </Section>
  );
  const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
  const Row = ({ k, v, exists }: { k: string; v: string; exists?: boolean }) => (
    <div class="settings__storage-row">
      <span class="settings__storage-key">{k}</span>
      <code class="settings__storage-val">{v}</code>
      {exists != null ? <span class={`tape ${exists ? 'tape--ok' : 'tape--warn'}`}>{exists ? 'exists' : 'missing'}</span> : null}
    </div>
  );
  return (
    <Section title="Storage">
      <p style={HELP_STYLE}>{info.persistent_note}</p>
      <Row k="project_key"   v={info.project_key} />
      <Row k="canonical_dir" v={info.canonical_dir} />
      <Row k="data_root"     v={info.data_root}     exists={info.exists.data_root} />
      <Row k="project_dir"   v={info.project_dir}   exists={info.exists.project_dir} />
      <Row k="web_dir"       v={info.web_dir}       exists={info.exists.web_dir} />
      <Row k="settings.toml" v={`${info.settings_path} · ${fmtSize(info.sizes_bytes.settings_path || 0)}`} exists={info.exists.settings_path} />
      <Row k="sessions/"     v={`${info.sessions_dir} · ${fmtSize(info.sizes_bytes.sessions_dir || 0)}`}   exists={info.exists.sessions_dir} />
      <Row k="chains/"       v={`${info.chains_dir} · ${fmtSize(info.sizes_bytes.chains_dir || 0)}`}       exists={info.exists.chains_dir} />
      <Row k="rules/"        v={`${info.rules_dir} · ${fmtSize(info.sizes_bytes.rules_dir || 0)}`}         exists={info.exists.rules_dir} />
    </Section>
  );
}
