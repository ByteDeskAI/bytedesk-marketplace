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
import { loadSettings, saveSettings, type FleetSettings } from '../../api';
import { useTheme, type ThemeName, type FontName } from '../../hooks/useTheme';

const THEME_OPTIONS: { id: ThemeName; label: string }[] = [
  { id: 'light',        label: 'Light' },
  { id: 'dark',         label: 'Dark' },
  { id: 'repllt-blue',  label: 'Repllt Blue' },
];

const ACCENTS = ['#2563eb', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#0f172a'];

const FONT_OPTIONS: { id: FontName; label: string }[] = [
  { id: 'inter',          label: 'Inter (default)' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono' },
  { id: 'system',         label: 'System' },
];

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
      {err ? <div style={{ color: 'var(--color-state-error)', marginBottom: 12 }}>{err}</div> : null}
      {!s ? (
        <div style={{ color: 'var(--color-text-tertiary)' }}>Loading settings…</div>
      ) : (
        <div class="settings">
          <Section title="Mobile push (B15)">
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
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
              <CodeBlock>
                {`curl -d "fleet event" ${s.mobile.ntfy_url.replace(/\/$/, '')}/${s.mobile.topic}`}
              </CodeBlock>
            ) : null}
          </Section>

          <Section title="Theme (C7)">
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
              Live preview — changes apply to this browser immediately. Saving persists them
              to the project's <code>settings.toml</code>.
            </p>
            <Field label="Theme">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
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
            </Field>
            <Field label="Accent color">
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ACCENTS.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    aria-label={hex}
                    onClick={() => setTheme({ ...theme, accent: hex })}
                    style={{
                      width: 24, height: 24, borderRadius: 6, border: '2px solid',
                      borderColor: theme.accent === hex ? 'var(--color-text-primary)' : 'var(--color-border)',
                      background: hex, cursor: 'pointer',
                    }}
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
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
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
              <CodeBlock>
                {s.tailscale.funnel
                  ? `tailscale funnel --bg ${window.location.origin}`
                  : `tailscale serve --bg ${window.location.origin}`}
              </CodeBlock>
            ) : null}
          </Section>

          <div class="modal__actions" style={{ justifyContent: 'flex-start' }}>
            <Button variant="primary" onClick={persist} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {savedAt ? (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-state-done)' }}>Saved.</span>
            ) : null}
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

function CodeBlock({ children }: { children: preact.ComponentChildren }) {
  return (
    <pre style={{
      background: '#0b0e14',
      color: '#d4d4d4',
      padding: 'var(--space-3)',
      borderRadius: 'var(--radius-md)',
      fontSize: 'var(--text-xs)',
      fontFamily: 'var(--font-mono)',
      overflow: 'auto',
      margin: 'var(--space-2) 0 0',
    }}>{children}</pre>
  );
}
