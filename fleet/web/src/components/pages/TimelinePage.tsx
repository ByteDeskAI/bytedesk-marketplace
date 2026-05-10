// TimelinePage — Phase 12.x (feature #9). Cross-session tool-use
// timeline. Route: #/timeline.

import { AppShell } from '../templates/AppShell';
import { ToolTimeline } from '../organisms/ToolTimeline';

export function TimelinePage() {
  return (
    <AppShell activeView="timeline" topBarTitle="Tool-use Timeline">
      <ToolTimeline />
    </AppShell>
  );
}
