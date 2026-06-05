import Lozenge from '@atlaskit/lozenge';
import Badge from '@atlaskit/badge';
import EmptyState from '@atlaskit/empty-state';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import Select from '@atlaskit/select';
import Popup from '@atlaskit/popup';
import Button from '@atlaskit/button';
import Tag, { SimpleTag } from '@atlaskit/tag';
import TagGroup from '@atlaskit/tag-group';
import Tooltip from '@atlaskit/tooltip';
import { Checkbox } from '@atlaskit/checkbox';
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu';
import Toggle from '@atlaskit/toggle';
import Blanket from '@atlaskit/blanket';
import InlineDialog from '@atlaskit/inline-dialog';
import BulkActionsBar from './BulkActionsBar';
import type { Issue } from '../types';
import { useState, useRef, useEffect, useCallback } from 'react';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

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

const COLS = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const;
const COL_LABELS: Record<typeof COLS[number], string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'In Review',
  DONE: 'Done',
};

interface Props {
  issues: Issue[];
  subTitle: string;
  sprintGoal?: string;
  onStatusChange?: (issueId: string, status: string) => void;
  onIssueClick?: (issue: Issue) => void;
  onBulkAction?: (ids: string[], action: string) => void;
}

interface IssueCardProps {
  issue: Issue;
  onStatusChange?: (issueId: string, status: string) => void;
  onIssueClick?: (issue: Issue) => void;
  isSelected?: boolean;
  onSelect?: (id: string, value: boolean) => void;
  compact?: boolean;
}

function IssueCard({ issue, onStatusChange, onIssueClick, isSelected, onSelect, compact }: IssueCardProps) {
  const [selectingStatus, setSelectingStatus] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cardRef.current) return;
    return draggable({
      element: cardRef.current,
      getInitialData: () => ({ issueId: issue.id, fromStatus: issue.status }),
    });
  }, [issue.id, issue.status]);

  // Derive tags: type=bug -> "bug", priority=critical -> "urgent", sprint_id -> "in-sprint" else "backlog"
  const tags: string[] = [];
  if (issue.type === 'bug') tags.push('bug');
  if (issue.priority === 'critical') tags.push('urgent');
  if ((issue as unknown as Record<string, unknown>).sprint_id) {
    tags.push('in-sprint');
  } else {
    tags.push('backlog');
  }

  const cardPadding = compact ? '6px 10px' : '10px 12px';

  return (
    <div
      ref={cardRef}
      style={{
        background: 'var(--ds-surface)',
        border: isSelected ? '1px solid var(--ds-border-focused)' : '1px solid var(--ds-border)',
        borderRadius: 3,
        padding: cardPadding,
        transition: 'box-shadow .15s, border-color .15s',
        cursor: 'grab',
        boxShadow: isSelected ? 'var(--ds-shadow-raised)' : undefined,
      }}
      onClick={() => onIssueClick?.(issue)}
      onMouseOver={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-border-focused)';
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--ds-shadow-raised)';
      }}
      onMouseOut={e => {
        (e.currentTarget as HTMLElement).style.borderColor = isSelected ? 'var(--ds-border-focused)' : 'var(--ds-border)';
        (e.currentTarget as HTMLElement).style.boxShadow = isSelected ? 'var(--ds-shadow-raised)' : 'none';
      }}
    >
      <div
        className="ic-header"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span onClick={e => e.stopPropagation()}>
            <Checkbox
              isChecked={isSelected}
              onChange={e => onSelect?.(issue.id, e.currentTarget.checked)}
              label=""
            />
          </span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-link)', fontWeight: 500 }}>
            {issue.id}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: issue.priority === 'critical' || issue.priority === 'high'
              ? 'var(--ds-background-danger-bold)'
              : issue.priority === 'medium'
              ? 'var(--ds-background-warning-bold)'
              : 'var(--ds-background-neutral-bold)',
          }} />
          <Popup
            isOpen={menuOpen}
            onClose={() => setMenuOpen(false)}
            placement="bottom-end"
            trigger={(triggerProps: object) => (
              <Button
                {...(triggerProps as Record<string, unknown>)}
                appearance="subtle"
                spacing="compact"
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  setMenuOpen(!menuOpen);
                }}
              >
                •••
              </Button>
            )}
            content={() => (
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 150 }}>
                <Button
                  appearance="subtle"
                  shouldFitContainer
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    fetch('/api/run', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ ticket_id: issue.id }),
                    }).then(r => r.json()).then((body: { ok: boolean; error?: string }) => {
                      if (!body.ok) {
                        // Silently ignore — user will see error in drawer
                      }
                    }).catch(() => {});
                    onIssueClick?.(issue);   // open drawer to show terminal
                    setMenuOpen(false);
                  }}
                >
                  &#9654; Run Ticket
                </Button>
                <Button
                  appearance="subtle"
                  shouldFitContainer
                  onClick={() => { onStatusChange?.(issue.id, 'IN_PROGRESS'); setMenuOpen(false); }}
                >
                  In Progress
                </Button>
                <Button
                  appearance="subtle"
                  shouldFitContainer
                  onClick={() => { onStatusChange?.(issue.id, 'DONE'); setMenuOpen(false); }}
                >
                  Mark Done
                </Button>
                <Button
                  appearance="subtle"
                  shouldFitContainer
                  onClick={() => { navigator.clipboard?.writeText(issue.id); setMenuOpen(false); }}
                >
                  Copy ID
                </Button>
              </div>
            )}
          />
        </div>
      </div>
      <Tooltip content={issue.title} position="top" delay={500}>
        {(tp) => (
          <div
            {...tp}
            style={{ fontSize: 13, color: 'var(--ds-text)', lineHeight: 1.4, marginBottom: 8 }}
          >
            {issue.title}
          </div>
        )}
      </Tooltip>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Lozenge appearance={TYPE_APPEARANCE[issue.type] ?? 'default'}>
          {issue.type}
        </Lozenge>
        {selectingStatus ? (
          <div style={{ width: 140, zIndex: 10 }} onClick={e => e.stopPropagation()}>
            <Select
              autoFocus
              menuIsOpen
              options={[
                { label: 'To Do', value: 'TODO' },
                { label: 'In Progress', value: 'IN_PROGRESS' },
                { label: 'In Review', value: 'REVIEW' },
                { label: 'Done', value: 'DONE' },
              ]}
              onChange={(opt) => {
                if (opt) { onStatusChange?.(issue.id, (opt as { value: string }).value); }
                setSelectingStatus(false);
              }}
              onMenuClose={() => setSelectingStatus(false)}
            />
          </div>
        ) : (
          <span
            onClick={e => { e.stopPropagation(); setSelectingStatus(true); }}
            style={{ cursor: 'pointer' }}
          >
            <Lozenge appearance={STATUS_APPEARANCE[issue.status] ?? 'default'}>
              {issue.status}
            </Lozenge>
          </span>
        )}
      </div>
      {tags.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <TagGroup>
            {tags.map(t => (
              <SimpleTag key={t} text={t} />
            ))}
          </TagGroup>
        </div>
      )}
    </div>
  );
}

interface ColumnProps {
  col: typeof COLS[number];
  issues: Issue[];
  onStatusChange?: (issueId: string, status: string) => void;
  onIssueClick?: (issue: Issue) => void;
  selectedIds?: string[];
  onSelect?: (id: string, value: boolean) => void;
  compact?: boolean;
}

function Column({ col, issues, onStatusChange, onIssueClick, selectedIds, onSelect, compact }: ColumnProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const colorMap: Record<typeof COLS[number], string> = {
    TODO: 'var(--ds-text-subtlest)',
    IN_PROGRESS: 'var(--ds-link)',
    REVIEW: 'var(--ds-text-warning)',
    DONE: 'var(--ds-text-success)',
  };

  useEffect(() => {
    if (!bodyRef.current) return;
    return dropTargetForElements({
      element: bodyRef.current,
      getData: () => ({ targetStatus: col }),
      onDragEnter: () => setIsDragOver(true),
      onDragLeave: () => setIsDragOver(false),
      onDrop: () => setIsDragOver(false),
    });
  }, [col]);

  return (
    <div style={{
      background: 'var(--ds-surface-sunken)',
      border: '1px solid var(--ds-border)',
      borderRadius: 8,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px 8px',
        borderBottom: '1px solid var(--ds-border)',
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
          textTransform: 'uppercase', flex: 1, color: colorMap[col],
        }}>
          {COL_LABELS[col]}
        </span>
        <Badge appearance="default">{issues.length}</Badge>
      </div>
      <div
        ref={bodyRef}
        style={{
          flex: 1, overflowY: 'auto', padding: 8,
          display: 'flex', flexDirection: 'column', gap: 6,
          border: isDragOver ? '2px solid var(--ds-border-focused)' : '2px solid transparent',
          borderRadius: 6,
          background: isDragOver ? 'var(--ds-background-selected)' : undefined,
          transition: 'border-color .12s, background .12s',
        }}
      >
        {issues.length === 0 ? (
          <EmptyState header="No issues" description="Drag here or create a new issue" />
        ) : (
          issues.map(issue => (
            <IssueCard
              key={issue.id}
              issue={issue}
              onStatusChange={onStatusChange}
              onIssueClick={onIssueClick}
              isSelected={selectedIds?.includes(issue.id)}
              onSelect={onSelect}
              compact={compact}
            />
          ))
        )}
      </div>
    </div>
  );
}

export default function Board({ issues, subTitle, sprintGoal, onStatusChange, onIssueClick, onBulkAction }: Props) {
  const [goalDismissed, setGoalDismissed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compact, setCompact] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const byStatus = Object.fromEntries(
    COLS.map(col => [col, issues.filter(i => i.status === col)])
  ) as Record<typeof COLS[number], Issue[]>;

  const handleSelect = useCallback((id: string, value: boolean) => {
    setSelectedIds(prev =>
      value ? [...prev, id] : prev.filter(x => x !== id)
    );
  }, []);

  useEffect(() => {
    return monitorForElements({
      onDragStart: () => setIsDragging(true),
      onDrop({ source, location }) {
        setIsDragging(false);
        const dest = location.current.dropTargets[0];
        if (!dest) return;
        const src = source.data as { issueId: string };
        const dst = dest.data as { targetStatus: string };
        onStatusChange?.(src.issueId, dst.targetStatus);
      },
    });
  }, [onStatusChange]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {isDragging && <Blanket isTinted={false} />}
      <div style={{ padding: '14px 24px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ds-text)' }}>Board</h1>
          <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>{subTitle}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-text)', cursor: 'pointer' }}>
            <Toggle
              isChecked={compact}
              onChange={e => setCompact(e.target.checked)}
              size="regular"
            />
            Compact
          </label>
        </div>
      </div>
      {sprintGoal && !goalDismissed && (
        <div style={{ padding: '0 24px 10px', flexShrink: 0 }}>
          <SectionMessage
            appearance="information"
            title="Sprint goal"
            actions={[<SectionMessageAction key="dismiss" onClick={() => setGoalDismissed(true)}>Dismiss</SectionMessageAction>]}
          >
            <p>{sprintGoal}</p>
          </SectionMessage>
        </div>
      )}
      <div style={{ padding: '0 24px 8px', flexShrink: 0 }}>
        <BulkActionsBar
          selectedIds={selectedIds}
          onClearSelection={() => setSelectedIds([])}
          onBulkAction={(ids, action) => {
            onBulkAction?.(ids, action);
            setSelectedIds([]);
          }}
        />
      </div>
      <div style={{
        flex: 1, display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        padding: '0 24px 24px',
        overflow: 'hidden',
        minHeight: 0,
      }}>
        {COLS.map(col => (
          <Column
            key={col}
            col={col}
            issues={byStatus[col]}
            onStatusChange={onStatusChange}
            onIssueClick={onIssueClick}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}
