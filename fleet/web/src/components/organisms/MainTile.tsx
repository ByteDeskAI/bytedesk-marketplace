// MainTile — always-present terminal in the multi-agent grid.
// Connects to the dashboard's persistent `fleet-main-<KEY>` tmux
// session via /api/main/pty. The main session survives dashboard
// restarts (tmux owns it) and gives the user a working shell rooted
// in the project worktree, regardless of how many fleet child
// sessions are running.

import { InteractiveTerminal } from './InteractiveTerminal';

export function MainTile() {
  return (
    <div class="pty-tile pty-tile--main">
      <div class="pty-tile__header">
        <strong>main</strong>
        <span style={{ color: 'var(--color-text-tertiary)' }}>persistent shell</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
          fleet-main · always on
        </span>
      </div>
      <div class="pty-tile__body">
        <InteractiveTerminal ticket="_main" wsPath="/api/main/pty" />
      </div>
    </div>
  );
}
