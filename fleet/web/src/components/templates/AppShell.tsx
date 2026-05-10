// Three-region template: persistent sidebar, top bar, scrolling content,
// optional bottom status bar. The bottom bar carries always-visible mission-
// control telemetry (cost / events / guard) so operators never lose it.

import type { ComponentChildren } from 'preact';
import { Sidebar } from '../organisms/Sidebar';
import { TopBar } from '../organisms/TopBar';
import { VersionPill } from '../molecules/VersionPill';

export interface AppShellProps {
  activeView?: string;
  topBarTitle: string;
  onSpawnClick?: () => void;
  /** Optional banner slot rendered between TopBar and content (permission-mode banner). */
  banner?: ComponentChildren;
  /** Optional bottom status bar items (rendered in the always-visible statbar). */
  statBar?: ComponentChildren;
  children: ComponentChildren;
}

export function AppShell({ activeView, topBarTitle, onSpawnClick, banner, statBar, children }: AppShellProps) {
  return (
    <div class="app-shell">
      {/* Skip link for keyboard users (WCAG 2.4.1 / BDM-43). Hidden until focused;
       *  hash-routed so href="#main-content" doesn't navigate the SPA — the click
       *  handler focuses the target programmatically and prevents the default. */}
      <a
        href="#main-content"
        class="skip-link"
        onClick={(e) => {
          e.preventDefault();
          const t = document.getElementById('main-content');
          if (t) t.focus();
        }}
      >
        Skip to content
      </a>
      <Sidebar activeView={activeView} />
      <main class="app-shell__main">
        <TopBar title={topBarTitle} onSpawnClick={onSpawnClick} />
        {banner ?? null}
        <div class="app-shell__content" id="main-content" tabIndex={-1}>
          {children}
        </div>
        <DefaultStatBar override={statBar} />
      </main>
    </div>
  );
}

function DefaultStatBar({ override }: { override?: ComponentChildren }) {
  return (
    <div class="app-shell__statbar" role="status" aria-label="Fleet status">
      {override ?? (
        <>
          <span class="statbar-item">
            <span class="statbar-item__label">build</span>
            <span class="statbar-item__value"><VersionPill /></span>
          </span>
          <span class="statbar-item">
            <span class="statbar-item__label">guard</span>
            <span class="statbar-item__value" style={{ color: 'var(--color-state-done)' }}>● armed</span>
          </span>
          <span class="statbar-item">
            <span class="statbar-item__label">depth</span>
            <span class="statbar-item__value">0/2</span>
          </span>
          <span style={{ flex: 1 }} />
          <span class="statbar-item">
            <span class="statbar-item__label">conn</span>
            <span class="statbar-item__value" style={{ color: 'var(--color-state-done)' }}>sse · live</span>
          </span>
        </>
      )}
    </div>
  );
}
