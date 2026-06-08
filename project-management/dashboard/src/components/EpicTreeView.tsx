/**
 * EpicTreeView — Atlaskit-compliant epic hierarchy.
 *
 * Follows atlassian.design principles:
 *  - All colors via var(--ds-*) tokens (never hardcoded hex)
 *  - Spacing in 8px multiples
 *  - ProgressBar per epic showing completion ratio
 *  - Badge for child counts
 *  - Lozenge for status/type
 *  - EmptyState when no epics exist
 *  - Proper dark-mode support (tokens resolve automatically)
 */

import { useState, Component } from 'react';
import type { ReactNode } from 'react';
import TableTree, { Cell, Header, Headers, Row, Rows } from '@atlaskit/table-tree';
import Lozenge from '@atlaskit/lozenge';
import Badge from '@atlaskit/badge';
import ProgressBar from '@atlaskit/progress-bar';
import EmptyState from '@atlaskit/empty-state';
import Button from '@atlaskit/button';
import Tooltip from '@atlaskit/tooltip';
import type { Issue } from '../types';

// ── Atlaskit token mappings ───────────────────────────────────────────────────

type LozAppearance = 'default' | 'success' | 'removed' | 'inprogress' | 'moved' | 'new';

const STATUS_APPEARANCE: Record<string, LozAppearance> = {
  TODO: 'default',
  IN_PROGRESS: 'inprogress',
  REVIEW: 'moved',
  DONE: 'success',
};

const STATUS_LABEL: Record<string, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'In Review',
  DONE: 'Done',
};

const TYPE_APPEARANCE: Record<string, LozAppearance> = {
  task: 'default',
  bug: 'removed',
  story: 'new',
  epic: 'inprogress',
};

const TYPE_ICON: Record<string, string> = {
  epic: '⬡',
  task: '☐',
  bug: '⚠',
  story: '✦',
};

const PRIORITY_DOT: Record<string, string> = {
  critical: 'var(--ds-text-danger)',
  high:     'var(--ds-text-warning)',
  medium:   'var(--ds-background-brand-bold)',
  low:      'var(--ds-text-subtlest)',
};

// ── Data helpers ──────────────────────────────────────────────────────────────

interface TreeItem {
  id: string;
  issue: Issue;
  children?: TreeItem[];
}

function buildTree(issues: Issue[]): TreeItem[] {
  const epics = issues.filter(i => i.type === 'epic');
  const nonEpics = issues.filter(i => i.type !== 'epic');
  return epics.map(epic => ({
    id: epic.id,
    issue: epic,
    children: nonEpics
      .filter(c => c.epic_id === epic.id)
      .map(c => ({ id: c.id, issue: c })),
  }));
}

function epicProgress(children: TreeItem[]) {
  if (!children.length) return { done: 0, total: 0, ratio: 0 };
  const done = children.filter(c =>
    c.issue.status === 'DONE' || c.issue.status === 'REVIEW'
  ).length;
  return { done, total: children.length, ratio: done / children.length };
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function PriorityDot({ priority }: { priority: string }) {
  return (
    <Tooltip content={`Priority: ${priority}`}>
      {tp => (
        <span
          {...tp}
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: PRIORITY_DOT[priority] ?? PRIORITY_DOT.medium,
            flexShrink: 0,
          }}
        />
      )}
    </Tooltip>
  );
}

interface Props {
  issues: Issue[];
  onIssueClick?: (issue: Issue) => void;
}

// ── TableTree implementation (primary) ────────────────────────────────────────

function EpicTreeViewTable({ issues, onIssueClick }: Props) {
  const rootItems = buildTree(issues);

  if (rootItems.length === 0) {
    return (
      <EmptyState
        header="No epics yet"
        description="Epics group related tasks and stories into a larger body of work. Create an issue of type 'epic' to get started."
      />
    );
  }

  const renderRow = (item: TreeItem): React.ReactElement => {
    const { issue } = item;
    const isEpic = issue.type === 'epic';
    const children = item.children ?? [];
    const { done, total, ratio } = epicProgress(children);

    return (
      <Row<TreeItem>
        key={issue.id}
        itemId={issue.id}
        items={item.children?.length ? item.children : undefined}
        hasChildren={Boolean(item.children?.length)}
        isDefaultExpanded={isEpic}
        data={item}
        shouldExpandOnClick={false}
        mainColumnForExpandCollapseLabel={0}
      >
        {/* Title column */}
        <Cell width="52%">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '2px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PriorityDot priority={issue.priority} />
              <span
                role={onIssueClick ? 'button' : undefined}
                tabIndex={onIssueClick ? 0 : undefined}
                onClick={onIssueClick ? () => onIssueClick(issue) : undefined}
                onKeyDown={onIssueClick ? e => { if (e.key === 'Enter' || e.key === ' ') onIssueClick(issue); } : undefined}
                style={{
                  fontWeight: isEpic ? 600 : 400,
                  fontSize: isEpic ? 14 : 13,
                  color: 'var(--ds-text)',
                  cursor: onIssueClick ? 'pointer' : 'default',
                  lineHeight: 1.3,
                }}
              >
                {issue.title}
              </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-text-subtlest)', flexShrink: 0 }}>
                {issue.id}
              </span>
            </div>
            {/* Progress bar — epic only */}
            {isEpic && total > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, maxWidth: 200 }}>
                  <ProgressBar value={ratio} appearance={ratio === 1 ? 'success' : 'default'} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--ds-text-subtle)', whiteSpace: 'nowrap' }}>
                  {done}/{total}
                </span>
              </div>
            )}
          </div>
        </Cell>

        {/* Type column */}
        <Cell width="18%">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--ds-text-subtlest)' }}>{TYPE_ICON[issue.type] ?? '☐'}</span>
            <Lozenge appearance={TYPE_APPEARANCE[issue.type] ?? 'default'}>
              {issue.type.charAt(0).toUpperCase() + issue.type.slice(1)}
            </Lozenge>
          </div>
        </Cell>

        {/* Status column */}
        <Cell width="30%">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lozenge appearance={STATUS_APPEARANCE[issue.status] ?? 'default'}>
              {STATUS_LABEL[issue.status] ?? issue.status}
            </Lozenge>
            {isEpic && total > 0 && (
              <Badge appearance={ratio === 1 ? 'added' : 'default'}>{total}</Badge>
            )}
          </div>
        </Cell>
      </Row>
    );
  };

  return (
    <TableTree<TreeItem> label="Epic hierarchy">
      <Headers>
        <Header width="52%">Title</Header>
        <Header width="18%">Type</Header>
        <Header width="30%">Status</Header>
      </Headers>
      <Rows<TreeItem> items={rootItems} render={renderRow} />
    </TableTree>
  );
}

// ── Fallback pure-CSS tree (no external @atlaskit/table-tree dep at runtime) ──

function FallbackTreeView({ issues, onIssueClick }: Props) {
  const rootItems = buildTree(issues);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    issues.filter(i => i.type === 'epic').forEach(i => s.add(i.id));
    return s;
  });

  if (rootItems.length === 0) {
    return (
      <EmptyState
        header="No epics yet"
        description="Epics group related tasks and stories into a larger body of work. Create an issue of type 'epic' to get started."
      />
    );
  }

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div style={{ fontFamily: 'inherit' }}>
      {/* Column header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '52% 18% 30%',
        padding: '8px 16px',
        borderBottom: '2px solid var(--ds-border-bold)',
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--ds-text-subtlest)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        userSelect: 'none',
      }}>
        <span>Title</span>
        <span>Type</span>
        <span>Status</span>
      </div>

      {rootItems.map(epic => {
        const isOpen = expanded.has(epic.id);
        const children = epic.children ?? [];
        const hasChildren = children.length > 0;
        const { done, total, ratio } = epicProgress(children);

        return (
          <div key={epic.id} style={{ borderBottom: '1px solid var(--ds-border)' }}>
            {/* Epic row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '52% 18% 30%',
                alignItems: 'start',
                padding: '10px 16px',
                background: 'var(--ds-surface-sunken)',
                cursor: onIssueClick ? 'pointer' : hasChildren ? 'pointer' : 'default',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--ds-background-neutral-hovered)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'var(--ds-surface-sunken)'; }}
              onClick={() => {
                if (hasChildren) toggle(epic.id);
                if (onIssueClick) onIssueClick(epic.issue);
              }}
            >
              {/* Title + progress */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {hasChildren && (
                    <span style={{
                      display: 'inline-block',
                      fontSize: 10,
                      color: 'var(--ds-text-subtlest)',
                      transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s ease',
                      flexShrink: 0,
                    }}>▶</span>
                  )}
                  <PriorityDot priority={epic.issue.priority} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ds-text)', lineHeight: 1.3 }}>
                    {epic.issue.title}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-text-subtlest)', flexShrink: 0 }}>
                    {epic.issue.id}
                  </span>
                </div>
                {total > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: hasChildren ? 18 : 0 }}>
                    <div style={{ flex: 1, maxWidth: 180 }}>
                      <ProgressBar value={ratio} appearance={ratio === 1 ? 'success' : 'default'} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--ds-text-subtle)', whiteSpace: 'nowrap' }}>
                      {done} / {total} done
                    </span>
                  </div>
                )}
              </div>

              {/* Type */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 2 }}>
                <span style={{ fontSize: 13, color: 'var(--ds-text-subtlest)' }}>{TYPE_ICON[epic.issue.type]}</span>
                <Lozenge appearance={TYPE_APPEARANCE[epic.issue.type] ?? 'default'}>
                  {epic.issue.type.charAt(0).toUpperCase() + epic.issue.type.slice(1)}
                </Lozenge>
              </div>

              {/* Status + child count */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
                <Lozenge appearance={STATUS_APPEARANCE[epic.issue.status] ?? 'default'}>
                  {STATUS_LABEL[epic.issue.status] ?? epic.issue.status}
                </Lozenge>
                {total > 0 && (
                  <Badge appearance={ratio === 1 ? 'added' : 'default'}>{total}</Badge>
                )}
              </div>
            </div>

            {/* Child rows */}
            {isOpen && children.map((child, idx) => (
              <div
                key={child.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '52% 18% 30%',
                  alignItems: 'center',
                  padding: '8px 16px 8px 42px',
                  borderTop: '1px solid var(--ds-border)',
                  background: idx % 2 === 0 ? 'var(--ds-surface)' : 'var(--ds-surface-raised)',
                  cursor: onIssueClick ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--ds-background-neutral-hovered)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = idx % 2 === 0 ? 'var(--ds-surface)' : 'var(--ds-surface-raised)'; }}
                onClick={onIssueClick ? () => onIssueClick(child.issue) : undefined}
              >
                {/* Child title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PriorityDot priority={child.issue.priority} />
                  <span style={{ fontSize: 13, color: 'var(--ds-text)', lineHeight: 1.3 }}>{child.issue.title}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-text-subtlest)', flexShrink: 0 }}>{child.issue.id}</span>
                </div>

                {/* Child type */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>{TYPE_ICON[child.issue.type] ?? '☐'}</span>
                  <Lozenge appearance={TYPE_APPEARANCE[child.issue.type] ?? 'default'}>
                    {child.issue.type.charAt(0).toUpperCase() + child.issue.type.slice(1)}
                  </Lozenge>
                </div>

                {/* Child status */}
                <Lozenge appearance={STATUS_APPEARANCE[child.issue.status] ?? 'default'}>
                  {STATUS_LABEL[child.issue.status] ?? child.issue.status}
                </Lozenge>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Error boundary ────────────────────────────────────────────────────────────

class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? this.props.fallback : this.props.children; }
}

// ── Summary stats bar ─────────────────────────────────────────────────────────

function EpicStats({ issues }: { issues: Issue[] }) {
  const epics = issues.filter(i => i.type === 'epic');
  const children = issues.filter(i => i.type !== 'epic' && i.epic_id);
  const inProgress = epics.filter(e => e.status === 'IN_PROGRESS').length;
  const done = epics.filter(e => e.status === 'DONE').length;
  const childDone = children.filter(c => c.status === 'DONE' || c.status === 'REVIEW').length;

  if (epics.length === 0) return null;

  const stat = (value: number | string, label: string, color?: string) => (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '10px 20px',
      borderRight: '1px solid var(--ds-border)',
    }}>
      <span style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--ds-text)', lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', marginTop: 3, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );

  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      background: 'var(--ds-surface-raised)',
      border: '1px solid var(--ds-border)',
      borderRadius: 6,
      marginBottom: 20,
      overflow: 'hidden',
    }}>
      {stat(epics.length, 'Total Epics')}
      {stat(inProgress, 'In Progress', inProgress > 0 ? 'var(--ds-link)' : undefined)}
      {stat(done, 'Completed', done > 0 ? 'var(--ds-text-success)' : undefined)}
      {children.length > 0 && stat(`${childDone}/${children.length}`, 'Tasks Done')}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function EpicTreeView({ issues, onIssueClick }: Props) {
  return (
    <div>
      <EpicStats issues={issues} />
      <div style={{
        background: 'var(--ds-surface-raised)',
        border: '1px solid var(--ds-border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}>
        <ErrorBoundary fallback={<FallbackTreeView issues={issues} onIssueClick={onIssueClick} />}>
          <EpicTreeViewTable issues={issues} onIssueClick={onIssueClick} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

// Export Button so App.tsx can import it without adding a separate import
export { Button };
