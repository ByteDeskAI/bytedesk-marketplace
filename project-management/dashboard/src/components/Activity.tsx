/**
 * Activity feed — Atlaskit design system compliant.
 * All colors via var(--ds-*) tokens. Entries grouped by date.
 * Uses EmptyState for empty list. Card elevation for feed container.
 */
import Avatar from '@atlaskit/avatar';
import EmptyState from '@atlaskit/empty-state';
import Lozenge from '@atlaskit/lozenge';
import type { ActivityEntry } from '../types';
import { relTime } from '../api';

// ── Action metadata ───────────────────────────────────────────────────────────

const ACTION_META: Record<string, { color: string; icon: string; label: string }> = {
  'Create Issue':     { color: 'var(--ds-background-success-bold)',    icon: '+',  label: 'Created'  },
  'Update Issue':     { color: 'var(--ds-background-brand-bold)',      icon: '↑',  label: 'Updated'  },
  'Create Document':  { color: 'var(--ds-background-warning-bold)',    icon: 'D',  label: 'Doc'      },
  'Update Document':  { color: 'var(--ds-background-warning-bold)',    icon: 'D',  label: 'Doc'      },
  'Create Sprint':    { color: 'var(--ds-background-discovery-bold)',  icon: 'S',  label: 'Sprint'   },
  'Start Sprint':     { color: 'var(--ds-background-discovery-bold)',  icon: '▶',  label: 'Sprint'   },
  'Complete Sprint':  { color: 'var(--ds-background-success-bold)',    icon: '✓',  label: 'Sprint'   },
};
const DEFAULT_META = { color: 'var(--ds-background-neutral-bold)', icon: '·', label: 'Event' };

// ── Date grouping ─────────────────────────────────────────────────────────────

function groupKey(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

interface Props { activity: ActivityEntry[] }

export default function Activity({ activity }: Props) {
  // Group entries by date label
  const groups: Array<{ label: string; entries: ActivityEntry[] }> = [];
  for (const entry of activity) {
    const label = groupKey(entry.timestamp);
    const existing = groups.find(g => g.label === label);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.push({ label, entries: [entry] });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Page header */}
      <div style={{
        padding: '24px 32px 20px',
        flexShrink: 0,
        borderBottom: '1px solid var(--ds-border)',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--ds-text)', margin: '0 0 4px', lineHeight: 1.2 }}>
            Activity
          </h1>
          <p style={{ fontSize: 14, color: 'var(--ds-text-subtle)', margin: 0 }}>
            {activity.length > 0
              ? `${activity.length} event${activity.length !== 1 ? 's' : ''} — most recent first`
              : 'All project activity will appear here'}
          </p>
        </div>
      </div>

      {/* Feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 32px' }}>
        {activity.length === 0 ? (
          <EmptyState
            header="No activity yet"
            description="Issues, sprints, and document changes will appear here as your team works."
          />
        ) : (
          <div style={{ maxWidth: 680 }}>
            {groups.map(group => (
              <div key={group.label} style={{ marginBottom: 28 }}>
                {/* Date label */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 12,
                }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'var(--ds-text-subtlest)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    whiteSpace: 'nowrap',
                  }}>
                    {group.label}
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'var(--ds-border)' }} />
                </div>

                {/* Entry card */}
                <div style={{
                  background: 'var(--ds-surface-raised)',
                  border: '1px solid var(--ds-border)',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}>
                  {group.entries.map((entry, i) => {
                    const meta = ACTION_META[entry.action] ?? DEFAULT_META;
                    const isLast = i === group.entries.length - 1;
                    return (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 14,
                          padding: '12px 16px',
                          borderBottom: isLast ? 'none' : '1px solid var(--ds-border)',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--ds-background-neutral-hovered)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
                      >
                        {/* Icon avatar */}
                        <div style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: meta.color,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 13,
                          color: '#fff',
                          fontWeight: 700,
                          flexShrink: 0,
                          marginTop: 1,
                        }}>
                          {meta.icon}
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: 8,
                            flexWrap: 'wrap',
                          }}>
                            <span style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: 'var(--ds-text)',
                            }}>
                              {entry.action}
                            </span>
                            <Lozenge appearance="default">{meta.label}</Lozenge>
                          </div>
                          {entry.details && (
                            <p style={{
                              margin: '3px 0 0',
                              fontSize: 12,
                              color: 'var(--ds-text-subtle)',
                              lineHeight: 1.5,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {entry.details}
                            </p>
                          )}
                        </div>

                        {/* Timestamp */}
                        <span style={{
                          fontSize: 11,
                          color: 'var(--ds-text-subtlest)',
                          fontVariantNumeric: 'tabular-nums',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          paddingTop: 2,
                        }}>
                          {relTime(entry.timestamp)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
