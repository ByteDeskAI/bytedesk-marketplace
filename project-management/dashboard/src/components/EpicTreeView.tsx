import { useState } from 'react';
import TableTree, { Cell, Header, Headers, Row, Rows } from '@atlaskit/table-tree';
import Lozenge from '@atlaskit/lozenge';
import type { Issue } from '../types';

// ── appearance maps ──────────────────────────────────────────────────────────

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

// ── tree item shape ──────────────────────────────────────────────────────────

interface TreeItem {
  id: string;
  issue: Issue;
  children?: TreeItem[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function buildTree(issues: Issue[]): TreeItem[] {
  const epics = issues.filter((i) => i.type === 'epic');
  const children = issues.filter((i) => i.type !== 'epic');

  return epics.map((epic) => ({
    id: epic.id,
    issue: epic,
    children: children
      .filter((child) => child.epic_id === epic.id)
      .map((child) => ({ id: child.id, issue: child })),
  }));
}

// ── sub-components ───────────────────────────────────────────────────────────

function TitleCell({ issue, onClick }: { issue: Issue; onClick?: (issue: Issue) => void }) {
  return (
    <span
      style={{
        cursor: onClick ? 'pointer' : 'default',
        fontWeight: issue.type === 'epic' ? 600 : 400,
        color: '#172B4D',
        fontSize: 14,
      }}
      onClick={onClick ? () => onClick(issue) : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick(issue);
            }
          : undefined
      }
    >
      {issue.title}
    </span>
  );
}

// ── TableTree implementation ─────────────────────────────────────────────────

interface Props {
  issues: Issue[];
  onIssueClick?: (issue: Issue) => void;
}

function EpicTreeViewTable({ issues, onIssueClick }: Props) {
  const rootItems = buildTree(issues);

  const renderRow = (item: TreeItem): React.ReactElement => {
    const { issue } = item;
    const hasChildren = Boolean(item.children && item.children.length > 0);

    return (
      <Row<TreeItem>
        key={issue.id}
        itemId={issue.id}
        items={hasChildren ? item.children : undefined}
        hasChildren={hasChildren}
        isDefaultExpanded={issue.type === 'epic'}
        data={item}
        shouldExpandOnClick={false}
        mainColumnForExpandCollapseLabel={0}
      >
        <Cell width="50%">
          <TitleCell issue={issue} onClick={onIssueClick} />
        </Cell>
        <Cell width="16%">
          <Lozenge appearance={TYPE_APPEARANCE[issue.type] ?? 'default'}>
            {issue.type.charAt(0).toUpperCase() + issue.type.slice(1)}
          </Lozenge>
        </Cell>
        <Cell width="20%">
          <Lozenge appearance={STATUS_APPEARANCE[issue.status] ?? 'default'}>
            {STATUS_LABEL[issue.status] ?? issue.status}
          </Lozenge>
        </Cell>
      </Row>
    );
  };

  return (
    <TableTree<TreeItem> label="Epic hierarchy">
      <Headers>
        <Header width="50%">Title</Header>
        <Header width="20%">Type</Header>
        <Header width="30%">Status</Header>
      </Headers>
      <Rows<TreeItem> items={rootItems} render={renderRow} />
    </TableTree>
  );
}

// ── fallback: pure-div tree ──────────────────────────────────────────────────

function FallbackTreeView({ issues, onIssueClick }: Props) {
  const rootItems = buildTree(issues);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const s = new Set<string>();
    issues.filter((i) => i.type === 'epic').forEach((i) => s.add(i.id));
    return s;
  });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  return (
    <div style={{ fontFamily: 'inherit', fontSize: 14 }}>
      {/* Header row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '50% 20% 30%',
          borderBottom: '2px solid #DFE1E6',
          padding: '8px 12px',
          fontWeight: 600,
          color: '#5E6C84',
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        <span>Title</span>
        <span>Type</span>
        <span>Status</span>
      </div>

      {rootItems.map((epic) => {
        const isOpen = expanded.has(epic.id);
        const hasChildren = Boolean(epic.children && epic.children.length > 0);

        return (
          <div key={epic.id}>
            {/* Epic row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '50% 20% 30%',
                alignItems: 'center',
                padding: '8px 12px',
                borderBottom: '1px solid #EBECF0',
                background: '#F4F5F7',
                cursor: 'pointer',
              }}
              onClick={() => {
                if (hasChildren) toggle(epic.id);
                if (onIssueClick) onIssueClick(epic.issue);
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                {hasChildren && (
                  <span
                    style={{
                      display: 'inline-block',
                      transition: 'transform 0.15s',
                      transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                      fontSize: 10,
                      color: '#5E6C84',
                    }}
                  >
                    ▶
                  </span>
                )}
                {epic.issue.title}
              </span>
              <span>
                <Lozenge appearance={TYPE_APPEARANCE[epic.issue.type] ?? 'default'}>
                  {epic.issue.type.charAt(0).toUpperCase() + epic.issue.type.slice(1)}
                </Lozenge>
              </span>
              <span>
                <Lozenge appearance={STATUS_APPEARANCE[epic.issue.status] ?? 'default'}>
                  {STATUS_LABEL[epic.issue.status] ?? epic.issue.status}
                </Lozenge>
              </span>
            </div>

            {/* Child rows */}
            {isOpen &&
              epic.children?.map((child) => (
                <div
                  key={child.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '50% 20% 30%',
                    alignItems: 'center',
                    padding: '6px 12px 6px 36px',
                    borderBottom: '1px solid #EBECF0',
                    cursor: onIssueClick ? 'pointer' : 'default',
                  }}
                  onClick={onIssueClick ? () => onIssueClick(child.issue) : undefined}
                >
                  <span style={{ color: '#172B4D' }}>{child.issue.title}</span>
                  <span>
                    <Lozenge appearance={TYPE_APPEARANCE[child.issue.type] ?? 'default'}>
                      {child.issue.type.charAt(0).toUpperCase() + child.issue.type.slice(1)}
                    </Lozenge>
                  </span>
                  <span>
                    <Lozenge appearance={STATUS_APPEARANCE[child.issue.status] ?? 'default'}>
                      {STATUS_LABEL[child.issue.status] ?? child.issue.status}
                    </Lozenge>
                  </span>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}

// ── main export ──────────────────────────────────────────────────────────────
//
// Attempt to use the real TableTree. If it throws during render (e.g. due to
// an incompatible API change in a future version), ErrorBoundary catches and
// falls back to the pure-div implementation.

import { Component, type ReactNode } from 'react';

class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export default function EpicTreeView({ issues, onIssueClick }: Props) {
  return (
    <ErrorBoundary
      fallback={<FallbackTreeView issues={issues} onIssueClick={onIssueClick} />}
    >
      <EpicTreeViewTable issues={issues} onIssueClick={onIssueClick} />
    </ErrorBoundary>
  );
}
