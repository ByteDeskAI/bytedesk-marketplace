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
        <span class="tape tape--accent">MAIN</span>
        <strong class="pty-tile__title">persistent shell</strong>
        <span class="pty-tile__spacer" />
        <span class="tape tape--ok">ALWAYS-ON</span>
        <code class="pty-tile__ticket">fleet-main</code>
      </div>
      <div class="pty-tile__body">
        <InteractiveTerminal ticket="_main" wsPath="/api/main/pty" />
      </div>
    </div>
  );
}
