// TimelinePage — Phase 12.x (feature #9). Cross-session tool-use
// timeline. Route: #/timeline.

import { AppShell } from '../templates/AppShell';
import { ToolTimeline } from '../organisms/ToolTimeline';

export function TimelinePage() {
  return (
    <AppShell activeView="timeline" topBarTitle="Tool-use Timeline">
      <header class="page-header">
        <h2 class="page-header__title">&gt; Tool-use Timeline</h2>
        <span class="page-header__sub">cross-session tool dispatch · live</span>
        <span class="page-header__spacer" />
        <span class="tape tape--accent">LIVE</span>
      </header>
      <ToolTimeline />
    </AppShell>
  );
}
