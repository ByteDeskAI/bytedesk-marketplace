import Lozenge from '@atlaskit/lozenge';
import Badge from '@atlaskit/badge';
import EmptyState from '@atlaskit/empty-state';
import SectionMessage, { SectionMessageAction } from '@atlaskit/section-message';
import Select from '@atlaskit/select';
import Popup from '@atlaskit/popup';
import Button from '@atlaskit/button';
import Avatar from '@atlaskit/avatar';
import Tag, { SimpleTag } from '@atlaskit/tag';
import TagGroup from '@atlaskit/tag-group';
import Tooltip from '@atlaskit/tooltip';
import { Checkbox } from '@atlaskit/checkbox';
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu';
import Toggle from '@atlaskit/toggle';
import Blanket from '@atlaskit/blanket';
import InlineDialog from '@atlaskit/inline-dialog';
import BulkActionsBar from './BulkActionsBar';
import type { Issue, IssueCheckin, IssueScope } from '../types';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

// ── Board sort helper ─────────────────────────────────────────────────────────

function sortIssues(issues: Issue[], mode: string): Issue[] {
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const scopeOrder: Record<string, number> = { nano: 0, small: 1, medium: 2, large: 3, research: 2 };
  switch (mode) {
    case 'priority':
      return [...issues].sort((a, b) =>
        (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2) ||
        (a.weight ?? 50) - (b.weight ?? 50));
    case 'weight':
      return [...issues].sort((a, b) => (a.weight ?? 50) - (b.weight ?? 50));
    case 'updated':
      return [...issues].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    case 'scope':
      return [...issues].sort((a, b) => (scopeOrder[a.scope ?? ''] ?? 2) - (scopeOrder[b.scope ?? ''] ?? 2));
    case 'sessions':
      return [...issues].sort((a, b) =>
        (a.session_summaries?.length ?? 0) - (b.session_summaries?.length ?? 0));
    default:
      return [...issues].sort((a, b) => {
        const aNum = parseInt(a.id.split('-')[1] ?? '0', 10);
        const bNum = parseInt(b.id.split('-')[1] ?? '0', 10);
        return aNum - bNum;
      });
  }
}

// ── Staleness helpers ─────────────────────────────────────────────────────────

function getAgeInStatus(issue: Issue): number {
  const updated = new Date(issue.updated_at).getTime();
  return (Date.now() - updated) / 86_400_000; // days
}

function getStalenessGroup(issue: Issue): 'fresh' | 'aging' | 'stale' {
  const days = getAgeInStatus(issue);
  if (days < 1) return 'fresh';
  if (days < 3) return 'aging';
  return 'stale';
}

type LozAppearance = 'default' | 'success' | 'removed' | 'inprogress' | 'moved' | 'new';

const STATUS_APPEARANCE: Record<string, LozAppearance> = {
  TODO: 'default',
  IN_PROGRESS: 'inprogress',
  REVIEW: 'moved',
  DONE: 'success',
  NEEDS_INPUT: 'removed',
  DRAFT: 'default',
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

// ── Scope chip ────────────────────────────────────────────────────────────────

const SCOPE_LABELS: Record<IssueScope, string> = {
  nano: '⬡ nano',
  small: '◇ small',
  medium: '◈ medium',
  large: '◆ large',
  research: '⊙ research',
};

function ScopeChip({ scope }: { scope: IssueScope }) {
  return (
    <span style={{
      background: 'var(--ds-background-neutral-bold)',
      color: 'var(--ds-text-subtlest)',
      borderRadius: 2,
      fontSize: 10,
      padding: '1px 5px',
      fontWeight: 500,
      letterSpacing: '.02em',
      flexShrink: 0,
    }}>
      {SCOPE_LABELS[scope]}
    </span>
  );
}

// ── Blocked-by indicator ──────────────────────────────────────────────────────

const BLOCKING_DONE_STATUSES = new Set(['DONE', 'REVIEW']);

function getBlockingIssueIds(issue: Issue, allIssues: Issue[]): string[] {
  if (!issue.links || issue.links.length === 0) return [];
  const allById = new Map(allIssues.map(i => [i.id, i]));
  return issue.links
    .filter(link => {
      if (link.type !== 'is-blocked-by') return false;
      const blocker = allById.get(link.to_id);
      if (blocker && BLOCKING_DONE_STATUSES.has(blocker.status)) return false;
      return true;
    })
    .map(link => link.to_id);
}

interface BlockedIndicatorProps {
  issue: Issue;
  allIssues: Issue[];
  onIssueClick?: (issue: Issue) => void;
}

function BlockedIndicator({ issue, allIssues, onIssueClick }: BlockedIndicatorProps) {
  const blockingIds = getBlockingIssueIds(issue, allIssues);
  if (blockingIds.length === 0) return null;

  const allById = new Map(allIssues.map(i => [i.id, i]));
  const firstBlocker = allById.get(blockingIds[0]);

  const tooltipContent = `Blocked by ${blockingIds.join(', ')}`;

  return (
    <Tooltip content={tooltipContent} position="top">
      {(tp) => (
        <span
          {...tp}
          onClick={(e) => {
            e.stopPropagation();
            if (firstBlocker) onIssueClick?.(firstBlocker);
          }}
          style={{
            color: 'var(--ds-text-danger)',
            cursor: 'pointer',
            fontSize: 14,
            lineHeight: 1,
            flexShrink: 0,
          }}
          role="button"
          aria-label={tooltipContent}
        >
          ⛓
        </span>
      )}
    </Tooltip>
  );
}

// ── IssueCard ─────────────────────────────────────────────────────────────────

interface IssueCardProps {
  issue: Issue;
  allIssues: Issue[];
  onStatusChange?: (issueId: string, status: string) => void;
  onIssueClick?: (issue: Issue) => void;
  isSelected?: boolean;
  onSelect?: (id: string, value: boolean) => void;
  compact?: boolean;
  focusMode?: boolean;
}

function IssueCard({ issue, allIssues, onStatusChange, onIssueClick, isSelected, onSelect, compact, focusMode }: IssueCardProps) {
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

  // Focus mode: hide DONE cards
  if (focusMode && issue.status === 'DONE') return null;

  const issueTags = issue.tags ?? [];

  const cardPadding = compact ? '6px 10px' : '10px 12px';

  const lastCheckin: IssueCheckin | undefined = issue.checkins && issue.checkins.length > 0
    ? issue.checkins[issue.checkins.length - 1]
    : undefined;

  const showProgress = issue.progress > 0 && issue.status === 'IN_PROGRESS';

  const isDraft = issue.status === 'DRAFT';

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
        position: 'relative',
        overflow: 'hidden',
        opacity: isDraft ? 0.55 : 1,
        fontStyle: isDraft ? 'italic' : 'normal',
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
      {/* Pinned indicator */}
      {issue.pinned && (
        <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', marginBottom: 3 }}>
          📌
        </div>
      )}

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
                        // Silently ignore
                      }
                    }).catch(() => {});
                    onIssueClick?.(issue);
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

      {/* Tags chips from issue.tags — show first 2, then +N */}
      {issueTags.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
          {issueTags.slice(0, 2).map(tag => (
            <span key={tag} style={{
              fontSize: 10,
              padding: '1px 5px',
              background: 'var(--ds-surface-sunken)',
              borderRadius: 3,
              color: 'var(--ds-text-subtlest)',
            }}>
              {tag}
            </span>
          ))}
          {issueTags.length > 2 && (
            <span style={{
              fontSize: 10,
              padding: '1px 5px',
              background: 'var(--ds-surface-sunken)',
              borderRadius: 3,
              color: 'var(--ds-text-subtlest)',
            }}>
              +{issueTags.length - 2} more
            </span>
          )}
        </div>
      )}

      {/* Card footer: scope chip + blocked indicator + assignee avatar */}
      {(issue.scope || (issue.links && issue.links.length > 0) || issue.assignee) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {issue.scope && <ScopeChip scope={issue.scope} />}
          <BlockedIndicator issue={issue} allIssues={allIssues} onIssueClick={onIssueClick} />
          {issue.assignee && (
            <Tooltip content={issue.assignee} position="top">
              {(tp) => (
                <span {...tp} onClick={e => e.stopPropagation()}>
                  <Avatar size="xsmall" name={issue.assignee ?? undefined} />
                </span>
              )}
            </Tooltip>
          )}
        </div>
      )}
      {/* Last checkin preview */}
      {lastCheckin && (
        <div style={{
          fontSize: 11,
          color: 'var(--ds-text-subtlest)',
          fontStyle: 'italic',
          marginTop: 5,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
        }}>
          {lastCheckin.what_done.length > 60
            ? lastCheckin.what_done.slice(0, 60) + '…'
            : lastCheckin.what_done}
        </div>
      )}
      {/* Progress bar */}
      {showProgress && (
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: `linear-gradient(to right, var(--ds-background-brand-bold) ${issue.progress}%, var(--ds-surface-sunken) ${issue.progress}%)`,
          borderRadius: '0 0 6px 6px',
        }} />
      )}
    </div>
  );
}

// ── Inline ticket creator ──────────────────────────────────────────────────────

interface InlineAddProps {
  colStatus: typeof COLS[number];
  sprintId: string | null | undefined;
  onCreated?: () => void;
}

function InlineAdd({ colStatus, sprintId, onCreated }: InlineAddProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleOpen = () => {
    setOpen(true);
    setTitle('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleCancel = () => {
    setOpen(false);
    setTitle('');
  };

  const handleSubmit = async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await fetch('/api/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed, status: colStatus, sprint_id: sprintId ?? null }),
      });
      onCreated?.();
    } catch {
      // Silently ignore
    } finally {
      setSubmitting(false);
      setOpen(false);
      setTitle('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { handleSubmit(); }
    if (e.key === 'Escape') { handleCancel(); }
  };

  if (!open) {
    return (
      <button
        onClick={handleOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          width: '100%',
          background: 'none',
          border: 'none',
          borderRadius: 4,
          padding: '5px 6px',
          fontSize: 12,
          color: 'var(--ds-text-subtlest)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'inherit',
          transition: 'color .12s, background .12s',
          flexShrink: 0,
          marginTop: 2,
        }}
        onMouseOver={e => {
          (e.currentTarget as HTMLElement).style.color = 'var(--ds-text)';
          (e.currentTarget as HTMLElement).style.background = 'var(--ds-background-neutral-hovered)';
        }}
        onMouseOut={e => {
          (e.currentTarget as HTMLElement).style.color = 'var(--ds-text-subtlest)';
          (e.currentTarget as HTMLElement).style.background = 'none';
        }}
      >
        <span style={{ fontSize: 15, lineHeight: 1, fontWeight: 300 }}>+</span>
        {COL_LABELS[colStatus]}
      </button>
    );
  }

  return (
    <div style={{
      background: 'var(--ds-surface)',
      border: '1px solid var(--ds-border)',
      borderRadius: 6,
      padding: '8px 10px',
      flexShrink: 0,
      marginTop: 2,
    }}>
      <input
        ref={inputRef}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ticket title…"
        disabled={submitting}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--ds-background-input)',
          border: '1px solid var(--ds-border-input)',
          borderRadius: 4,
          color: 'var(--ds-text)',
          fontSize: 13,
          fontFamily: 'inherit',
          padding: '5px 8px',
          outline: 'none',
        }}
      />
      <div style={{ marginTop: 5, fontSize: 11, color: 'var(--ds-text-subtlest)' }}>
        Press Enter to add · Esc to cancel
      </div>
    </div>
  );
}

// ── Column ────────────────────────────────────────────────────────────────────

interface ColumnProps {
  col: typeof COLS[number];
  issues: Issue[];
  allIssues: Issue[];
  onStatusChange?: (issueId: string, status: string) => void;
  onIssueClick?: (issue: Issue) => void;
  selectedIds?: string[];
  onSelect?: (id: string, value: boolean) => void;
  compact?: boolean;
  onIssueCreated?: () => void;
  activeSprintId?: string | null;
  wipLimit?: number;
  totalCount?: number;
  focusMode?: boolean;
  sortMode?: string;
  onSortChange?: (col: string, mode: string) => void;
  stalenessBands?: boolean;
}

function Column({ col, issues, allIssues, onStatusChange, onIssueClick, selectedIds, onSelect, compact, onIssueCreated, activeSprintId, wipLimit, totalCount, focusMode, sortMode, onSortChange, stalenessBands }: ColumnProps) {
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

  const count = totalCount ?? issues.length;
  const wipOver = wipLimit != null && count > wipLimit;
  const wipAt = wipLimit != null && count === wipLimit;

  // Focus mode: show DONE column as a collapsed "N done" chip
  if (focusMode && col === 'DONE') {
    const doneCount = issues.length;
    if (doneCount === 0) return null;
    return (
      <div style={{
        background: 'var(--ds-surface-sunken)',
        border: '1px solid var(--ds-border)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        opacity: 0.6,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px 8px',
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
            textTransform: 'uppercase', flex: 1, color: colorMap[col],
          }}>
            {COL_LABELS[col]}
          </span>
          <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', fontStyle: 'italic' }}>
            ✓ {doneCount} hidden
          </span>
        </div>
      </div>
    );
  }

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
        <select
          value={sortMode ?? 'creation'}
          onChange={async (e) => {
            const mode = e.target.value;
            await fetch('/api/workspace/board_sort', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ column: col, mode }),
            }).catch(() => {});
            onSortChange?.(col, mode);
          }}
          onClick={e => e.stopPropagation()}
          style={{
            fontSize: 11, background: 'transparent', border: 'none',
            color: 'var(--ds-text-subtlest)', cursor: 'pointer', outline: 'none',
            fontFamily: 'inherit',
          }}
        >
          <option value="creation">Date ↑</option>
          <option value="priority">Priority</option>
          <option value="weight">Weight</option>
          <option value="updated">Updated</option>
          <option value="scope">Scope</option>
          <option value="sessions">Sessions</option>
        </select>
        <Badge appearance="default">{issues.length}</Badge>
        {/* WIP limit badge */}
        {wipLimit != null && (wipOver || wipAt) && (
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 10,
            background: wipOver ? 'var(--ds-background-danger-bold)' : 'var(--ds-background-warning-bold)',
            color: 'var(--ds-text-inverse)',
            flexShrink: 0,
          }}>
            {count}/{wipLimit}
          </span>
        )}
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
        ) : (() => {
          const sortedIssues = sortIssues(issues, sortMode ?? 'creation');

          if (!stalenessBands) {
            return sortedIssues.map(issue => (
              <IssueCard
                key={issue.id}
                issue={issue}
                allIssues={allIssues}
                onStatusChange={onStatusChange}
                onIssueClick={onIssueClick}
                isSelected={selectedIds?.includes(issue.id)}
                onSelect={onSelect}
                compact={compact}
                focusMode={focusMode}
              />
            ));
          }

          const fresh = sortedIssues.filter(i => getStalenessGroup(i) === 'fresh');
          const aging = sortedIssues.filter(i => getStalenessGroup(i) === 'aging')
            .sort((a, b) => getAgeInStatus(b) - getAgeInStatus(a));
          const stale = sortedIssues.filter(i => getStalenessGroup(i) === 'stale')
            .sort((a, b) => getAgeInStatus(b) - getAgeInStatus(a));

          const divider = (key: string) => (
            <div key={key} style={{ height: 1, background: 'var(--ds-border)', margin: '4px 0' }} />
          );

          const makeCard = (issue: Issue, group: 'fresh' | 'aging' | 'stale') => {
            const days = Math.floor(getAgeInStatus(issue));
            const ageChip = group !== 'fresh' ? (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '1px 4px', borderRadius: 3, flexShrink: 0,
                background: group === 'aging' ? 'var(--ds-background-warning-bold)' : 'var(--ds-background-danger-bold)',
                color: '#fff',
              }}>
                {days}d
              </span>
            ) : null;

            const leftBorderStyle: React.CSSProperties = group === 'aging'
              ? { borderLeft: '3px solid var(--ds-border-warning)' }
              : group === 'stale'
              ? { borderLeft: '3px solid var(--ds-border-danger)', opacity: 0.75 }
              : {};

            return (
              <div key={issue.id} style={{ position: 'relative', ...leftBorderStyle }}>
                <IssueCard
                  issue={issue}
                  allIssues={allIssues}
                  onStatusChange={onStatusChange}
                  onIssueClick={onIssueClick}
                  isSelected={selectedIds?.includes(issue.id)}
                  onSelect={onSelect}
                  compact={compact}
                  focusMode={focusMode}
                />
                {ageChip && (
                  <div style={{ position: 'absolute', bottom: 6, right: 8, pointerEvents: 'none' }}>
                    {ageChip}
                  </div>
                )}
              </div>
            );
          };

          const result: React.ReactNode[] = [];
          fresh.forEach(i => result.push(makeCard(i, 'fresh')));
          if (aging.length > 0 || stale.length > 0) result.push(divider('div-aging'));
          aging.forEach(i => result.push(makeCard(i, 'aging')));
          if (stale.length > 0) result.push(divider('div-stale'));
          stale.forEach(i => result.push(makeCard(i, 'stale')));
          return result;
        })()}
        {col !== 'DONE' && (
          <InlineAdd
            colStatus={col}
            sprintId={activeSprintId}
            onCreated={onIssueCreated}
          />
        )}
      </div>
    </div>
  );
}

// ── Swimlane ──────────────────────────────────────────────────────────────────

interface SwimlaneProps {
  issues: Issue[];
  allIssues: Issue[];
  onStatusChange?: (issueId: string, status: string) => void;
  onIssueClick?: (issue: Issue) => void;
  selectedIds?: string[];
  onSelect?: (id: string, value: boolean) => void;
  compact?: boolean;
  focusMode?: boolean;
}

function Swimlane({ issues, allIssues, onStatusChange, onIssueClick, selectedIds, onSelect, compact, focusMode }: SwimlaneProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const epicGroups = new Map<string | null, Issue[]>();
  for (const issue of issues) {
    const key = issue.epic_id ?? null;
    if (!epicGroups.has(key)) epicGroups.set(key, []);
    epicGroups.get(key)!.push(issue);
  }

  const epicIds = [...epicGroups.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const ea = allIssues.find(i => i.id === a);
    const eb = allIssues.find(i => i.id === b);
    return (ea?.title ?? a).localeCompare(eb?.title ?? b);
  });

  const pendingCount = (epicId: string | null): number => {
    const group = epicGroups.get(epicId) ?? [];
    return group.filter(i => i.status !== 'DONE').length;
  };

  const toggleCollapsed = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', padding: '12px 24px 24px', flex: 1, minHeight: 0 }}>
      {epicIds.map(epicId => {
        const key = epicId ?? '__no_epic__';
        const isCollapsed = collapsed.has(key);
        const epic = epicId ? allIssues.find(i => i.id === epicId) : null;
        const epicTitle = epic?.title ?? epicId ?? 'No Epic';
        const epicStatus = epic?.status ?? null;
        const pending = pendingCount(epicId);
        const groupIssues = epicGroups.get(epicId) ?? [];
        const byStatus = Object.fromEntries(
          COLS.map(col => [col, groupIssues.filter(i => i.status === col)])
        ) as Record<typeof COLS[number], Issue[]>;

        return (
          <div
            key={key}
            style={{
              background: 'var(--ds-surface-sunken)',
              border: '1px solid var(--ds-border)',
              borderRadius: 8,
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {/* Collapsible header */}
            <button
              onClick={() => toggleCollapsed(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 14px',
                width: '100%',
                background: 'var(--ds-surface)',
                cursor: 'pointer',
                border: 'none',
                borderBottom: isCollapsed ? 'none' : '1px solid var(--ds-border)',
                textAlign: 'left',
                fontFamily: 'inherit',
                lineHeight: 'inherit',
              }}
            >
              <span style={{
                fontSize: 12, color: 'var(--ds-text-subtlest)', flexShrink: 0,
                transition: 'transform 0.15s',
                transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                display: 'inline-block',
              }}>▾</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {epicTitle}
              </span>
              {epicStatus && (
                <Lozenge appearance={STATUS_APPEARANCE[epicStatus] ?? 'default'}>
                  {epicStatus}
                </Lozenge>
              )}
              {!epicId && (
                <Lozenge appearance="default">No Epic</Lozenge>
              )}
              <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', flexShrink: 0 }}>
                {pending} pending · {groupIssues.length} total
              </span>
            </button>

            {!isCollapsed && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 8,
              padding: 8,
            }}>
              {COLS.map(col => {
                const colIssues = byStatus[col];
                return (
                  <div key={col} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: col === 'TODO' ? 'var(--ds-text-subtlest)'
                        : col === 'IN_PROGRESS' ? 'var(--ds-link)'
                        : col === 'REVIEW' ? 'var(--ds-text-warning)'
                        : 'var(--ds-text-success)',
                      padding: '2px 4px',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      {COL_LABELS[col]}
                      <Badge appearance="default">{colIssues.length}</Badge>
                    </div>
                    {colIssues.map(issue => (
                      <IssueCard
                        key={issue.id}
                        issue={issue}
                        allIssues={allIssues}
                        onStatusChange={onStatusChange}
                        onIssueClick={onIssueClick}
                        isSelected={selectedIds?.includes(issue.id)}
                        onSelect={onSelect}
                        compact={compact ?? true}
                        focusMode={focusMode}
                      />
                    ))}
                    {colIssues.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', padding: '4px 4px', fontStyle: 'italic' }}>
                        —
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────────

interface Props {
  issues: Issue[];
  allIssues: Issue[];
  subTitle: string;
  sprintGoal?: string;
  onStatusChange?: (issueId: string, status: string) => void;
  onIssueClick?: (issue: Issue) => void;
  onBulkAction?: (ids: string[], action: string) => void;
  onIssueCreated?: () => void;
  activeSprintId?: string | null;
  wip_limits?: Record<string, number>;
  boardSort?: Record<string, string>;
  onBoardSortChange?: () => void;
}

export default function Board({ issues, allIssues, subTitle, sprintGoal, onStatusChange, onIssueClick, onBulkAction, onIssueCreated, activeSprintId, wip_limits, boardSort, onBoardSortChange }: Props) {
  const [goalDismissed, setGoalDismissed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compact, setCompact] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [swimlane, setSwimlane] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [stalenessBands, setStalenessBands] = useState(false);
  const [localSort, setLocalSort] = useState<Record<string, string>>(boardSort ?? {});

  const byStatus = Object.fromEntries(
    COLS.map(col => [col, issues.filter(i => i.status === col)])
  ) as Record<typeof COLS[number], Issue[]>;

  // For WIP limit counting: use allIssues for unfiltered counts
  const allByStatus = Object.fromEntries(
    COLS.map(col => [col, allIssues.filter(i => i.status === col)])
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

  const doneCnt = byStatus['DONE'].length;

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
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-text)', cursor: 'pointer' }}>
            <Toggle
              isChecked={swimlane}
              onChange={e => setSwimlane(e.target.checked)}
              size="regular"
            />
            Swimlane
          </label>
          {/* Focus mode button */}
          <button
            onClick={() => setFocusMode(m => !m)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: focusMode ? 'var(--ds-background-brand-bold)' : 'var(--ds-surface-sunken)',
              border: '1px solid var(--ds-border)',
              borderRadius: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              color: focusMode ? 'var(--ds-text-inverse)' : 'var(--ds-text-subtle)',
              fontSize: 13,
              fontFamily: 'inherit',
              transition: 'background .15s, color .15s',
            }}
          >
            <span>👁</span>
            {focusMode
              ? (doneCnt > 0 ? `All tickets (✓ ${doneCnt} hidden)` : 'All tickets')
              : 'Focus mode'}
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ds-text)', cursor: 'pointer' }}>
            <Toggle
              isChecked={stalenessBands}
              onChange={e => setStalenessBands(e.target.checked)}
              size="regular"
            />
            ⏱ Age
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
      {swimlane ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
          <Swimlane
            issues={issues}
            allIssues={allIssues}
            onStatusChange={onStatusChange}
            onIssueClick={onIssueClick}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            compact={compact}
            focusMode={focusMode}
          />
        </div>
      ) : (
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
              allIssues={allIssues}
              onStatusChange={onStatusChange}
              onIssueClick={onIssueClick}
              selectedIds={selectedIds}
              onSelect={handleSelect}
              compact={compact}
              onIssueCreated={onIssueCreated}
              activeSprintId={activeSprintId}
              wipLimit={wip_limits?.[col]}
              totalCount={allByStatus[col].length}
              focusMode={focusMode}
              sortMode={localSort[col] ?? boardSort?.[col] ?? 'creation'}
              onSortChange={(c, mode) => {
                setLocalSort(prev => ({ ...prev, [c]: mode }));
                onBoardSortChange?.();
              }}
              stalenessBands={stalenessBands}
            />
          ))}
        </div>
      )}
    </div>
  );
}
