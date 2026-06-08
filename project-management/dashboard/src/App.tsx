import { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Board from './components/Board';
import Backlog from './components/Backlog';
import KeyboardTriage from './components/KeyboardTriage';
import Docs from './components/Docs';
import Activity from './components/Activity';
import SkeletonBoard from './components/SkeletonBoard';
import EpicTreeView from './components/EpicTreeView';
import SprintActionsModal from './components/SprintActionsModal';
import IssueCalendarView from './components/IssueCalendarView';
import DependencyGraph from './components/DependencyGraph';
import SavedFilters from './components/SavedFilters';
import { api, createSSE } from './api';
import type { ViewId, Issue, Doc, Dashboard, ActivityEntry } from './types';
import { FlagGroup, AutoDismissFlag } from '@atlaskit/flag';
import Button from '@atlaskit/button';
import ModalDialog, { ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@atlaskit/modal-dialog';
import Lozenge from '@atlaskit/lozenge';
import TicketDetailDrawer from './components/TicketDetailDrawer';
import CreateTicketModal from './components/CreateTicketModal';
import PlanView from './components/PlanView';
import CommandPalette from './components/CommandPalette';

interface StandupIssueEntry {
  id: string;
  title: string;
  status: string;
}

interface StandupData {
  done: StandupIssueEntry[];
  in_progress: StandupIssueEntry[];
  new_issues: StandupIssueEntry[];
}

export default function App() {
  const [view, setView] = useState<ViewId>('board');
  const [live, setLive] = useState(false);

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [showCreateTicket, setShowCreateTicket] = useState(false);
  const [flags, setFlags] = useState<Array<{ id: number; title: string; description: string }>>([]);
  const flagCounter = useRef(0);

  const [showSprintComplete, setShowSprintComplete] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showEpics, setShowEpics] = useState(false);
  const [showDependencies, setShowDependencies] = useState(false);

  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [filterCriteria, setFilterCriteria] = useState<Record<string, string>>({});

  const [showStandup, setShowStandup] = useState(false);
  const [standupData, setStandupData] = useState<StandupData | null>(null);
  const [standupLoading, setStandupLoading] = useState(false);

  const fetchStatus = useCallback(() => {
    api.status().then(r => {
      if (r.ok) {
        setDashboard(r.dashboard);
        setIssues(r.issues);
        setActivity(r.activity);
        document.title = `${r.dashboard.project_name} — Dashboard`;
        setLoading(false);
      } else {
        // Not initialized — stop the skeleton and show an empty board
        setLoading(false);
      }
    }).catch(() => { setLoading(false); });
  }, []);

  const fetchDocs = useCallback(() => {
    api.docs().then(r => {
      if (r.ok) setDocs(r.documents);
    }).catch(() => {});
  }, []);

  const fetchStandup = useCallback(async () => {
    setStandupLoading(true);
    try {
      const r = await fetch('/api/sprint/standup?since_hours=24');
      const data = await r.json() as { done?: StandupIssueEntry[]; in_progress?: StandupIssueEntry[]; new_issues?: StandupIssueEntry[] };
      setStandupData({
        done: data.done ?? [],
        in_progress: data.in_progress ?? [],
        new_issues: data.new_issues ?? [],
      });
    } catch {
      setStandupData({ done: [], in_progress: [], new_issues: [] });
    } finally {
      setStandupLoading(false);
    }
  }, []);

  const handleStatusChange = useCallback(async (issueId: string, newStatus: string) => {
    try {
      await fetch('/api/issues/' + issueId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {}
    fetchStatus();
  }, [fetchStatus]);

  const handleBulkAction = useCallback(async (ids: string[], action: string) => {
    try {
      await Promise.all(ids.map(id =>
        fetch('/api/issues/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: action }),
        })
      ));
    } catch {}
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
    fetchDocs();

    const stop = createSSE(raw => {
      fetchStatus();
      try {
        const ev = JSON.parse(raw) as { type: string; payload: Record<string, string> };
        if (ev.type?.startsWith('doc_')) fetchDocs();
        const p = ev.payload ?? {};
        const msgs: Record<string, string> = {
          issue_created: (p.id ?? '') + ': ' + (p.title ?? ''),
          issue_updated: (p.id ?? '') + ' updated',
          doc_created: 'Page: ' + (p.title ?? ''),
          sprint_started: 'Sprint started: ' + (p.id ?? ''),
          sprint_completed: 'Sprint completed: ' + (p.id ?? ''),
        };
        if (msgs[ev.type] !== undefined) {
          const actionLabel = ev.type.replace(/_/g, ' ');
          flagCounter.current = flagCounter.current + 1;
          const fid = flagCounter.current;
          setFlags(f => [...f, { id: fid, title: actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1), description: msgs[ev.type] }]);
        }
      } catch { fetchDocs(); }
    }, () => setLive(true), () => setLive(false));

    const interval = setInterval(() => { fetchStatus(); fetchDocs(); }, 30_000);

    const onError = () => setLive(false);
    window.addEventListener('offline', onError);

    return () => {
      stop();
      clearInterval(interval);
      window.removeEventListener('offline', onError);
    };
  }, [fetchStatus, fetchDocs]);

  // Restore active doc from hash
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('doc:')) setActiveDocId(hash.slice(4));
    if (hash === 'backlog') setView('backlog');
    if (hash === 'docs') setView('docs');
    if (hash === 'activity') setView('activity');
  }, []);

  const sp = dashboard?.sprint_progress;
  const todoCnt = issues.filter(i => i.status === 'TODO').length;
  const doneCnt = issues.filter(i => i.status === 'DONE').length;
  const subTitle = sp
    ? `${sp.done_tickets ?? doneCnt} done · ${sp.total_tickets ?? issues.length} issues`
    : '';

  const sprintParts = (dashboard?.active_sprint ?? '').split(' -- ');
  const sprintGoal = sprintParts.length > 1 ? sprintParts.slice(1).join(' -- ') : undefined;

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <div style={{ height: 56, background: '#1C2B41', flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 240, background: '#1C2B41', flexShrink: 0 }} />
        <main style={{ flex: 1, padding: '60px 24px' }}><SkeletonBoard /></main>
      </div>
    </div>
  );

  // Apply saved filter criteria to the issue list for Board/Backlog
  const filteredIssues = activeFilter
    ? issues.filter(issue => {
        for (const [key, value] of Object.entries(filterCriteria)) {
          if (key === 'status' && issue.status !== value) return false;
          if (key === 'type' && issue.type !== value) return false;
          if (key === 'priority' && issue.priority !== value) return false;
          if (key === 'scope' && issue.scope !== value) return false;
        }
        return true;
      })
    : issues;

  // Tab nav helpers
  const isEpicsTab = showEpics && !showCalendar && !showDependencies;
  const isCalendarTab = showCalendar && !showEpics && !showDependencies;
  const isDependenciesTab = showDependencies && !showEpics && !showCalendar;
  const isViewTab = (v: ViewId) => !showEpics && !showCalendar && !showDependencies && view === v;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid var(--ds-background-brand-bold, #0C66E4)' : '2px solid transparent',
    color: active ? 'var(--ds-link, #0C66E4)' : 'var(--ds-text-subtle, #626F86)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    padding: '8px 14px',
    lineHeight: '20px',
    transition: 'color 0.15s, border-color 0.15s',
  });

  const switchToView = (v: ViewId) => {
    setShowEpics(false);
    setShowCalendar(false);
    setShowDependencies(false);
    setView(v);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', fontFamily: 'var(--ds-font-family-body, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)' }}>
      {/* Global pulse animation */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-thumb { background: var(--ds-border-bold); border-radius: 3px; }
        button:focus-visible { outline: 2px solid var(--ds-border-focused); outline-offset: 2px; }
      `}</style>

      <Header
        dashboard={dashboard}
        live={live}
        onCompleteSprint={() => setShowSprintComplete(true)}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar
          view={view}
          onView={setView}
          keyPrefix={dashboard?.key_prefix ?? ''}
          todoCnt={todoCnt}
          doneCnt={doneCnt}
          totalIssues={issues.length}
          docs={docs}
          activeDocId={activeDocId}
          onDoc={id => { setActiveDocId(id); switchToView('docs'); }}
        />

        <main style={{ flex: 1, overflow: 'hidden', background: 'var(--ds-surface)', display: 'flex', flexDirection: 'column' }}>
          {/* Tab nav strip */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            padding: '0 24px',
            borderBottom: '1px solid var(--ds-border, #DFE1E6)',
            flexShrink: 0,
            background: 'var(--ds-surface)',
          }}>
            <button style={tabStyle(isViewTab('board'))} onClick={() => switchToView('board')}>Board</button>
            <button style={tabStyle(isViewTab('backlog'))} onClick={() => switchToView('backlog')}>Backlog</button>
            <button style={tabStyle(isViewTab('docs'))} onClick={() => switchToView('docs')}>Docs</button>
            <button style={tabStyle(isViewTab('activity'))} onClick={() => switchToView('activity')}>Activity</button>
            <button
              style={tabStyle(isEpicsTab)}
              onClick={() => { setShowCalendar(false); setShowDependencies(false); setShowEpics(true); }}
            >
              Epics
            </button>
            <button
              style={tabStyle(isCalendarTab)}
              onClick={() => { setShowEpics(false); setShowDependencies(false); setShowCalendar(true); }}
            >
              Calendar
            </button>
            <button
              style={tabStyle(isDependenciesTab)}
              onClick={() => { setShowEpics(false); setShowCalendar(false); setShowDependencies(true); }}
            >
              Dependencies
            </button>
            <button
              style={tabStyle(isViewTab('plan'))}
              onClick={() => { setShowEpics(false); setShowCalendar(false); setShowDependencies(false); setView('plan'); }}
            >
              Plan
            </button>

            {/* Right-side actions */}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                appearance="subtle"
                onClick={async () => {
                  setShowStandup(true);
                  await fetchStandup();
                }}
              >
                Standup
              </Button>
              {(!showEpics && !showCalendar && !showDependencies && (view === 'board' || view === 'backlog')) && (
                <Button appearance="primary" onClick={() => setShowCreateTicket(true)}>Create issue</Button>
              )}
            </div>
          </div>

          {/* Saved filters chip bar — shown below tab strip on Board and Backlog */}
          {(!showEpics && !showCalendar && !showDependencies && (view === 'board' || view === 'backlog')) && (
            <SavedFilters
              activeFilter={activeFilter}
              onFilterApply={(name, criteria) => {
                setActiveFilter(name);
                setFilterCriteria(criteria);
              }}
              onFilterClear={() => {
                setActiveFilter(null);
                setFilterCriteria({});
              }}
            />
          )}

          {/* Views */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {!showEpics && !showCalendar && !showDependencies && view === 'board' && (
              <Board
                issues={filteredIssues}
                allIssues={issues}
                subTitle={subTitle}
                sprintGoal={sprintGoal}
                onStatusChange={handleStatusChange}
                onIssueClick={(issue) => setSelectedIssue(issue)}
                onBulkAction={handleBulkAction}
                onIssueCreated={fetchStatus}
                activeSprintId={dashboard?.active_sprint_id ?? null}
              />
            )}
            {!showEpics && !showCalendar && !showDependencies && view === 'backlog' && (
              <Backlog
                issues={filteredIssues}
                onBulkAction={handleBulkAction}
              />
            )}
            {!showEpics && !showCalendar && !showDependencies && view === 'docs' && (
              <Docs
                docs={docs}
                activeDocId={activeDocId}
                onDocSelect={id => setActiveDocId(id)}
                onDocClose={() => setActiveDocId(null)}
                onRefresh={fetchDocs}
              />
            )}
            {!showEpics && !showCalendar && !showDependencies && view === 'activity' && (
              <Activity activity={activity} />
            )}

            {showDependencies && !showEpics && !showCalendar && (
              <DependencyGraph issues={issues} onIssueClick={(issue) => setSelectedIssue(issue)} />
            )}

            {showEpics && !showCalendar && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 32px' }}>
                {/* Page header — follows Atlaskit PageHeader pattern */}
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  marginBottom: 24,
                  paddingBottom: 20,
                  borderBottom: '1px solid var(--ds-border)',
                }}>
                  <div>
                    <h1 style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: 'var(--ds-text)',
                      margin: '0 0 4px',
                      lineHeight: 1.2,
                    }}>
                      Epics
                    </h1>
                    <p style={{
                      fontSize: 14,
                      color: 'var(--ds-text-subtle)',
                      margin: 0,
                      lineHeight: 1.5,
                    }}>
                      Track large bodies of work across multiple sprints and team members
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 12,
                      color: 'var(--ds-text-subtlest)',
                      background: 'var(--ds-surface-sunken)',
                      border: '1px solid var(--ds-border)',
                      borderRadius: 12,
                      padding: '3px 10px',
                      fontWeight: 500,
                    }}>
                      {issues.filter(i => i.type === 'epic').length} epics ·{' '}
                      {issues.filter(i => i.epic_id).length} tasks
                    </span>
                  </div>
                </div>
                <EpicTreeView issues={issues} onIssueClick={(issue) => setSelectedIssue(issue)} />
              </div>
            )}

            {showCalendar && !showEpics && !showDependencies && (
              <IssueCalendarView issues={issues} onIssueClick={issue => setSelectedIssue(issue)} />
            )}

            {!showEpics && !showCalendar && !showDependencies && view === 'plan' && (
              <PlanView />
            )}
          </div>
        </main>
      </div>

      <TicketDetailDrawer issue={selectedIssue} allIssues={issues} onClose={() => setSelectedIssue(null)} onRefresh={fetchStatus} />
      <CreateTicketModal
        isOpen={showCreateTicket}
        onClose={() => setShowCreateTicket(false)}
        onCreated={() => { fetchStatus(); setShowCreateTicket(false); }}
      />

      <SprintActionsModal
        isOpen={showSprintComplete}
        onClose={() => setShowSprintComplete(false)}
        onComplete={() => { setShowSprintComplete(false); fetchStatus(); }}
        sprintName={dashboard?.active_sprint ?? 'Sprint'}
        completedIssues={issues.filter(i => i.status === 'DONE')}
        rolloverIssues={issues.filter(i => i.status !== 'DONE' && Boolean(i.sprint_id))}
        completedPoints={dashboard?.sprint_progress?.done_tickets ?? doneCnt}
        totalPoints={dashboard?.sprint_progress?.total_tickets ?? issues.length}
      />

      {/* Standup Modal */}
      {showStandup && (
        <ModalDialog width="medium" onClose={() => setShowStandup(false)}>
          <ModalHeader>
            <ModalTitle>Standup &mdash; Today</ModalTitle>
          </ModalHeader>
          <ModalBody>
            {standupLoading ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ds-text-subtle)', fontSize: 14 }}>
                Loading&hellip;
              </div>
            ) : standupData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Done / Review */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ds-text-subtle)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>Done / Review</span>
                    <Lozenge appearance="success">{standupData.done.length}</Lozenge>
                  </div>
                  {standupData.done.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--ds-text-subtlest)', fontStyle: 'italic' }}>None</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {standupData.done.map(entry => (
                        <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-link)', fontWeight: 600, flexShrink: 0 }}>{entry.id}</span>
                          <span style={{ color: 'var(--ds-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* In Progress */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ds-text-subtle)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>In Progress</span>
                    <Lozenge appearance="inprogress">{standupData.in_progress.length}</Lozenge>
                  </div>
                  {standupData.in_progress.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--ds-text-subtlest)', fontStyle: 'italic' }}>None</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {standupData.in_progress.map(entry => (
                        <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-link)', fontWeight: 600, flexShrink: 0 }}>{entry.id}</span>
                          <span style={{ color: 'var(--ds-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* New */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ds-text-subtle)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>New</span>
                    <Lozenge appearance="new">{standupData.new_issues.length}</Lozenge>
                  </div>
                  {standupData.new_issues.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--ds-text-subtlest)', fontStyle: 'italic' }}>None</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {standupData.new_issues.map(entry => (
                        <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ds-link)', fontWeight: 600, flexShrink: 0 }}>{entry.id}</span>
                          <span style={{ color: 'var(--ds-text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button appearance="subtle" onClick={() => setShowStandup(false)}>Close</Button>
          </ModalFooter>
        </ModalDialog>
      )}

      <FlagGroup onDismissed={(dismissedId) => setFlags(f => f.filter(x => x.id !== dismissedId))}>
        {flags.map(flag => (
          <AutoDismissFlag
            key={flag.id}
            id={flag.id}
            title={flag.title}
            description={flag.description}
            icon={<span style={{ fontSize: 18 }}>&#10003;</span>}
          />
        ))}
      </FlagGroup>

      <CommandPalette
        issues={issues}
        onIssueClick={(issue) => setSelectedIssue(issue)}
        onView={(v) => switchToView(v)}
        onCreateIssue={() => setShowCreateTicket(true)}
      />
    </div>
  );
}
