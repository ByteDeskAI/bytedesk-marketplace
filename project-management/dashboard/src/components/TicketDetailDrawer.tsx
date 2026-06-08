import { useState, useEffect } from 'react';
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
import { Issue } from '../types';

const STATUS_APPEARANCE: Record<string, 'default' | 'inprogress' | 'moved' | 'success' | 'removed'> = {
  TODO: 'default',
  IN_PROGRESS: 'inprogress',
  REVIEW: 'moved',
  DONE: 'success',
};

const DETAIL_WIDTH = 480;
const TERMINAL_WIDTH = 560;

const spring = { type: 'spring' as const, damping: 28, stiffness: 260 };

interface Props {
  issue: Issue | null;
  allIssues: Issue[];
  onClose: () => void;
}

export default function TicketDetailDrawer({ issue, allIssues, onClose }: Props) {
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    if (!issue) { setSessionKey(null); setRunError(null); return; }
    fetch(`/api/run/${issue.id}`)
      .then(r => r.json())
      .then((body: { ok: boolean; status?: string }) => {
        setSessionKey(body.ok && body.status && body.status !== 'gone' ? issue.id : null);
      })
      .catch(() => setSessionKey(null));
  }, [issue?.id]);

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

  const runLabel = running ? 'Starting…'
    : isEpic ? (pendingChildren.length > 0 ? `▶ Run Epic (${pendingChildren.length} pending)` : '▶ Re-run Epic')
    : '▶ Run Ticket';

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

          {/* Drawer container — slides in from left as a unit */}
          <motion.div
            key="drawer"
            initial={{ x: -(DETAIL_WIDTH + TERMINAL_WIDTH) }}
            animate={{ x: 0 }}
            exit={{ x: -(DETAIL_WIDTH + TERMINAL_WIDTH) }}
            transition={spring}
            style={{
              position: 'fixed', top: 0, left: 0, bottom: 0,
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

              <div style={{ padding: '8px 24px 24px' }}>
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

                {/* Status / Type / Priority */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
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
                </div>

                {/* Tags */}
                <div style={{ marginBottom: 20 }}>
                  <TagGroup>
                    {issue.priority === 'critical' && <SimpleTag text="critical" />}
                    <SimpleTag text={issue.sprint_id ? 'in-sprint' : 'backlog'} />
                  </TagGroup>
                </div>

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

                {/* Comments */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ds-text)' }}>Comments</span>
                    <Badge appearance={issue.comments.length > 0 ? 'primary' : 'default'}>{issue.comments.length}</Badge>
                  </div>
                  {issue.comments.length === 0 ? (
                    <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--ds-text-subtlest)', fontSize: 13 }}>No comments yet</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {issue.comments.map(c => (
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

                {/* Run button (only shown when no session) */}
                {!sessionKey && (
                  <div style={{ borderTop: '1px solid var(--ds-border)', paddingTop: 20 }}>
                    {runError && (
                      <div style={{ marginBottom: 12 }}>
                        <InlineMessage appearance="error" title="Could not start">
                          {runError}
                          {runError.includes('tmux') && ' — brew install tmux'}
                          {runError.includes('claude CLI') && ' — install from claude.ai/code'}
                        </InlineMessage>
                      </div>
                    )}
                    <Button appearance="primary" isDisabled={running} onClick={handleRun}>
                      {runLabel}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Terminal panel — slides in from the right ── */}
            <AnimatePresence>
              {sessionKey && (
                <motion.div
                  key="terminal"
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: TERMINAL_WIDTH, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={spring}
                  style={{
                    overflow: 'hidden',
                    borderLeft: '1px solid var(--ds-border)',
                    background: '#0d1117',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Terminal header */}
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

                  {/* Terminal body */}
                  <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    <TerminalPanel
                      sessionKey={sessionKey}
                      onClose={() => setSessionKey(null)}
                    />
                  </div>

                  {/* Re-run button when session dismissed or errored */}
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
