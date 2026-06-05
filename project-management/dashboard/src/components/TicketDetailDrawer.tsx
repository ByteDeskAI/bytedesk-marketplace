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

interface CommentData {
  id: number;
  author: string;
  body: string;
  created_at: string;
}

interface IssueData {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  sprint_id?: string | null;
  comments: CommentData[];
}

interface Props {
  issue: IssueData | null;
  onClose: () => void;
}

export default function TicketDetailDrawer({ issue, onClose }: Props) {
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  useEffect(() => {
    if (!issue) { setSessionKey(null); setRunError(null); return; }
    fetch(`/api/run/${issue.id}`)
      .then(r => r.json())
      .then((body: { ok: boolean; status?: string }) => {
        if (body.ok && body.status && body.status !== 'gone') {
          setSessionKey(issue.id);
        } else {
          setSessionKey(null);
        }
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

  // derive tags
  const tags: string[] = [];
  if (issue.priority === 'critical') tags.push('critical');
  if (issue.sprint_id) tags.push('in-sprint');
  else tags.push('backlog');

  // Priority dot colour helper
  const priorityDotColor =
    issue.priority === 'critical'
      ? '#ff5630'
      : issue.priority === 'high'
      ? '#ff8b00'
      : issue.priority === 'medium'
      ? '#0052cc'
      : '#6b778c';

  return (
    <Drawer isOpen={issue !== null} onClose={onClose} width="wide">
      <div style={{ padding: '24px', color: 'var(--ds-text)' }}>
        {/* Issue ID */}
        <div style={{ marginBottom: '8px' }}>
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '13px',
              color: 'var(--ds-link)',
              fontWeight: 600,
            }}
          >
            {issue.id}
          </span>
        </div>

        {/* Title */}
        <h2
          style={{
            margin: '0 0 16px 0',
            fontSize: '20px',
            fontWeight: 600,
            color: 'var(--ds-text)',
            lineHeight: 1.3,
          }}
        >
          {issue.title}
        </h2>

        {/* Status / Type / Priority lozenges */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <Lozenge isBold>{issue.status}</Lozenge>
          <Lozenge appearance="new">{issue.type}</Lozenge>
          {/* CHANGE 6 — tooltip on priority lozenge dot */}
          <Tooltip content={'Priority: ' + issue.priority}>
            {(tp) => (
              <span {...tp} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: priorityDotColor,
                    flexShrink: 0,
                  }}
                />
                <Lozenge
                  appearance={
                    issue.priority === 'high' || issue.priority === 'critical' ? 'removed' : 'default'
                  }
                >
                  {issue.priority}
                </Lozenge>
              </span>
            )}
          </Tooltip>
        </div>

        {/* CHANGE 1 — Tags derived from issue state */}
        {tags.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <TagGroup>
              {tags.map((t) => (
                <SimpleTag key={t} text={t} />
              ))}
            </TagGroup>
          </div>
        )}

        {/* Description */}
        <div style={{ marginBottom: '20px' }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              color: 'var(--ds-text-subtle)',
              marginBottom: '6px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Description
          </div>
          {issue.description ? (
            <div
              style={{
                fontSize: '14px',
                color: 'var(--ds-text)',
                lineHeight: 1.6,
                background: 'var(--ds-surface-raised)',
                borderRadius: '4px',
                padding: '12px',
              }}
            >
              {issue.description}
            </div>
          ) : (
            /* CHANGE 4 — InlineMessage when description is empty */
            <InlineMessage
              appearance="info"
              title="No description"
              secondaryText="Use Claude: /pm:ticket [ID] --desc text"
            />
          )}
        </div>

        {/* Comments section — CHANGE 5: Badge on heading */}
        <div style={{ marginTop: '28px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 16,
              marginBottom: 8,
            }}
          >
            <span style={{ fontWeight: 700, color: 'var(--ds-text)' }}>Comments</span>
            <Badge
              appearance={issue.comments.length > 0 ? 'primary' : 'default'}
            >
              {issue.comments.length}
            </Badge>
          </div>

          {issue.comments.length === 0 ? (
            <p style={{ margin: 0, fontStyle: 'italic', color: 'var(--ds-text-subtlest)', fontSize: '14px' }}>
              No comments yet
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {issue.comments.map((c) => (
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

        {/* Terminal section */}
        <div style={{ marginTop: 28, borderTop: '1px solid var(--ds-border)', paddingTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontWeight: 700, color: 'var(--ds-text)', fontSize: 15 }}>Terminal</span>
            {issue.status === 'IN_PROGRESS' && sessionKey && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '2px 7px',
                background: 'var(--ds-background-brand-bold)',
                color: '#fff', borderRadius: 10,
              }}>Running</span>
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
            <TerminalPanel
              sessionKey={sessionKey}
              height={300}
              onClose={() => setSessionKey(null)}
            />
          ) : (
            <Button
              appearance="primary"
              isDisabled={running}
              onClick={handleRun}
            >
              {running ? 'Starting…' : '▶ Run Ticket'}
            </Button>
          )}
        </div>
      </div>
    </Drawer>
  );
}
