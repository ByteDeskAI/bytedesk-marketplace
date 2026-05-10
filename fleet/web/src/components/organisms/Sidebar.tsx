// Sidebar — fleet brand + Views nav + sub-views + Projects list + user.
// Phase 2 placeholder: items are static; route wiring lands when the SPA
// gets a real router.

import { Icon, type IconName } from '../atoms/Icon';

interface NavItem { id: string; label: string; icon: IconName; }

const VIEWS: NavItem[] = [
  { id: 'overview',    label: 'Overview',    icon: 'overview' },
  { id: 'sessions',    label: 'Sessions',    icon: 'sessions' },
  { id: 'chains',      label: 'Chains',      icon: 'chains' },
  { id: 'tournaments', label: 'Tournaments', icon: 'tournaments' },
  { id: 'events',      label: 'Events',      icon: 'events' },
  { id: 'search',      label: 'Search',      icon: 'search' },
  { id: 'audit',       label: 'Audit',       icon: 'audit' },
  { id: 'settings',    label: 'Settings',    icon: 'settings' },
];

const SUBVIEWS = [
  'Active Work',
  'Waiting for Input',
  'Reviewers',
  'High Cost',
  'All Sessions',
];

const PROJECTS = ['acme-web', 'data-pipeline', 'mobile-app'];

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

      <div class="sidebar__section">
        <div class="sidebar__heading">Projects</div>
        <ul class="sidebar__nav">
          {PROJECTS.map((p, i) => (
            <li
              key={p}
              class={`sidebar__nav-item${i === 0 ? ' sidebar__nav-item--active' : ''}`}
            >
              {p}
            </li>
          ))}
        </ul>
      </div>

      <div class="sidebar__user">
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#cbd5e1' }} />
        <div>
          <div style={{ fontWeight: 600 }}>Alex Kim</div>
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>admin</div>
        </div>
      </div>
    </aside>
  );
}
