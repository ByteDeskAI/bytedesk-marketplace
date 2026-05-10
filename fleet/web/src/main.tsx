// SPA entry. Hash-based router (Phase 9 / BDM-25) picks among the
// page components: overview / audit / replay. Unknown routes fall
// back to overview.

import { render } from 'preact';
import { OverviewPage } from './components/pages/OverviewPage';
import { AuditPage } from './components/pages/AuditPage';
import { ReplayPage } from './components/pages/ReplayPage';
import { SettingsPage } from './components/pages/SettingsPage';
import { GridPage } from './components/pages/GridPage';
import { useRoute } from './hooks/useRoute';
import { useTheme } from './hooks/useTheme';

function App() {
  // Drives the data-theme / data-font / accent custom property on <html>.
  useTheme();
  const [route] = useRoute();
  switch (route.name) {
    case 'audit':    return <AuditPage />;
    case 'replay':   return <ReplayPage />;
    case 'settings': return <SettingsPage />;
    case 'grid':     return <GridPage />;
    default:         return <OverviewPage />;
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  render(<App />, rootEl);
} else {
  console.error('fleet-web: #root not found in DOM');
}

// Dev-mode auto-reload (Phase 12.0). When the Go server is built with
// -tags dev, it publishes "dist-rebuilt" on the bus whenever esbuild
// rewrites server/dist/. Subscribe via SSE and hard-reload.
//
// Detection: the prod server still publishes /api/version with a build
// string ending in "-bdm28" (or later); dev mode appends "-dev". We
// just always subscribe — a bog-standard prod build never publishes
// the topic, so the listener is harmless.
try {
  const es = new EventSource('/api/stream?topics=dist-rebuilt');
  es.addEventListener('dist-rebuilt', () => {
    console.log('[fleet-dev] dist rebuilt; reloading');
    window.location.reload();
  });
} catch { /* SSE not available — ignore */ }
