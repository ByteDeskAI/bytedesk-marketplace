import { useState } from 'react';
import DynamicTable from '@atlaskit/dynamic-table';
import Lozenge from '@atlaskit/lozenge';
import Tooltip from '@atlaskit/tooltip';
import { Checkbox } from '@atlaskit/checkbox';
import Toggle from '@atlaskit/toggle';
import Tag, { SimpleTag } from '@atlaskit/tag';
import TagGroup from '@atlaskit/tag-group';
import type { Issue } from '../types';
import BulkActionsBar from './BulkActionsBar';

type LozAppearance = 'default' | 'success' | 'removed' | 'inprogress' | 'moved' | 'new';

const STATUS_APPEARANCE: Record<string, LozAppearance> = {
  TODO: 'default',
  IN_PROGRESS: 'inprogress',
  REVIEW: 'moved',
  DONE: 'success',
};

const TYPE_APPEARANCE: Record<string, LozAppearance> = {
  task: 'default',
  bug: 'removed',
  story: 'new',
  epic: 'inprogress',
};

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const head = {
  cells: [
    { key: 'select', content: '', width: 4 },
    { key: 'id', content: 'Key', width: 8, isSortable: true },
    { key: 'title', content: 'Summary', isSortable: true },
    { key: 'type', content: 'Type', width: 8 },
    { key: 'priority', content: 'Priority', width: 9 },
    { key: 'status', content: 'Status', width: 11 },
  ],
};

interface Props {
  issues: Issue[];
  onBulkAction?: (ids: string[], action: string) => void;
}

export default function Backlog({ issues, onBulkAction }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sortByPriority, setSortByPriority] = useState(false);

  const displayedIssues = sortByPriority
    ? [...issues].sort(
        (a, b) =>
          (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99),
      )
    : issues;

  const rows = displayedIssues.map(t => ({
    key: t.id,
    cells: [
      {
        key: 'select',
        content: (
          <Checkbox
            isChecked={selectedIds.includes(t.id)}
            onChange={e => {
              const v = e.currentTarget.checked;
              setSelectedIds(prev =>
                v ? [...prev, t.id] : prev.filter(x => x !== t.id),
              );
            }}
            label=""
          />
        ),
      },
      {
        key: t.id,
        content: (
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-link)' }}>
            {t.id}
          </span>
        ),
      },
      {
        key: t.title,
        content: (
          <Tooltip content={t.title} position="right" delay={400}>
            {tp => (
              <span
                {...tp}
                style={{ fontSize: 13, color: 'var(--ds-text)' }}
              >
                {t.title}
              </span>
            )}
          </Tooltip>
        ),
      },
      {
        key: t.type,
        content: (
          <TagGroup>
            <SimpleTag text={t.type} />
            {(t.priority === 'critical' || t.priority === 'high') && (
              <SimpleTag text={t.priority} />
            )}
          </TagGroup>
        ),
      },
      {
        key: t.priority,
        content: (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              color: 'var(--ds-text-subtle)',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background:
                  t.priority === 'critical' || t.priority === 'high'
                    ? 'var(--ds-background-danger-bold)'
                    : t.priority === 'medium'
                    ? 'var(--ds-background-warning-bold)'
                    : 'var(--ds-background-neutral-bold)',
              }}
            />
            {t.priority}
          </span>
        ),
      },
      {
        key: t.status,
        content: (
          <Lozenge appearance={STATUS_APPEARANCE[t.status] ?? 'default'}>
            {t.status.replace('_', ' ')}
          </Lozenge>
        ),
      },
    ],
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '14px 24px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ds-text)' }}>Backlog</h1>
          <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>
            {issues.length} issues
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 8,
          }}
        >
          <Toggle
            id="sort-by-priority"
            isChecked={sortByPriority}
            onChange={() => setSortByPriority(prev => !prev)}
          />
          <label
            htmlFor="sort-by-priority"
            style={{ fontSize: 12, color: 'var(--ds-text-subtle)', cursor: 'pointer' }}
          >
            Sort by priority
          </label>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 24px' }}>
        <BulkActionsBar
          selectedIds={selectedIds}
          onClearSelection={() => setSelectedIds([])}
          onBulkAction={(ids, a) => {
            onBulkAction?.(ids, a);
            setSelectedIds([]);
          }}
        />
        <div
          style={{
            background: 'var(--ds-surface-raised)',
            border: '1px solid var(--ds-border)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <DynamicTable
            head={head}
            rows={rows}
            defaultSortKey="id"
            defaultSortOrder="ASC"
            isFixedSize
            rowsPerPage={20}
          />
        </div>
      </div>
    </div>
  );
}
