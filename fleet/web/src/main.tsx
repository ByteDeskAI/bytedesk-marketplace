// SPA entry. Hash-based router (Phase 9 / BDM-25) picks among the
// page components: overview / audit / replay. Unknown routes fall
// back to overview.

import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { OverviewPage } from './components/pages/OverviewPage';
import { AuditPage } from './components/pages/AuditPage';
import { ReplayPage } from './components/pages/ReplayPage';
import { SettingsPage } from './components/pages/SettingsPage';
import { GridPage } from './components/pages/GridPage';
import { ChainsPage } from './components/pages/ChainsPage';
import { RulesPage } from './components/pages/RulesPage';
import { SearchPage } from './components/pages/SearchPage';
import { TournamentsPage } from './components/pages/TournamentsPage';
import { TimelinePage } from './components/pages/TimelinePage';
import { useRoute } from './hooks/useRoute';
import { useShortcuts } from './hooks/useShortcuts';
import { useTheme } from './hooks/useTheme';
import { ViewModeProvider } from './contexts/ViewModeContext';

// Browser-tab title per route (BDM-44, WCAG 2.4.2). Each value is the
// short page name; the App-level useEffect wraps it as "<name> · Fleet".
const ROUTE_TITLES: Record<string, string> = {
  overview: 'Overview',
  grid: 'Grid',
  timeline: 'Timeline',
  chains: 'Chains',
  tournaments: 'Tournaments',
  audit: 'Audit',
  search: 'Search',
  rules: 'Rules',
  settings: 'Settings',
  replay: 'Replay',
};

function App() {
  // Drives the data-theme / data-font / accent custom property on <html>.
  useTheme();
  const [route, navigate] = useRoute();
  // Global chord-nav (gO, gG, gT, …) — wires the Sidebar's hotkey
  // hints to the hash router. Per-page useShortcuts calls handle
  // page-specific keys (spawn, broadcast, density toggle).
  useShortcuts({ onNavigate: navigate });
  // Keep the browser-tab title in sync with the active route so multi-
  // tab operators can tell pages apart (WCAG 2.4.2 / BDM-44).
  useEffect(() => {
    const name = ROUTE_TITLES[route.name] ?? 'Fleet';
    document.title = `${name} · Fleet`;
  }, [route.name]);
  // Move focus into the new page's main content on every route change
  // (WCAG 2.4.3 / BDM-49). Each page-component wraps AppShell so the
  // whole tree unmounts on nav and focus drops to <body>; without this
  // re-anchor, keyboard users land at the start of the page (skip-link
  // again) instead of at the new page's content.
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (isFirstMount.current) { isFirstMount.current = false; return; }
    // Defer one frame so the new page has rendered and #main-content
    // exists before we focus it.
    const id = window.setTimeout(() => {
      const main = document.getElementById('main-content');
      if (main) main.focus({ preventScroll: false });
    }, 0);
    return () => window.clearTimeout(id);
  }, [route.name]);
  let page;
  switch (route.name) {
    case 'audit':       page = <AuditPage />; break;
    case 'replay':      page = <ReplayPage />; break;
    case 'settings':    page = <SettingsPage />; break;
    case 'grid':        page = <GridPage />; break;
    case 'timeline':    page = <TimelinePage />; break;
    case 'chains':      page = <ChainsPage chainID={route.params.id} />; break;
    case 'rules':       page = <RulesPage />; break;
    case 'search':      page = <SearchPage />; break;
    case 'tournaments': page = <TournamentsPage />; break;
    default:            page = <OverviewPage />;
  }
  return <ViewModeProvider>{page}</ViewModeProvider>;
}

const rootEl = document.getElementById('root');
if (rootEl) {
  render(<App />, rootEl);
} else {
  console.error('fleet-web: #root not found in DOM');
}

// Dev-mode auto-reload (Phase 12.0). Opt-in via `?live=1` so casual
// dashboard users (and tile WebSocket sessions) don't get blown away
// every time esbuild rebuilds. Add `?live=1` to the URL while actively
// editing fleet/web/src/*.
const liveReload =
  /[?&]live=1/.test(window.location.search) ||
  /[?&]live=1/.test(window.location.hash);
if (liveReload) {
  try {
    const es = new EventSource('/api/stream?topics=dist-rebuilt');
    es.addEventListener('dist-rebuilt', () => {
      console.log('[fleet-dev] dist rebuilt; reloading (?live=1)');
      window.location.reload();
    });
  } catch { /* SSE not available — ignore */ }
}
