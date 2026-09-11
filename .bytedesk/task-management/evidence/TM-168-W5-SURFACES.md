# TM-168: role icons on terminal, run.json and CLI surfaces (W5)

**Result:** Every managed pane, `run.json` entry and CLI output line now shows the role icon.
Pane titles, session names, window names and ids are byte-for-byte unchanged.
Branch `tm/TM-168-surfaces` has two commits after `6bf4faa`: `286b70f` and `48d92d0`.

## Surfaces (line numbers at 48d92d0)

### Terminal title bar
- **Where:** sessions agent orchestration creates.
- **How:** `newSession` sets session-scoped `set-titles on` and `set-titles-string` (`tmux.mjs:62`).
- **Title format** (`tmux.mjs:190`):
  `#{?@ao_role_icon,#{@ao_role_icon} #{@ao_agent} · #{@ao_role_label},#S:#I:#W - "#T"}`
- **What an attached xterm receives:** `ESC ] 0 ; <icon> <name> · <label> BEL`.

### Pane options: `@ao_agent`, `@ao_role`, `@ao_role_label`, `@ao_role_icon`
- **Run panes:** set in the `preparePane` batch (`tmux.mjs:171`, called from `launch.mjs:854`).
- **Role-session panes:**
  - create: `launch.mjs:1116`
  - reattach: `launch.mjs:1086`
  - restart: `launch.mjs:1081`
- The readable name is read from `agent.json`, which is never written.

### run.json
- New entries carry `roleIcon` and `roleLabel` (`launch.mjs:797`).
- `runAgentVisual` (`launch.mjs:265`) uses the declared role, or the nested-team icon for a workflow participant.
- Readers recompute the icon and never trust a stored value.

### CLI
- **JSON output** gains additive `roleIcon` and `roleLabel` in:
  - `launch` (dry run, results, participants)
  - `agent new`, `agent show`, `agent list`
  - `session list` (orphan spawns get the fallback icon), `session open`
  - `status`
  - `role list`, `role status`
- **Human rows** show the icon before the name for `launch`, `agent list`, `session list` and `status`. The `status` TEAM row uses the nested-team icon.

### Unchanged by decision
- The `select-pane -T` text and `pane_title`.
- Session names, window names, ids and routing addresses.
- No `-g` options, no `pane-border-status`, no writes to `agent.json`.

## Measured on real tmux 3.4

- **`#{@opt}` inserts a value literally.** Only `#{E:@opt}` expands formats inside it.
- **tmux does not filter `set-titles` output.** An ESC sequence stored in an option reached the attached terminal as a second OSC title.
- **An argv element ending in `;` is a command separator** in a batched tmux call.

## Sanitisation

- `terminalText` (`util.mjs:204`) strips C0, DEL and C1 control characters.
- `tmuxText` (`tmux.mjs:198`) applies `terminalText`, caps values at 80 code points, and replaces two characters:
  - `#` becomes U+FF03 ＃;
  - a trailing `;` becomes U+FF1B ；.
- The launcher's OSC 2 printf (`launch.mjs:239`) also strips control characters.

## Evidence

| Check | Commit | Result |
|---|---|---|
| Baseline full topology suite | 6bf4faa | 401/401. This run inherited `TMUX`: see the warning below. |
| Full topology suite, isolated (`TMUX=''`, private `TMUX_TMPDIR`) | 286b70f | 407/408. "role list names an image-gen holder" failed: its exact holder `deepEqual` predated the additive fields. |
| Full topology suite, isolated | 48d92d0 | 408/408, exit 0. |
| Stability, `tests/unit/topology-role*.test.mjs`, 5 runs, clean tree | 48d92d0 | Stable, fail counts all 0. The pattern matched role-icon-surfaces (7 tests), role (6) and role-visual (4). |
| `tests/contract/topology-role-icon-tmux.test.mjs` | 48d92d0 | 1/1, exit 0. Includes an attached-terminal byte check via `script(1)`. No leaks. |

**Control run.** The same spec, lead `agent new` and `session open` were run on 6bf4faa code and on the worktree code, each on its own isolated server. The pane titles and session and window names were identical.

**Red runs**, each failing where intended:
- **Options step removed from `preparePane`:** the contract test fails with `'' !== '🎼'`.
- **`tmuxText` passing its input through raw:** both unit tests fail, and the contract test shows the raw escape sequence.
- **An injected `roleIcon` authority check in `cli.mjs`:** the authority scan fails, naming that line.

## Read, not run

- Option decoration on the reattach and restart paths. Those paths are exercised by existing tests, but no test asserts the options there.
- `role show` and `role status` JSON output.

## Findings filed

**Suite isolation.** Run from inside tmux, the existing `topology-launch` tests create and kill named sessions on the operator's server.

**Lead icon mismatch.** A repository lead launched as a run's orchestrator shows 🎼 on its run pane but 👑 in presence.

**TM-183 addition.** `select-pane -T` still receives the raw declared role until the sanitised OSC 2 title replaces it.

## Facts for the gateway

- **Read the icon from pane options,** not the pane title: `list-panes -a -F '#{pane_id}\t#{@ao_role_icon}\t#{@ao_agent}\t#{@ao_role_label}'`. `pane_title` is unchanged, so the existing parser keeps working.
- **Treat the options as display-only.** Values contain no control characters and are at most 80 code points.
- **Some titles are untrusted.** Titles of sessions agent orchestration did not create are passed through by tmux unfiltered.
