import Avatar from '@atlaskit/avatar';
import type { ActivityEntry } from '../types';
import { relTime } from '../api';

const ACTION_COLORS: Record<string, string> = {
  'Create Issue': 'var(--ds-background-success-bold)',
  'Update Issue': 'var(--ds-background-brand-bold)',
  'Create Document': 'var(--ds-background-warning-bold)',
  'Update Document': 'var(--ds-background-warning-bold)',
  'Create Sprint': 'var(--ds-background-discovery-bold)',
  'Start Sprint': 'var(--ds-background-discovery-bold)',
  'Complete Sprint': 'var(--ds-background-discovery-bold)',
};

const ACTION_ICONS: Record<string, string> = {
  'Create Issue': '+',
  'Update Issue': '~',
  'Create Document': 'D',
  'Update Document': 'D',
  'Create Sprint': 'S',
  'Start Sprint': 'S',
  'Complete Sprint': 'S',
  'Project initialized': '*',
};

interface Props { activity: ActivityEntry[] }

export default function Activity({ activity }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', flexShrink: 0 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ds-text)' }}>Activity</h1>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
        {activity.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ds-text-subtlest)', fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: .5 }}>◉</div>
            No activity yet
          </div>
        ) : (
          <div>
            {activity.map((entry, i) => {
              const bg = ACTION_COLORS[entry.action] ?? 'var(--ds-background-brand-bold)';
              const icon = ACTION_ICONS[entry.action] ?? '*';
              return (
                <div key={i} style={{
                  display: 'flex', gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--ds-border)',
                }}>
                  <div style={{ flexShrink: 0, marginTop: 2 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: bg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, color: '#fff', fontWeight: 700,
                    }}>
                      {icon}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--ds-text)', fontWeight: 500 }}>
                      {entry.action}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ds-text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                      {entry.details}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', fontFamily: 'monospace', whiteSpace: 'nowrap', paddingTop: 2, flexShrink: 0 }}>
                    {relTime(entry.timestamp)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
