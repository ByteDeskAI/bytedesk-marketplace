// SPA entry. Mounts the OverviewPage into <div id="root">. Real routing
// arrives in a later phase; today the app is single-page.

import { render } from 'preact';
import { OverviewPage } from './components/pages/OverviewPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  render(<OverviewPage />, rootEl);
} else {
  // Safety net: server's index.html should always have #root.
  console.error('fleet-web: #root not found in DOM');
}
