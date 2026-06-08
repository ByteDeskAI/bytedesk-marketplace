import { useState, useEffect } from 'react';
import TerminalPanel from './TerminalPanel';
import Drawer from '@atlaskit/drawer';
import Comment, { CommentAuthor, CommentTime } from '@atlaskit/comment';
import Avatar from '@atlaskit/avatar';
import Lozenge from '@atlaskit/lozenge';
import Tag, { SimpleTag } from '@atlaskit/tag';
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
      .catch(() => { setSessionKey(null); });
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

  if (issue === null) return null;

  const isEpic = issue.type === 'epic';
  const children = isEpic
    ? allIssues.filter(i => i.epic_id === issue.id).sort((a, b) => a.id.localeCompare(b.id))
    : [];
  const pendingChildren = children.filter(c => !['DONE', 'REVIEW'].includes(c.status));

  const tags: string[] = [];
  if (issue.priority === 'critical') tags.push('critical');
  if (issue.sprint_id) tags.push('in-sprint');
  else tags.push('backlog');

  const priorityDotColor =
    issue.priority === 'critical' ? '#ff5630'
    : issue.priority === 'high'   ? '#ff8b00'
    : issue.priority === 'medium' ? '#0052cc'
    :                               '#6b778c';

  const runLabel = running ? 'Starting…'
    : isEpic ? (pendingChildren.length > 0 ? `▶ Run Epic (${pendingChildren.length} pending)` : '▶ Re-run Epic')
    : '▶ Run Ticket';

  return (
    <Drawer isOpen={issue !== null} onClose={onClose} width="wide">
      <div style={{ padding: '24px', color: 'var(--ds-text)' }}>
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
                  background: priorityDotColor, flexShrink: 0,
                }} />
                <Lozenge appearance={issue.priority === 'high' || issue.priority === 'critical' ? 'removed' : 'default'}>
                  {issue.priority}
                </Lozenge>
              </span>
            )}
          </Tooltip>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <TagGroup>{tags.map(t => <SimpleTag key={t} text={t} />)}</TagGroup>
          </div>
        )}

        {/* Description */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text-subtle)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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

        {/* ── Epic children progress ── */}
        {isEpic && children.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ds-text-subtle)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 8 }}>
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
                  opacity: ['DONE', 'REVIEW'].includes(child.status) ? 0.6 : 1,
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
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 }}>
            <span style={{ fontWeight: 700, color: 'var(--ds-text)' }}>Comments</span>
            <Badge appearance={issue.comments.length > 0 ? 'primary' : 'default'}>{issue.comments.length}</Badge>
          </div>
          {issue.comments.length === 0 ? (
            <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--ds-text-subtlest)', fontSize: 14 }}>No comments yet</p>
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

        {/* Terminal */}
        <div style={{ marginTop: 28, borderTop: '1px solid var(--ds-border)', paddingTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontWeight: 700, color: 'var(--ds-text)', fontSize: 15 }}>
              {isEpic ? 'Epic Session' : 'Terminal'}
            </span>
            {sessionKey && (
              <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', background: 'var(--ds-background-brand-bold)', color: '#fff', borderRadius: 10 }}>
                Running
              </span>
            )}
          </div>

          {runError && (
            <div style={{ marginBottom: 12 }}>
              <InlineMessage appearance="error" title="Could not start">
                {runError}
                {runError.includes('tmux') && ' — brew install tmux'}
                {runError.includes('claude CLI') && ' — install from claude.ai/code'}
              </InlineMessage>
            </div>
          )}

          {sessionKey ? (
            <TerminalPanel sessionKey={sessionKey} height={360} onClose={() => setSessionKey(null)} />
          ) : (
            <Button appearance="primary" isDisabled={running} onClick={handleRun}>
              {runLabel}
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  );
}
