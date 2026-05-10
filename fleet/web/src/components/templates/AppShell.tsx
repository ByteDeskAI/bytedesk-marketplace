// Three-region template: persistent sidebar, top bar, scrolling content.
// Real-world templates rarely change shape between pages, so keeping this
// simple template-as-grid avoids overengineering.

import type { ComponentChildren } from 'preact';
import { Sidebar } from '../organisms/Sidebar';
import { TopBar } from '../organisms/TopBar';

export interface AppShellProps {
  activeView?: string;
  topBarTitle: string;
  onSpawnClick?: () => void;
  children: ComponentChildren;
}

export function AppShell({ activeView, topBarTitle, onSpawnClick, children }: AppShellProps) {
  return (
    <div class="app-shell">
      <Sidebar activeView={activeView} />
      <main class="app-shell__main">
        <TopBar title={topBarTitle} onSpawnClick={onSpawnClick} />
        <div class="app-shell__content">{children}</div>
      </main>
    </div>
  );
}
