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
import { loadSettings, saveSettings, tailscaleStart, tailscaleStop, type FleetSettings } from '../../api';
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
            <Field label="Kinds (comma-separated)">
              <input
                class="settings__input"
                type="text"
                placeholder="merge,pr_opened,review_summary"
                value={s.mobile.kinds}
                onInput={(e) => setS({ ...s, mobile: { ...s.mobile, kinds: (e.currentTarget as HTMLInputElement).value } })}
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

          <Section title="Tailscale share (B17)">
            <p style={HELP_STYLE}>
              Expose this dashboard over your tailnet (or the public internet via funnel). The
              toggle is informational — you still run the <code>tailscale</code> CLI yourself.
            </p>
            <Field label="Enabled">
              <input
                type="checkbox"
                checked={s.tailscale.enabled}
                onChange={(e) => setS({ ...s, tailscale: { ...s.tailscale, enabled: (e.currentTarget as HTMLInputElement).checked } })}
              />
            </Field>
            <Field label="Use funnel (public)">
              <input
                type="checkbox"
                checked={s.tailscale.funnel}
                onChange={(e) => setS({ ...s, tailscale: { ...s.tailscale, funnel: (e.currentTarget as HTMLInputElement).checked } })}
              />
            </Field>
            {s.tailscale.enabled ? (
              <pre class="code-block">
                {s.tailscale.funnel
                  ? `tailscale funnel --bg ${window.location.origin}`
                  : `tailscale serve --bg ${window.location.origin}`}
              </pre>
            ) : null}
            <Field label="Run from server">
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <Button
                  onClick={async () => {
                    try { const r = await tailscaleStart(s.tailscale.funnel); setErr(r.error ?? null); }
                    catch (e) { setErr((e as Error).message); }
                  }}
                >Start</Button>
                <Button
                  onClick={async () => {
                    try { await tailscaleStop(); setErr(null); }
                    catch (e) { setErr((e as Error).message); }
                  }}
                >Stop</Button>
              </div>
            </Field>
          </Section>

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
