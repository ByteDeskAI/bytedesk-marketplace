// SPA entry. Hash-based router (Phase 9 / BDM-25) picks among the
// page components: overview / audit / replay. Unknown routes fall
// back to overview.

import { render } from 'preact';
import { OverviewPage } from './components/pages/OverviewPage';
import { AuditPage } from './components/pages/AuditPage';
import { ReplayPage } from './components/pages/ReplayPage';
import { SettingsPage } from './components/pages/SettingsPage';
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
    default:         return <OverviewPage />;
  }
}

const rootEl = document.getElementById('root');
if (rootEl) {
  render(<App />, rootEl);
} else {
  console.error('fleet-web: #root not found in DOM');
}
