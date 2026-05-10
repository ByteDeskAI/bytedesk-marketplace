// Sidebar — fleet brand + Views nav + sub-views + Projects list + user.
// Phase 9 (BDM-25) wires the primary Views nav to the hash router so
// Audit + Sessions become reachable.

import { Icon, type IconName } from '../atoms/Icon';
import { useProjects } from '../../hooks/useProjects';

interface NavItem { id: string; label: string; icon: IconName; href?: string; }

const VIEWS: NavItem[] = [
  { id: 'overview',    label: 'Overview',    icon: 'overview',    href: '/' },
  { id: 'sessions',    label: 'Sessions',    icon: 'sessions',    href: '/' },
  { id: 'chains',      label: 'Chains',      icon: 'chains' },
  { id: 'tournaments', label: 'Tournaments', icon: 'tournaments' },
  { id: 'events',      label: 'Events',      icon: 'events',      href: '/audit' },
  { id: 'search',      label: 'Search',      icon: 'search' },
  { id: 'audit',       label: 'Audit',       icon: 'audit',       href: '/audit' },
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
  currentProjectKey?: string;
}

export function Sidebar({ activeView = 'overview', currentProjectKey }: SidebarProps) {
  const { data: projects } = useProjects();
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

      <div class="sidebar__section">
        <div class="sidebar__heading">Projects</div>
        <ul class="sidebar__nav">
          {(projects ?? []).map((p) => {
            const isActive = p.key === currentProjectKey;
            const label = shortKey(p.key);
            const item = (
              <>
                <span style={{ flex: 1 }}>{label}</span>
                {p.port ? (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>:{p.port}</span>
                ) : null}
              </>
            );
            const cls = `sidebar__nav-item${isActive ? ' sidebar__nav-item--active' : ''}`;
            return p.url && !isActive ? (
              <li key={p.key} class={cls}>
                <a href={p.url} style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  {item}
                </a>
              </li>
            ) : (
              <li key={p.key} class={cls}>
                {item}
              </li>
            );
          })}
          {projects && projects.length === 0 ? (
            <li class="sidebar__nav-item" style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
              No projects discovered
            </li>
          ) : null}
        </ul>
      </div>

      <div class="sidebar__user">
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#cbd5e1' }} />
        <div>
          <div style={{ fontWeight: 600 }}>You</div>
          <div style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>local</div>
        </div>
      </div>
    </aside>
  );
}

// shortKey trims the 12-char project key to "abc1…f456" so each row
// stays narrow.
function shortKey(key: string): string {
  if (key.length <= 8) return key;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
