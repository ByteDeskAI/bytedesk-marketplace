import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import TerminalPanel from './TerminalPanel';
import Comment, { CommentAuthor, CommentTime } from '@atlaskit/comment';
import Avatar from '@atlaskit/avatar';
import Lozenge from '@atlaskit/lozenge';
import { SimpleTag } from '@atlaskit/tag';
import TagGroup from '@atlaskit/tag-group';
import Tooltip from '@atlaskit/tooltip';
import InlineMessage from '@atlaskit/inline-message';
import Badge from '@atlaskit/badge';
import Button from '@atlaskit/button';
import SectionMessage from '@atlaskit/section-message';
import { Checkbox } from '@atlaskit/checkbox';
import type { Issue, ChecklistItem } from '../types';

const STATUS_APPEARANCE: Record<string, 'default' | 'inprogress' | 'moved' | 'success' | 'removed'> = {
  TODO: 'default',
  IN_PROGRESS: 'inprogress',
  REVIEW: 'moved',
  DONE: 'success',
  NEEDS_INPUT: 'moved',
  DRAFT: 'default',
};

const DETAIL_WIDTH = 480;

const spring = { type: 'spring' as const, damping: 28, stiffness: 260 };

type DrawerTab = 'details' | 'comments' | 'activity' | 'commits';

interface Props {
  issue: Issue | null;
  allIssues: Issue[];
  onClose: () => void;
  onRefresh?: () => void;
}

export default function TicketDetailDrawer({ issue, allIssues, onClose, onRefresh }: Props) {
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DrawerTab>('details');
  const [flagActioning, setFlagActioning] = useState(false);
  const [criteriaUpdating, setCriteriaUpdating] = useState(false);
  const [checklistUpdating, setChecklistUpdating] = useState(false);
  const [sessionSummariesOpen, setSessionSummariesOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Array<{snapshot_id: string; label: string; created_at: string}>>([]);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [takingSnapshot, setTakingSnapshot] = useState(false);

  // Reset tab when the issue changes
  useEffect(() => {
    setActiveTab('details');
  }, [issue?.id]);

  useEffect(() => {
    if (!issue) { setSessionKey(null); setRunError(null); return; }
    fetch(`/api/run/${issue.id}`)
      .then(r => r.json())
      .then((body: { ok: boolean; status?: string }) => {
        setSessionKey(body.ok && body.status && body.status !== 'gone' ? issue.id : null);
      })
      .catch(() => setSessionKey(null));
  }, [issue?.id]);

  const fetchSnapshots = useCallback((issueId: string) => {
    fetch(`/api/issues/${issueId}/snapshots`)
      .then(r => r.json())
      .then((b: {ok: boolean; snapshots: Array<{snapshot_id: string; label: string; created_at: string}>}) => {
        if (b.ok) setSnapshots(b.snapshots ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!issue) { setSnapshots([]); return; }
    fetchSnapshots(issue.id);
  }, [issue?.id, fetchSnapshots]);

  const handleRun = async () => {
    if (!issue) return;
    setRunning(true);
    setRunError(null);
    try {
      const r = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: issue.id }),
      });
      const body = await r.json() as { ok: boolean; session_key?: string; error?: string };
      if (body.ok && body.session_key) {
        setSessionKey(body.session_key);
      } else {
        setRunError(body.error ?? 'Failed to start session');
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setRunning(false);
    }
  };

  // Feature 1: handle flagged-option selection
  const handleFlagOption = async (option: string) => {
    if (!issue) return;
    setFlagActioning(true);
    try {
      await fetch('/api/issues/' + issue.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'IN_PROGRESS',
          comment: 'Human selected: ' + option,
          flagged_reason: null,
          flagged_options: [],
        }),
      });
      onRefresh?.();
      onClose();
    } catch {
      // silently fall through
    } finally {
      setFlagActioning(false);
    }
  };

  // Feature 2: toggle acceptance criterion
  const handleCriteriaToggle = async (index: number, checked: boolean) => {
    if (!issue || criteriaUpdating) return;
    setCriteriaUpdating(true);
    const currentDone = issue.criteria_done || [];
    const newDone = checked
      ? [...new Set([...currentDone, index])]
      : currentDone.filter(i => i !== index);
    try {
      await fetch('/api/issues/' + issue.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria_done: newDone }),
      });
      onRefresh?.();
    } catch {
      // silently ignore
    } finally {
      setCriteriaUpdating(false);
    }
  };

  // Checklist toggle
  const handleChecklistToggle = async (itemId: number, checked: boolean) => {
    if (!issue || checklistUpdating) return;
    setChecklistUpdating(true);
    const checklist = (issue.checklist ?? []).map(item =>
      item.id === itemId
        ? { ...item, done: checked, done_at: checked ? new Date().toISOString() : null }
        : item
    );
    try {
      await fetch('/api/issues/' + issue.id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklist }),
      });
      onRefresh?.();
    } catch {
      // silently ignore
    } finally {
      setChecklistUpdating(false);
    }
  };

  const isEpic = issue?.type === 'epic';
  const children = isEpic && issue
    ? allIssues.filter(i => i.epic_id === issue.id).sort((a, b) => a.id.localeCompare(b.id))
    : [];
  const pendingChildren = children.filter(c => !['DONE', 'REVIEW'].includes(c.status));

  const priorityDotColor = (priority: string) =>
    priority === 'critical' ? '#ff5630'
    : priority === 'high'   ? '#ff8b00'
    : priority === 'medium' ? '#0052cc'
    :                         '#6b778c';

  const hasPriorSessions = (issue?.session_summaries || []).length > 0;
  const isRetryMode = hasPriorSessions && !sessionKey;

  const runLabel = running ? 'Starting…'
    : isRetryMode ? '↺ Retry (with prior context)'
    : isEpic ? (pendingChildren.length > 0 ? `▶ Run Epic (${pendingChildren.length} pending)` : '▶ Re-run Epic')
    : '▶ Run Ticket';

  const runAppearance = isRetryMode ? 'default' : 'primary';

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid var(--ds-background-brand-bold, #0C66E4)' : '2px solid transparent',
    color: active ? 'var(--ds-link, #0C66E4)' : 'var(--ds-text-subtle, #626F86)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    padding: '8px 12px',
    lineHeight: '20px',
    transition: 'color 0.15s, border-color 0.15s',
    flexShrink: 0,
  });

  const systemAuthors = new Set(['PM Dashboard', 'claude-session']);
  const activityComments = [...(issue?.comments || [])]
    .filter(c => systemAuthors.has(c.author))
    .reverse();

  const criteria = issue?.acceptance_criteria || [];
  const criteriaDone = issue?.criteria_done || [];
  const sessionSummaries = issue?.session_summaries || [];
  const commitLinks = issue?.commit_links || [];
  const checklist = issue?.checklist ?? [];
  const checklistDone = checklist.filter(i => i.done).length;
  const issueTags = issue?.tags ?? [];

  return (
    <AnimatePresence>
      {issue && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(9,30,66,0.54)',
              zIndex: 499,
            }}
          />

          {/* Drawer container */}
          <motion.div
            key="drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={spring}
            style={{
              position: 'fixed', top: 0, left: 0, bottom: 0, right: 0,
              display: 'flex', flexDirection: 'row',
              zIndex: 500,
              boxShadow: '4px 0 24px rgba(0,0,0,0.4)',
            }}
          >
            {/* ── Details panel ── */}
            <div style={{
              width: DETAIL_WIDTH,
              background: 'var(--ds-surface)',
              overflowY: 'auto',
              borderRight: '1px solid var(--ds-border)',
              display: 'flex',
              flexDirection: 'column',
            }}>
              {/* Close button */}
              <div style={{
                display: 'flex', justifyContent: 'flex-start',
                padding: '12px 16px 0', flexShrink: 0,
              }}>
                <button
                  onClick={onClose}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--ds-text-subtle)', fontSize: 20, lineHeight: 1,
                    padding: '4px 8px', borderRadius: 4,
                  }}
                  title="Close"
                >
                  ×
                </button>
              </div>

              {/* Risk banner — above NEEDS_INPUT */}
              {issue.risk && (
                <div style={{ padding: '0 24px 8px' }}>
                  <SectionMessage
                    appearance="error"
                    title={`⚠ Risk: ${issue.risk.type.replace(/_/g, ' ')}`}
                  >
                    <p style={{ margin: 0 }}>{issue.risk.reason}</p>
                  </SectionMessage>
                </div>
              )}

              {/* NEEDS_INPUT banner */}
              {issue.status === 'NEEDS_INPUT' && (
                <div style={{ padding: '0 24px 8px' }}>
                  <SectionMessage
                    appearance="warning"
                    title="Needs your input — Claude is blocked"
                  >
                    {issue.flagged_reason && (
                      <p style={{ margin: '0 0 12px' }}>{issue.flagged_reason}</p>
                    )}
                    {(issue.flagged_options || []).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {(issue.flagged_options || []).map((opt, idx) => (
                          <Button
                            key={idx}
                            appearance="default"
                            spacing="compact"
                            isDisabled={flagActioning}
                            onClick={() => handleFlagOption(opt)}
                          >
                            {opt}
                          </Button>
                        ))}
                      </div>
                    )}
                  </SectionMessage>
                </div>
              )}

              <div style={{ padding: '8px 24px 0' }}>
                {/* ID */}
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--ds-link)', fontWeight: 600 }}>
                    {issue.id}
                  </span>
                </div>

                {/* Title */}
                <h2 style={{ margin: '0 0 16px', fontSize: 20, fontWeight: 600, color: 'var(--ds-text)', lineHeight: 1.3 }}>
                  {issue.title}
                </h2>

                {/* Status / Type / Priority row */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                  <Lozenge isBold appearance={STATUS_APPEARANCE[issue.status] ?? 'default'}>{issue.status}</Lozenge>
                  <Lozenge appearance="new">{issue.type}</Lozenge>
                  <Tooltip content={'Priority: ' + issue.priority}>
                    {(tp) => (
                      <span {...tp} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                          background: priorityDotColor(issue.priority), flexShrink: 0,
                        }} />
                        <Lozenge appearance={issue.priority === 'high' || issue.priority === 'critical' ? 'removed' : 'default'}>
                          {issue.priority}
                        </Lozenge>
                      </span>
                    )}
                  </Tooltip>
                  {/* Reopen count badge */}
                  {(issue.reopen_count ?? 0) > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--ds-text-warning)' }}>
                      ↩ Reopened {issue.reopen_count}×
                    </span>
                  )}
                </div>

                {/* Assignee */}
                <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--ds-text-subtle)' }}>
                  Assignee: {issue.assignee ?? 'Unassigned'}
                </div>

                {/* Tags (from issue.tags field) */}
                {issueTags.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <TagGroup>
                      {issueTags.map(tag => (
                        <SimpleTag key={tag} text={tag} />
                      ))}
                    </TagGroup>
                  </div>
                )}
                {/* Fall back to derived tags if no issue.tags */}
                {issueTags.length === 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <TagGroup>
                      {issue.priority === 'critical' && <SimpleTag text="critical" />}
                      <SimpleTag text={issue.sprint_id ? 'in-sprint' : 'backlog'} />
                    </TagGroup>
                  </div>
                )}
              </div>

              {/* Tab strip */}
              <div style={{
                display: 'flex',
                borderBottom: '1px solid var(--ds-border)',
                padding: '0 24px',
                flexShrink: 0,
              }}>
                <button style={tabStyle(activeTab === 'details')} onClick={() => setActiveTab('details')}>Details</button>
                <button style={tabStyle(activeTab === 'comments')} onClick={() => setActiveTab('comments')}>
                  Comments
                  {(issue.comments || []).length > 0 && (
                    <span style={{ marginLeft: 5 }}>
                      <Badge appearance="primary">{issue.comments.length}</Badge>
                    </span>
                  )}
                </button>
                <button style={tabStyle(activeTab === 'activity')} onClick={() => setActiveTab('activity')}>Activity</button>
                <button style={tabStyle(activeTab === 'commits')} onClick={() => setActiveTab('commits')}>
                  Commits
                  {commitLinks.length > 0 && (
                    <span style={{ marginLeft: 5 }}>
                      <Badge appearance="default">{commitLinks.length}</Badge>
                    </span>
                  )}
                </button>
              </div>

              <div style={{ padding: '16px 24px 24px', flex: 1 }}>

                {/* ── Details tab ── */}
                {activeTab === 'details' && (
                  <>
                    {/* Handoff banner */}
                    {issue.handoff && issue.status === 'IN_PROGRESS' && (
                      <div style={{ marginBottom: 16 }}>
                        <SectionMessage
                          appearance="information"
                          title="Session paused — handoff recorded"
                        >
                          <p style={{ margin: '0 0 6px' }}>{issue.handoff.next_step}</p>
                          {issue.handoff.files_in_progress.length > 0 && (
                            <p style={{ margin: 0, fontSize: 12, color: 'var(--ds-text-subtle)' }}>
                              Start in: {issue.handoff.files_in_progress.join(', ')}
                            </p>
                          )}
                        </SectionMessage>
                      </div>
                    )}

                    {/* Description */}
                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-text-subtle)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Description
                      </div>
                      {issue.description ? (
                        <div style={{ fontSize: 14, color: 'var(--ds-text)', lineHeight: 1.6, background: 'var(--ds-surface-raised)', borderRadius: 4, padding: 12 }}>
                          {issue.description}
                        </div>
                      ) : (
                        <InlineMessage appearance="info" title="No description" secondaryText="Use Claude: /pm:ticket [ID] --desc text" />
                      )}
                    </div>

                    {/* Feature 2: Acceptance criteria */}
                    {criteria.length > 0 && (
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Acceptance Criteria
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>
                            {criteriaDone.length} / {criteria.length} done
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {criteria.map((criterion, idx) => {
                            const isDone = criteriaDone.includes(idx);
                            return (
                              <div
                                key={idx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 8,
                                  padding: '6px 10px',
                                  background: 'var(--ds-surface-raised)',
                                  borderRadius: 4,
                                  border: '1px solid var(--ds-border)',
                                }}
                              >
                                <div style={{ flexShrink: 0, marginTop: 1 }}>
                                  <Checkbox
                                    isChecked={isDone}
                                    isDisabled={criteriaUpdating}
                                    onChange={(e) => handleCriteriaToggle(idx, e.currentTarget.checked)}
                                    label=""
                                  />
                                </div>
                                <span style={{
                                  fontSize: 13,
                                  color: isDone ? 'var(--ds-text-subtlest)' : 'var(--ds-text)',
                                  lineHeight: 1.5,
                                  textDecoration: isDone ? 'line-through' : 'none',
                                  flex: 1,
                                }}>
                                  {criterion}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Checklist section */}
                    {checklist.length > 0 && (
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            Checklist
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--ds-text-subtlest)' }}>
                            {checklistDone} / {checklist.length} done
                          </span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {checklist.map(item => (
                            <div
                              key={item.id}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 8,
                                padding: '5px 10px',
                                background: 'var(--ds-surface-raised)',
                                borderRadius: 4,
                                border: '1px solid var(--ds-border)',
                              }}
                            >
                              <div style={{ flexShrink: 0, marginTop: 1 }}>
                                <Checkbox
                                  isChecked={item.done}
                                  isDisabled={checklistUpdating}
                                  onChange={(e) => handleChecklistToggle(item.id, e.currentTarget.checked)}
                                  label=""
                                />
                              </div>
                              <span style={{
                                fontSize: 13,
                                color: item.done ? 'var(--ds-text-subtlest)' : 'var(--ds-text)',
                                lineHeight: 1.5,
                                textDecoration: item.done ? 'line-through' : 'none',
                                flex: 1,
                              }}>
                                {item.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Epic children */}
                    {isEpic && children.length > 0 && (
                      <div style={{ marginBottom: 24 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ds-text-subtle)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 8 }}>
                          Child Tickets
                          <Badge appearance={pendingChildren.length > 0 ? 'primary' : 'default'}>
                            {pendingChildren.length} pending
                          </Badge>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {children.map(child => (
                            <div key={child.id} style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              padding: '8px 12px',
                              background: 'var(--ds-surface-raised)',
                              borderRadius: 4,
                              border: '1px solid var(--ds-border)',
                              opacity: ['DONE', 'REVIEW'].includes(child.status) ? 0.55 : 1,
                              transition: 'opacity 0.2s',
                            }}>
                              <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--ds-link)', fontWeight: 600, flexShrink: 0 }}>
                                {child.id}
                              </span>
                              <span style={{ fontSize: 13, color: 'var(--ds-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {child.title}
                              </span>
                              <Lozenge appearance={STATUS_APPEARANCE[child.status] ?? 'default'}>
                                {child.status}
                              </Lozenge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Snapshots section */}
                    <div style={{ marginTop: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <button
                          onClick={() => setSnapshotsOpen(o => !o)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ds-text-subtle)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          {snapshotsOpen ? '▾' : '▸'} Snapshots ({snapshots.length})
                        </button>
                        <button
                          onClick={async () => {
                            if (!issue || takingSnapshot) return;
                            setTakingSnapshot(true);
                            const label = `Pre-session ${new Date().toLocaleDateString()}`;
                            try {
                              await fetch(`/api/issues/${issue.id}/snapshot`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ label }),
                              });
                              fetchSnapshots(issue.id);
                            } catch {
                              // silently ignore
                            } finally {
                              setTakingSnapshot(false);
                            }
                          }}
                          style={{
                            background: 'var(--ds-surface-sunken)', border: '1px solid var(--ds-border)',
                            borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 11,
                            color: 'var(--ds-text-subtle)',
                          }}
                          disabled={takingSnapshot}
                        >
                          {takingSnapshot ? 'Saving…' : '📸 Save snapshot'}
                        </button>
                      </div>
                      {snapshotsOpen && snapshots.length > 0 && (
                        <div style={{ background: 'var(--ds-surface-sunken)', borderRadius: 6, padding: 10 }}>
                          {snapshots.map(snap => (
                            <div key={snap.snapshot_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--ds-border)' }}>
                              <span style={{ flex: 1, fontSize: 12, color: 'var(--ds-text-subtle)' }}>{snap.label || snap.snapshot_id.slice(-8)}</span>
                              <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)' }}>{new Date(snap.created_at).toLocaleDateString()}</span>
                              <button
                                onClick={async () => {
                                  if (!issue) return;
                                  if (!confirm(`Restore to snapshot "${snap.label || snap.snapshot_id}"? This overwrites current state.`)) return;
                                  try {
                                    await fetch(`/api/issues/${issue.id}/snapshot/restore`, {
                                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ snapshot_id: snap.snapshot_id }),
                                    });
                                  } catch {
                                    // silently ignore
                                  }
                                  onRefresh?.();
                                  onClose();
                                }}
                                style={{
                                  background: 'none', border: '1px solid var(--ds-border)', borderRadius: 4,
                                  padding: '1px 6px', cursor: 'pointer', fontSize: 11, color: 'var(--ds-text-danger)',
                                }}
                              >
                                Restore
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* ── Comments tab ── */}
                {activeTab === 'comments' && (
                  <div>
                    {(issue.comments || []).length === 0 ? (
                      <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--ds-text-subtlest)', fontSize: 13 }}>No comments yet</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {(issue.comments || []).map(c => (
                          <Comment
                            key={c.id}
                            avatar={<Avatar size="small" name={c.author} />}
                            author={<CommentAuthor>{c.author}</CommentAuthor>}
                            time={<CommentTime>{c.created_at}</CommentTime>}
                            content={<p style={{ margin: 0 }}>{c.body}</p>}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Activity tab ── */}
                {activeTab === 'activity' && (
                  <div>
                    {activityComments.length === 0 ? (
                      <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--ds-text-subtlest)', fontSize: 13 }}>No system activity recorded yet</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {activityComments.map(c => (
                          <div key={c.id} style={{
                            padding: '8px 12px',
                            background: 'var(--ds-surface-raised)',
                            borderRadius: 4,
                            border: '1px solid var(--ds-border)',
                            borderLeft: '3px solid var(--ds-border-bold)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', fontStyle: 'italic' }}>
                                {c.author}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)' }}>·</span>
                              <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)' }}>{c.created_at}</span>
                            </div>
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-text-subtle)', fontStyle: 'italic', lineHeight: 1.5 }}>
                              {c.body}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Commits tab ── */}
                {activeTab === 'commits' && (
                  <div>
                    {commitLinks.length === 0 ? (
                      <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--ds-text-subtlest)', fontSize: 13 }}>No commits linked yet.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {commitLinks.map(commit => (
                          <div key={commit.sha} style={{
                            padding: '10px 12px',
                            background: 'var(--ds-surface-raised)',
                            borderRadius: 4,
                            border: '1px solid var(--ds-border)',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <code style={{
                                fontFamily: 'monospace',
                                fontSize: 12,
                                background: 'var(--ds-surface-sunken)',
                                padding: '1px 5px',
                                borderRadius: 3,
                                color: 'var(--ds-link)',
                                flexShrink: 0,
                              }}>
                                {commit.short_sha}
                              </code>
                              {commit.url && (
                                <a
                                  href={commit.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', marginLeft: 'auto', textDecoration: 'none' }}
                                >
                                  ↗
                                </a>
                              )}
                            </div>
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--ds-text)', lineHeight: 1.5 }}>
                              {commit.message}
                            </p>
                            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ds-text-subtlest)' }}>
                              {commit.created_at}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Run button area */}
                {activeTab === 'details' && !sessionKey && (
                  <div style={{ borderTop: '1px solid var(--ds-border)', paddingTop: 20, marginTop: 8 }}>
                    {runError && (
                      <div style={{ marginBottom: 12 }}>
                        <InlineMessage appearance="error" title="Could not start">
                          {runError}
                          {runError.includes('tmux') && ' — brew install tmux'}
                          {runError.includes('claude CLI') && ' — install from claude.ai/code'}
                        </InlineMessage>
                      </div>
                    )}
                    <Button appearance={runAppearance} isDisabled={running} onClick={handleRun}>
                      {runLabel}
                    </Button>

                    {/* Prior session summaries */}
                    {sessionSummaries.length > 0 && (
                      <div style={{ marginTop: 16 }}>
                        <details
                          open={sessionSummariesOpen}
                          onToggle={(e) => setSessionSummariesOpen((e.target as HTMLDetailsElement).open)}
                          style={{ borderRadius: 4, border: '1px solid var(--ds-border)', overflow: 'hidden' }}
                        >
                          <summary style={{
                            cursor: 'pointer',
                            padding: '8px 12px',
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'var(--ds-text-subtle)',
                            background: 'var(--ds-surface-raised)',
                            userSelect: 'none',
                            listStyle: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}>
                            <span style={{ fontSize: 10, color: 'var(--ds-text-subtlest)' }}>
                              {sessionSummariesOpen ? '▼' : '▶'}
                            </span>
                            Prior session summaries
                            <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--ds-text-subtlest)', fontWeight: 400 }}>
                              ({sessionSummaries.length})
                            </span>
                          </summary>
                          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {sessionSummaries.map((s, idx) => (
                              <div key={idx} style={{
                                borderTop: idx > 0 ? '1px solid var(--ds-border)' : 'none',
                                paddingTop: idx > 0 ? 12 : 0,
                              }}>
                                <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', marginBottom: 4 }}>
                                  {s.created_at}
                                </div>
                                <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--ds-text)', lineHeight: 1.5 }}>
                                  {s.summary}
                                </p>
                                {s.files_changed && s.files_changed.length > 0 && (
                                  <div style={{ marginBottom: 6 }}>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ds-text-subtlest)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>
                                      Files changed
                                    </div>
                                    {s.files_changed.map((f, fi) => (
                                      <div key={fi} style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--ds-text-subtle)', lineHeight: 1.6 }}>
                                        {f}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {s.tests_added && s.tests_added.length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ds-text-subtlest)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>
                                      Tests added
                                    </div>
                                    {s.tests_added.map((t, ti) => (
                                      <div key={ti} style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--ds-text-subtle)', lineHeight: 1.6 }}>
                                        {t}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* ── Terminal panel ── */}
            <AnimatePresence>
              {sessionKey && (
                <motion.div
                  key="terminal"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={spring}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    borderLeft: '1px solid var(--ds-border)',
                    background: '#0d1117',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <div style={{
                    flexShrink: 0,
                    padding: '10px 16px',
                    borderBottom: '1px solid var(--ds-border)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: '#161b22',
                  }}>
                    <span style={{ fontWeight: 700, color: '#e6edf3', fontSize: 13 }}>
                      {isEpic ? 'Epic Session' : 'Terminal'}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 7px',
                      background: 'var(--ds-background-brand-bold)',
                      color: '#fff', borderRadius: 10,
                    }}>
                      Running
                    </span>
                    <div style={{ flex: 1 }} />
                    <button
                      onClick={() => setSessionKey(null)}
                      title="Dismiss terminal"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#8b949e', fontSize: 18, lineHeight: 1, padding: '2px 6px', borderRadius: 4,
                      }}
                    >
                      ×
                    </button>
                  </div>

                  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <TerminalPanel
                      sessionKey={sessionKey}
                      onClose={() => setSessionKey(null)}
                    />
                  </div>

                  {runError && (
                    <div style={{ flexShrink: 0, padding: 12, borderTop: '1px solid var(--ds-border)' }}>
                      <InlineMessage appearance="error" title="Could not start">{runError}</InlineMessage>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
