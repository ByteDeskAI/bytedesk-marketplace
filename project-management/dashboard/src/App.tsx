import { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Board from './components/Board';
import Backlog from './components/Backlog';
import Docs from './components/Docs';
import Activity from './components/Activity';
import SkeletonBoard from './components/SkeletonBoard';
import EpicTreeView from './components/EpicTreeView';
import SprintActionsModal from './components/SprintActionsModal';
import IssueCalendarView from './components/IssueCalendarView';
import { api, createSSE } from './api';
import type { ViewId, Issue, Doc, Dashboard, ActivityEntry } from './types';
import { FlagGroup, AutoDismissFlag } from '@atlaskit/flag';
import Button from '@atlaskit/button';
import TicketDetailDrawer from './components/TicketDetailDrawer';
import CreateTicketModal from './components/CreateTicketModal';
import PlanView from './components/PlanView';

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

  // Tab nav helpers
  const isEpicsTab = showEpics && !showCalendar;
  const isCalendarTab = showCalendar && !showEpics;
  const isViewTab = (v: ViewId) => !showEpics && !showCalendar && view === v;

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
              onClick={() => { setShowCalendar(false); setShowEpics(true); }}
            >
              Epics
            </button>
            <button
              style={tabStyle(isCalendarTab)}
              onClick={() => { setShowEpics(false); setShowCalendar(true); }}
            >
              Calendar
            </button>
            <button
              style={tabStyle(!showEpics && !showCalendar && view === 'plan')}
              onClick={() => { setShowEpics(false); setShowCalendar(false); setView('plan'); }}
            >
              Plan
            </button>

            {/* Create button pushed to right */}
            {(!showEpics && !showCalendar && (view === 'board' || view === 'backlog')) && (
              <div style={{ marginLeft: 'auto' }}>
                <Button appearance="primary" onClick={() => setShowCreateTicket(true)}>Create issue</Button>
              </div>
            )}
          </div>

          {/* Views */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {!showEpics && !showCalendar && view === 'board' && (
              <Board
                issues={issues}
                subTitle={subTitle}
                sprintGoal={sprintGoal}
                onStatusChange={handleStatusChange}
                onIssueClick={(issue) => setSelectedIssue(issue)}
                onBulkAction={handleBulkAction}
              />
            )}
            {!showEpics && !showCalendar && view === 'backlog' && (
              <Backlog
                issues={issues}
                onBulkAction={handleBulkAction}
              />
            )}
            {!showEpics && !showCalendar && view === 'docs' && (
              <Docs
                docs={docs}
                activeDocId={activeDocId}
                onDocSelect={id => setActiveDocId(id)}
                onDocClose={() => setActiveDocId(null)}
                onRefresh={fetchDocs}
              />
            )}
            {!showEpics && !showCalendar && view === 'activity' && (
              <Activity activity={activity} />
            )}

            {showEpics && !showCalendar && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ds-text)', marginBottom: 16 }}>Epics</h1>
                <EpicTreeView issues={issues} onIssueClick={(issue) => setSelectedIssue(issue)} />
              </div>
            )}

            {showCalendar && !showEpics && (
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--ds-text)', marginBottom: 16 }}>Calendar</h1>
                <IssueCalendarView issues={issues} />
              </div>
            )}

            {!showEpics && !showCalendar && view === 'plan' && (
              <PlanView />
            )}
          </div>
        </main>
      </div>

      <TicketDetailDrawer issue={selectedIssue} onClose={() => setSelectedIssue(null)} />
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
    </div>
  );
}
