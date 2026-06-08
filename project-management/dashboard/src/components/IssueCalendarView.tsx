/**
 * IssueCalendarView — Full-height, full-width calendar grid.
 *
 * Atlaskit design system compliant:
 *  - All colors via var(--ds-*) tokens
 *  - Fills 100% of the parent container (flex: 1, no fixed height)
 *  - Month navigation, issue pills per day, selected-day detail panel
 *  - Today highlighted with --ds-background-selected border
 *  - Out-of-month days dimmed with --ds-text-subtlest
 *
 * NOTE: @atlaskit/calendar is a fixed-width date-picker widget unsuitable
 * for a full-page calendar view. This is a custom implementation using
 * Atlaskit design tokens throughout.
 */

import { useState, useMemo } from 'react';
import Lozenge from '@atlaskit/lozenge';
import Badge from '@atlaskit/badge';
import Button from '@atlaskit/button';
import EmptyState from '@atlaskit/empty-state';
import type { Issue } from '../types';

type LozAppearance = 'default' | 'inprogress' | 'moved' | 'success' | 'removed';

const STATUS_APPEARANCE: Record<string, LozAppearance> = {
  TODO: 'default',
  IN_PROGRESS: 'inprogress',
  REVIEW: 'moved',
  DONE: 'success',
  NEEDS_INPUT: 'removed',
};

const TYPE_COLOR: Record<string, string> = {
  epic:  'var(--ds-background-brand-bold)',
  bug:   'var(--ds-background-danger-bold)',
  story: 'var(--ds-background-discovery-bold)',
  task:  'var(--ds-background-neutral-bold)',
};

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toISO(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function buildCalendarDays(year: number, month: number): Array<{ date: Date; iso: string; inMonth: boolean }> {
  const firstDay = new Date(year, month, 1);
  // Monday-first: getDay() returns 0=Sun → shift so Mon=0
  let startOffset = (firstDay.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);

  const days: Array<{ date: Date; iso: string; inMonth: boolean }> = [];
  // Always render 6 rows × 7 cols = 42 cells for consistent height
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({
      date: d,
      iso: toISO(d.getFullYear(), d.getMonth(), d.getDate()),
      inMonth: d.getMonth() === month,
    });
  }
  return days;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface Props {
  issues: Issue[];
  onIssueClick?: (issue: Issue) => void;
}

export default function IssueCalendarView({ issues, onIssueClick }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selectedIso, setSelectedIso] = useState<string | null>(null);

  const todayIso = toISO(now.getFullYear(), now.getMonth(), now.getDate());

  // Map issues to their created_at date
  const issuesByDate = useMemo<Record<string, Issue[]>>(() => {
    const map: Record<string, Issue[]> = {};
    for (const issue of issues) {
      const key = issue.created_at.slice(0, 10);
      (map[key] ??= []).push(issue);
    }
    return map;
  }, [issues]);

  const days = useMemo(() => buildCalendarDays(year, month), [year, month]);
  const selectedIssues = selectedIso ? (issuesByDate[selectedIso] ?? []) : [];

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }
  function goToday() { setYear(now.getFullYear()); setMonth(now.getMonth()); }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
      background: 'var(--ds-surface)',
    }}>
      {/* ── Page header ── */}
      <div style={{
        padding: '20px 32px 16px',
        flexShrink: 0,
        borderBottom: '1px solid var(--ds-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--ds-text)', margin: 0, lineHeight: 1.2 }}>
          Calendar
        </h1>

        {/* Month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16 }}>
          <button
            onClick={prevMonth}
            style={{
              width: 32, height: 32, borderRadius: 4,
              border: '1px solid var(--ds-border)',
              background: 'transparent',
              color: 'var(--ds-text-subtle)',
              cursor: 'pointer',
              fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Previous month"
          >
            ‹
          </button>
          <span style={{
            fontSize: 16, fontWeight: 600,
            color: 'var(--ds-text)',
            minWidth: 160,
            textAlign: 'center',
          }}>
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            style={{
              width: 32, height: 32, borderRadius: 4,
              border: '1px solid var(--ds-border)',
              background: 'transparent',
              color: 'var(--ds-text-subtle)',
              cursor: 'pointer',
              fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="Next month"
          >
            ›
          </button>
        </div>

        <Button appearance="subtle" onClick={goToday}>Today</Button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>
            {issues.length} issue{issues.length !== 1 ? 's' : ''} this project
          </span>
          {Object.keys(issuesByDate).length > 0 && (
            <Badge>{Object.keys(issuesByDate).length} days with issues</Badge>
          )}
        </div>
      </div>

      {/* ── Calendar grid + optional side panel ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Calendar grid */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* Day-of-week header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            borderBottom: '2px solid var(--ds-border-bold)',
            flexShrink: 0,
          }}>
            {DAYS_OF_WEEK.map(day => (
              <div
                key={day}
                style={{
                  padding: '8px 12px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--ds-text-subtlest)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  textAlign: 'center',
                  borderRight: '1px solid var(--ds-border)',
                }}
              >
                {day}
              </div>
            ))}
          </div>

          {/* 6-row grid */}
          <div style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gridTemplateRows: 'repeat(6, 1fr)',
            overflow: 'hidden',
          }}>
            {days.map(({ date, iso, inMonth }) => {
              const dayIssues = issuesByDate[iso] ?? [];
              const isToday = iso === todayIso;
              const isSelected = iso === selectedIso;
              const dayNum = date.getDate();
              const isSatSun = date.getDay() === 0 || date.getDay() === 6;

              return (
                <div
                  key={iso}
                  onClick={() => setSelectedIso(iso === selectedIso ? null : iso)}
                  style={{
                    borderRight: '1px solid var(--ds-border)',
                    borderBottom: '1px solid var(--ds-border)',
                    padding: '6px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    cursor: 'pointer',
                    background: isSelected
                      ? 'var(--ds-background-selected)'
                      : isSatSun
                      ? 'var(--ds-surface-sunken)'
                      : 'var(--ds-surface)',
                    overflow: 'hidden',
                    transition: 'background 0.1s',
                    position: 'relative',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected)
                      (e.currentTarget as HTMLElement).style.background = 'var(--ds-background-neutral-hovered)';
                  }}
                  onMouseLeave={e => {
                    if (!isSelected)
                      (e.currentTarget as HTMLElement).style.background = isSelected
                        ? 'var(--ds-background-selected)'
                        : isSatSun
                        ? 'var(--ds-surface-sunken)'
                        : 'var(--ds-surface)';
                  }}
                >
                  {/* Date number */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 12,
                      fontWeight: isToday ? 700 : 400,
                      color: isToday
                        ? '#fff'
                        : inMonth
                        ? 'var(--ds-text)'
                        : 'var(--ds-text-subtlest)',
                      background: isToday ? 'var(--ds-background-brand-bold)' : 'transparent',
                      borderRadius: '50%',
                      width: 22, height: 22,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      lineHeight: 1,
                      flexShrink: 0,
                    }}>
                      {dayNum}
                    </span>
                    {dayIssues.length > 0 && (
                      <span style={{
                        fontSize: 10,
                        color: 'var(--ds-text-subtlest)',
                        marginLeft: 2,
                      }}>
                        {dayIssues.length}
                      </span>
                    )}
                  </div>

                  {/* Issue pills (show up to 3) */}
                  {dayIssues.slice(0, 3).map(issue => (
                    <div
                      key={issue.id}
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: '#fff',
                        background: TYPE_COLOR[issue.type] ?? TYPE_COLOR.task,
                        borderRadius: 3,
                        padding: '1px 5px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        lineHeight: '16px',
                        opacity: inMonth ? 1 : 0.5,
                      }}
                      title={`${issue.id}: ${issue.title}`}
                    >
                      {issue.id}
                    </div>
                  ))}

                  {/* Overflow indicator */}
                  {dayIssues.length > 3 && (
                    <span style={{
                      fontSize: 10,
                      color: 'var(--ds-text-subtlest)',
                      paddingLeft: 2,
                    }}>
                      +{dayIssues.length - 3} more
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Selected day detail panel ── */}
        {selectedIso && (
          <div style={{
            width: 280,
            flexShrink: 0,
            borderLeft: '1px solid var(--ds-border)',
            background: 'var(--ds-surface-raised)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Panel header */}
            <div style={{
              padding: '14px 16px',
              borderBottom: '1px solid var(--ds-border)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ds-text)' }}>
                  {new Date(selectedIso + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'long', month: 'long', day: 'numeric',
                  })}
                </div>
                {selectedIssues.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--ds-text-subtle)', marginTop: 2 }}>
                    {selectedIssues.length} issue{selectedIssues.length !== 1 ? 's' : ''} created
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelectedIso(null)}
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer', color: 'var(--ds-text-subtlest)',
                  fontSize: 16, lineHeight: 1, padding: '2px 4px',
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Issue list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {selectedIssues.length === 0 ? (
                <p style={{ fontSize: 13, color: 'var(--ds-text-subtlest)', textAlign: 'center', padding: '24px 0' }}>
                  No issues created on this date.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedIssues.map(issue => (
                    <div
                      key={issue.id}
                      onClick={() => onIssueClick?.(issue)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 4,
                        background: 'var(--ds-surface)',
                        border: '1px solid var(--ds-border)',
                        cursor: onIssueClick ? 'pointer' : 'default',
                        transition: 'border-color 0.1s',
                      }}
                      onMouseEnter={e => { if (onIssueClick) (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-border-selected)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--ds-border)'; }}
                    >
                      {/* ID + type */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                          background: TYPE_COLOR[issue.type] ?? TYPE_COLOR.task,
                        }} />
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-link)', fontWeight: 600 }}>
                          {issue.id}
                        </span>
                        <Lozenge appearance={STATUS_APPEARANCE[issue.status] ?? 'default'}>
                          {issue.status.replace('_', ' ')}
                        </Lozenge>
                      </div>

                      {/* Title */}
                      <div style={{
                        fontSize: 13, color: 'var(--ds-text)', lineHeight: 1.4,
                        display: '-webkit-box', WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                      }}>
                        {issue.title}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty state when no issues at all */}
        {issues.length === 0 && !selectedIso && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <EmptyState
              header="No issues yet"
              description="Issues will appear on the dates they were created."
            />
          </div>
        )}
      </div>
    </div>
  );
}
