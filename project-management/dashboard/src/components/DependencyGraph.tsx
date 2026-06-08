import Lozenge from '@atlaskit/lozenge';
import EmptyState from '@atlaskit/empty-state';
import type { Issue } from '../types';

type LozAppearance = 'default' | 'success' | 'removed' | 'inprogress' | 'moved' | 'new';

const STATUS_APPEARANCE: Record<string, LozAppearance> = {
  TODO: 'default',
  IN_PROGRESS: 'inprogress',
  REVIEW: 'moved',
  DONE: 'success',
  NEEDS_INPUT: 'removed',
};

const RESOLVED_STATUSES = new Set(['DONE', 'REVIEW']);

interface Props {
  issues: Issue[];
  onIssueClick: (issue: Issue) => void;
}

// ── Clickable ticket row ──────────────────────────────────────────────────────

interface TicketRowProps {
  issue: Issue;
  dimmed?: boolean;
  onClick: (issue: Issue) => void;
}

function TicketRow({ issue, dimmed, onClick }: TicketRowProps) {
  return (
    <button
      onClick={() => onClick(issue)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'none',
        border: 'none',
        padding: '4px 0',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        opacity: dimmed ? 0.45 : 1,
        transition: 'opacity 0.15s',
      }}
      onMouseOver={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
      onMouseOut={e => { (e.currentTarget as HTMLElement).style.opacity = dimmed ? '0.45' : '1'; }}
    >
      <span style={{
        fontFamily: 'monospace',
        fontSize: 11,
        color: 'var(--ds-link)',
        fontWeight: 600,
        flexShrink: 0,
      }}>
        {issue.id}
      </span>
      <span style={{
        fontSize: 13,
        color: 'var(--ds-text)',
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {issue.title}
      </span>
      <Lozenge appearance={STATUS_APPEARANCE[issue.status] ?? 'default'}>
        {issue.status}
      </Lozenge>
    </button>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      fontSize: 13,
      fontWeight: 700,
      color: 'var(--ds-text-subtle)',
      letterSpacing: '.04em',
      textTransform: 'uppercase',
      margin: '0 0 12px',
    }}>
      {children}
    </h2>
  );
}

// ── DependencyGraph ───────────────────────────────────────────────────────────

export default function DependencyGraph({ issues, onIssueClick }: Props) {
  const byId = new Map(issues.map(i => [i.id, i]));

  // Check whether any issue has links at all
  const anyLinks = issues.some(i => i.links && i.links.length > 0);

  if (!anyLinks) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <EmptyState
          header="No dependencies"
          description="Use pm_issue_link to connect tickets."
        />
      </div>
    );
  }

  // ── Blocking chains: issues that have "blocks" links ─────────────────────
  // Group by blocker: blocker id → list of blocked ids
  const blockingMap = new Map<string, string[]>();
  for (const issue of issues) {
    if (!issue.links) continue;
    for (const link of issue.links) {
      if (link.type === 'blocks') {
        if (!blockingMap.has(link.from_id)) blockingMap.set(link.from_id, []);
        blockingMap.get(link.from_id)!.push(link.to_id);
      }
    }
  }

  // ── Blocked issues: issues with "is-blocked-by" links ────────────────────
  interface BlockedEntry {
    issue: Issue;
    blockerIds: string[];
  }
  const blockedEntries: BlockedEntry[] = [];
  for (const issue of issues) {
    if (!issue.links) continue;
    const blockerIds = issue.links
      .filter(l => l.type === 'is-blocked-by')
      .map(l => l.to_id);
    if (blockerIds.length > 0) {
      blockedEntries.push({ issue, blockerIds });
    }
  }

  const blockingChainEntries = [...blockingMap.entries()];

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 32px' }}>
      {/* Page header */}
      <div style={{
        marginBottom: 28,
        paddingBottom: 20,
        borderBottom: '1px solid var(--ds-border)',
      }}>
        <h1 style={{
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--ds-text)',
          margin: '0 0 4px',
          lineHeight: 1.2,
        }}>
          Dependencies
        </h1>
        <p style={{
          fontSize: 14,
          color: 'var(--ds-text-subtle)',
          margin: 0,
          lineHeight: 1.5,
        }}>
          Issue link network — blocking chains and blocked tickets
        </p>
      </div>

      {/* Blocking chains section */}
      {blockingChainEntries.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <SectionHeading>Dependency chains</SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {blockingChainEntries.map(([blockerId, blockedIds]) => {
              const blocker = byId.get(blockerId);
              return (
                <div
                  key={blockerId}
                  style={{
                    background: 'var(--ds-surface-raised)',
                    border: '1px solid var(--ds-border)',
                    borderRadius: 6,
                    padding: '12px 16px',
                  }}
                >
                  {/* Blocker row */}
                  {blocker ? (
                    <TicketRow issue={blocker} onClick={onIssueClick} />
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--ds-text-subtlest)', padding: '4px 0' }}>
                      {blockerId} (not in current view)
                    </div>
                  )}
                  {/* Arrow + blocked targets */}
                  <div style={{
                    paddingLeft: 16,
                    marginTop: 6,
                    borderLeft: '2px solid var(--ds-border-bold)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', marginBottom: 2, fontWeight: 600 }}>
                      blocks &rarr;
                    </div>
                    {blockedIds.map(bid => {
                      const blocked = byId.get(bid);
                      return blocked ? (
                        <TicketRow key={bid} issue={blocked} onClick={onIssueClick} />
                      ) : (
                        <div key={bid} style={{ fontSize: 12, color: 'var(--ds-text-subtlest)', padding: '3px 0' }}>
                          {bid} (external)
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Separator */}
      {blockingChainEntries.length > 0 && blockedEntries.length > 0 && (
        <hr style={{ border: 'none', borderTop: '1px solid var(--ds-border)', margin: '0 0 28px' }} />
      )}

      {/* Blocked issues section */}
      {blockedEntries.length > 0 && (
        <section>
          <SectionHeading>Blocked issues</SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {blockedEntries.map(({ issue, blockerIds }) => {
              // Determine whether all blockers are resolved (DONE or REVIEW)
              const allResolved = blockerIds.every(bid => {
                const b = byId.get(bid);
                return b ? RESOLVED_STATUSES.has(b.status) : false;
              });

              return (
                <div
                  key={issue.id}
                  style={{
                    background: 'var(--ds-surface-raised)',
                    border: '1px solid var(--ds-border)',
                    borderRadius: 6,
                    padding: '12px 16px',
                    opacity: allResolved ? 0.55 : 1,
                  }}
                >
                  <TicketRow issue={issue} onClick={onIssueClick} />
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 6,
                    flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--ds-text-subtlest)', fontWeight: 600 }}>
                      Blocked by:
                    </span>
                    {blockerIds.map(bid => {
                      const blocker = byId.get(bid);
                      const resolved = blocker ? RESOLVED_STATUSES.has(blocker.status) : false;
                      return (
                        <button
                          key={bid}
                          onClick={() => { if (blocker) onIssueClick(blocker); }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: blocker ? 'pointer' : 'default',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <span style={{
                            fontFamily: 'monospace',
                            fontSize: 11,
                            color: resolved ? 'var(--ds-text-subtlest)' : 'var(--ds-text-danger)',
                            fontWeight: 600,
                            textDecoration: resolved ? 'line-through' : 'none',
                          }}>
                            {bid}
                          </span>
                          {resolved && (
                            <span style={{ fontSize: 10, color: 'var(--ds-text-subtlest)', fontStyle: 'italic' }}>
                              resolved
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
