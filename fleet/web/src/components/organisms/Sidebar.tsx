// Sidebar — fleet brand + Views nav + sub-views + user.
// The multi-project list was removed (each dashboard is per-project; you
// only ever see the project you're inside).

import { Icon, type IconName } from '../atoms/Icon';
import { NotifyPill } from '../molecules/NotifyPill';

interface NavItem { id: string; label: string; icon: IconName; href?: string; }

const VIEWS: NavItem[] = [
  { id: 'overview',    label: 'Overview',    icon: 'overview',    href: '/' },
  { id: 'grid',        label: 'Grid',        icon: 'sessions',    href: '/grid' },
  { id: 'timeline',    label: 'Timeline',    icon: 'events',      href: '/timeline' },
  { id: 'chains',      label: 'Chains',      icon: 'chains',      href: '/chains' },
  { id: 'tournaments', label: 'Tournaments', icon: 'tournaments', href: '/tournaments' },
  { id: 'audit',       label: 'Audit',       icon: 'audit',       href: '/audit' },
  { id: 'search',      label: 'Search',      icon: 'search',      href: '/search' },
  { id: 'rules',       label: 'Rules',       icon: 'audit',       href: '/rules' },
  { id: 'settings',    label: 'Settings',    icon: 'settings',    href: '/settings' },
];

const SUBVIEWS = [
  'Active Work',
  'Waiting for Input',
  'Reviewers',
  'High Cost',
  'All Sessions',
];

export interface SidebarProps {
  activeView?: string;
}

export function Sidebar({ activeView = 'overview' }: SidebarProps) {
  return (
    <aside class="app-shell__sidebar">
      <div class="sidebar__brand">
        <span class="sidebar__brand-mark" aria-hidden="true" />
        fleet
      </div>

      <nav class="sidebar__section" aria-label="Primary views">
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
            >
              <Icon name={v.icon} />
              {v.label}
            </li>
          ))}
        </ul>
      </nav>

      <div class="sidebar__section">
        <div class="sidebar__heading">Views</div>
        <ul class="sidebar__nav">
          {SUBVIEWS.map((s) => (
            <li key={s} class="sidebar__nav-item">{s}</li>
          ))}
        </ul>
      </div>

      {/* Multi-project list removed — each dashboard is per-project; you
          only see the project you're inside. Currently active project
          info still surfaces on the Settings page. */}

      <div class="sidebar__user">
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#cbd5e1' }} />
        <div>
          <div style={{ fontWeight: 600 }}>You</div>
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>local</div>
        </div>
        <span style={{ flex: 1 }} />
        <NotifyPill />
      </div>
    </aside>
  );
}

