// Sidebar — fleet brand, primary navigation, and per-user footer. Each
// nav item carries a monospace one-letter glyph and an optional hotkey
// hint. The visual treatment is intentionally Bloomberg-terminal: tight
// rows, mono labels, sharp 1px chrome.

import { Icon, type IconName } from '../atoms/Icon';
import { NotifyPill } from '../molecules/NotifyPill';

interface NavItem { id: string; label: string; icon: IconName; href?: string; glyph: string; hotkey?: string; }

const VIEWS: NavItem[] = [
  { id: 'overview',    label: 'Overview',    icon: 'overview',    href: '/',            glyph: '1', hotkey: 'gO' },
  { id: 'grid',        label: 'Grid',        icon: 'sessions',    href: '/grid',        glyph: '2', hotkey: 'gG' },
  { id: 'timeline',    label: 'Timeline',    icon: 'events',      href: '/timeline',    glyph: '3', hotkey: 'gT' },
  { id: 'chains',      label: 'Chains',      icon: 'chains',      href: '/chains',      glyph: '4', hotkey: 'gC' },
  { id: 'tournaments', label: 'Tournaments', icon: 'tournaments', href: '/tournaments', glyph: '5', hotkey: 'gN' },
  { id: 'audit',       label: 'Audit',       icon: 'audit',       href: '/audit',       glyph: '6', hotkey: 'gA' },
  { id: 'search',      label: 'Search',      icon: 'search',      href: '/search',      glyph: '7', hotkey: '/' },
  { id: 'rules',       label: 'Rules',       icon: 'audit',       href: '/rules',       glyph: '8', hotkey: 'gR' },
  { id: 'settings',    label: 'Settings',    icon: 'settings',    href: '/settings',    glyph: '9', hotkey: 'g,' },
];

const SUBVIEWS: { id: string; label: string; tape?: 'ok' | 'warn' | 'err' | 'accent' }[] = [
  { id: 'active',     label: 'Active Work',       tape: 'accent' },
  { id: 'waiting',    label: 'Waiting for Input', tape: 'warn' },
  { id: 'reviewers',  label: 'Reviewers' },
  { id: 'high-cost',  label: 'High Cost' },
  { id: 'all',        label: 'All Sessions' },
];

export interface SidebarProps {
  activeView?: string;
}

export function Sidebar({ activeView = 'overview' }: SidebarProps) {
  return (
    <aside class="app-shell__sidebar">
      <div class="sidebar__brand">
        <span class="sidebar__brand-mark" aria-hidden="true" />
        <span>fleet</span>
        <span class="sidebar__brand-tag">v1.13</span>
      </div>

      <nav class="sidebar__section" aria-label="Primary views">
        <div class="sidebar__heading">Views</div>
        <ul class="sidebar__nav">
          {VIEWS.map((v) => (
            <li
              key={v.id}
              class={`sidebar__nav-item${v.id === activeView ? ' sidebar__nav-item--active' : ''}`}
              onClick={() => {
                if (v.href) window.location.hash = v.href;
              }}
              role={v.href ? 'link' : undefined}
              style={{ cursor: v.href ? 'pointer' : 'default' }}
              title={v.hotkey ? `${v.label} (${v.hotkey})` : v.label}
            >
              <span class="sidebar__nav-icon">{v.glyph}</span>
              <span>{v.label}</span>
              {v.hotkey ? <span class="sidebar__nav-key">{v.hotkey}</span> : null}
            </li>
          ))}
        </ul>
      </nav>

      <div class="sidebar__section">
        <div class="sidebar__heading">Filters</div>
        <ul class="sidebar__nav">
          {SUBVIEWS.map((s) => (
            <li key={s.id} class="sidebar__nav-item">
              <span class="sidebar__nav-icon" style={{ opacity: 0.6 }}>·</span>
              <span>{s.label}</span>
              {s.tape ? <span class={`tape tape--${s.tape}`} style={{ marginLeft: 'auto' }}>•</span> : null}
            </li>
          ))}
        </ul>
      </div>

      <div class="sidebar__user">
        <span class="sidebar__user-dot" aria-hidden="true" />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>operator</span>
          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>local · 127.0.0.1</span>
        </div>
        <span style={{ flex: 1 }} />
        <NotifyPill />
        {/* Hidden Icon import to retain backward type ref (no visual). */}
        <span style={{ display: 'none' }}><Icon name="settings" size={1} /></span>
      </div>
    </aside>
  );
}
