# Gateway cross-platform client UI contract

This document is normative for every ByteDesk Gateway frontend: the browser SPA,
the Windows, Linux, and macOS desktop clients, compact browser/PWA layouts, and any
future client that claims Gateway feature parity. Read it after
[`DESIGN.md`](DESIGN.md) and with [`COMPONENTS.md`](COMPONENTS.md) and
[`VISUALIZATIONS.md`](VISUALIZATIONS.md).

The design goal is **semantic parity with platform-appropriate delivery**. Clients do
not need to render identical pixels, but the same action, state, hierarchy, keyboard
path, and consequence must be recognizable everywhere.

## 1. Product model

Gateway is an operator console around live host surfaces. Every client presents the
same five layers:

1. **Connection** — which Gateway is selected, authentication posture, latency, and
   reconnect state.
2. **Navigation** — the enabled desks and plugin contributions allowed for the current
   principal.
3. **Workspace** — the active desk: Sessions, Projects, Files, Agentic, System,
   Security, Infrastructure, Store, Settings, or a plugin surface.
4. **Inspector** — context, properties, activity, approvals, or detail for the current
   selection.
5. **Transient layers** — command palette, launcher, confirmation, toast, sheet, or
   native operating-system dialog.

The host, not the client, remains authoritative for authentication, authorization,
launch validation, process state, files, agents, and destructive operations.

## 2. Platform contract

| Concern | Browser / PWA | Windows / Linux / macOS desktop |
|---|---|---|
| Product shell | React/CSS using `--bd-*` | Shared web shell in Tauri initially; native renderers consume generated tokens |
| Terminal | xterm.js | xterm.js first; a Rust terminal may replace it behind the same surface contract |
| Remote desktop / screen | noVNC surface | Isolated noVNC WebView until a native VNC renderer reaches parity |
| Editor | Monaco | Monaco WebView |
| Plugin UI | sandboxed iframe | unprivileged isolated WebView |
| Notifications | in-app + browser delivery | in-app + native notification |
| File selection | browser picker / drag and drop | native picker / drag and drop |
| Credentials | secure cookie or browser session | operating-system credential store; never exposed to page JavaScript |
| Agent interaction | AG-UI client | AG-UI through the Rust connection core |
| Windowing | browser tab, fullscreen, document PiP where supported | native windows, tray, fullscreen, child surface windows |

Platform-native menus, title bars, notifications, file dialogs, credential stores,
tray items, and system shortcuts may look native. Product workspace controls remain
ByteDesk controls and use the same tokens and component states.

## 3. Units and density

Token dimensions are logical CSS pixels or density-independent native units. Native
clients scale them with the operating system's text and display settings; they do not
treat token values as physical pixels.

Gateway has three interaction densities:

| Density | Control and row height | Use |
|---|---:|---|
| `compact` | `size.control.compact` / `size.row.compact` (28) | pointer-first console, tables, trees, terminal chrome |
| `default` | 32 | forms, settings, mixed pointer/touch layouts |
| `touch` | 44 | compact PWA, coarse pointer, accessibility preference |

A compact visible control may keep a 28-unit visual box only when its interactive hit
target reaches `size.hit-target.touch` on coarse-pointer clients. Never shrink terminal,
file, or agent controls below their required target to preserve a desktop screenshot.

## 4. Adaptive layout

Breakpoints apply to **available content width**, not monitor resolution.

| Mode | Width | Shell behavior |
|---|---:|---|
| Compact | up to 719 | one primary pane; bottom primary navigation or a dismissible navigation sheet; inspector becomes a sheet |
| Standard | 720–1199 | 48-unit icon rail; one primary workspace plus an optional overlay inspector |
| Wide | 1200–1599 | 196-unit labeled navigation; workspace plus 360-unit inspector when useful |
| Ultrawide | 1600+ | labeled navigation; workspace; persistent inspector; optional secondary working pane |

The canonical design-review frame is **1600 × 900 (16:9)**. Every new desk also needs
checks at 1280 × 720, 1440 × 900, 1920 × 1080, and 390 × 844.

Do not scale the whole interface to fit. Adapt composition:

- collapse labels before shrinking hit targets;
- turn secondary panels into sheets before compressing the stage;
- allow tables and timelines to scroll;
- preserve terminal and remote-surface aspect and input behavior;
- keep the active operation and its status visible.

## 5. App shell

### Top bar

Height: `size.shell.topbar`.

The top bar contains, in order:

1. product mark and selected Gateway;
2. environment and connection state;
3. active desk title or breadcrumb;
4. global command entry;
5. notifications and account/session actions.

It is not a second navigation row. Desk-specific actions belong in the desk command
bar. Connection state is always text plus icon or dot; color alone is insufficient.

### Primary navigation

- Wide: 196-unit labeled navigation.
- Standard: 48-unit icon rail with accessible labels and tooltips.
- Compact: bottom navigation for the most-used desks plus an **All desks** sheet.
- Enabled server contributions determine what exists; clients do not hard-code access
  to unavailable plugins.
- Counts represent actionable work, not decoration. A badge is absent when zero unless
  zero itself is operationally important.

The active desk receives the desk tint in chrome only. The workspace stage remains on
the neutral family ground.

### Command bar

Height: `size.shell.commandbar`. It contains the title/breadcrumb and actions scoped to
the current desk or selection. One primary action is permitted. Destructive actions
stay separated from routine controls.

### Inspector

Preferred width: `size.shell.inspector`. It holds context that must remain visible while
working: selected-session properties, file metadata, agent activity, approval detail,
or chart legend and time controls. It is dismissible and never the only path to a
required action.

### Status bar

Height: `size.shell.statusbar`. Use only when continuous machine state benefits the
current desk: branch, worktree, transfer progress, terminal dimensions, event-stream
state, or server/client version. Do not add a global status bar merely to fill space.

## 6. Desk composition

### Mission Control / Infrastructure

- Put current posture and the next action above historical detail.
- Service lists and timelines are primary; summary cards are supporting, not the whole
  screen.
- A stale snapshot carries a visible stale label and last-update time.

### Sessions

- The live terminal, browser, desktop, or screen surface owns the stage.
- Session tree, tab strip, launcher, capacity, layout, broadcast, recording, and
  handoff are chrome around the stage.
- The selected tile has a two-unit active stroke and a non-color focus treatment.
- Multi-pane layout preserves operator geometry. Refresh or reconnect must not silently
  replace the selected layout.
- Fullscreen and native child-window actions must leave an obvious route back.

### Projects

Projects is a workbench, not a collection of unrelated pages:

- project/worktree switcher and branch state;
- file tree and editor;
- terminal stage;
- Git and task surfaces;
- Files and Assistant/agent dock;
- persistent, user-owned layout.

At standard width, show one primary work surface and one collapsible companion. At
wide/ultrawide widths, preserve the user's split arrangement. Do not duplicate global
navigation inside the workbench.

### Files

- Location and breadcrumb lead the command bar.
- Tree/list/grid choices preserve the same selection model and operations.
- Local, S3-compatible, trash, and guest-jail locations expose their limits explicitly.
- Transfer progress remains available after leaving the Files desk.
- Native clients use operating-system pickers and drag/drop, but server-side paths,
  grants, and permissions remain authoritative.

### Agentic / Assistant

- Conversation is one view of an agent run, not the complete model.
- Message stream, reasoning availability, tool activity, approvals, shared state,
  progress, errors, and cancellation come from AG-UI.
- The client presents agent, thread, run, project/worktree context, and connection state.
- Tool requests that require the client are labeled as local and identify the requesting
  agent before execution.

### System

- Current CPU, memory, disk, network, process, and anomaly posture come before incident
  prose.
- Charts follow [`VISUALIZATIONS.md`](VISUALIZATIONS.md); tables remain available for
  exact values and accessibility.
- Process actions show scope, target identity, and consequence before execution.

### Security, Store, Users, Settings

These desks use the same dense forms, tables, inline confirmation, status, and token
rules. Do not fall back to a generic admin-template visual language.

### Plugin surfaces

Representation selection order:

1. a client-native view known to the current client;
2. a semantic/declarative representation supported by the client;
3. an isolated web representation;
4. a clear unsupported representation state.

An isolated plugin WebView receives no native filesystem, credential, shell, or general
network capability merely because its parent window is trusted.

## 7. AG-UI presentation contract

Clients expose the following AG-UI concepts consistently:

| Concept | Presentation |
|---|---|
| Run | bounded activity with agent, thread, state, start/end, cancel, and error |
| Message | authored content with stable identity and streaming status |
| Reasoning | optional secondary stream; collapsible and labeled, never impersonating final output |
| Tool call | named activity with argument summary, status, result, duration, and origin |
| Approval | interruptive decision with requested action, scope, consequence, allow/deny, and expiry |
| State snapshot/delta | reflected in the relevant workspace, not dumped as JSON by default |
| Step/activity | ordered progress for missions and multi-agent work |
| Error | attached to the run or tool that failed, with retry/copy-detail where safe |

Rules:

- streaming content grows in place; do not insert newer content above the user's reading
  position;
- cancellation remains available while the run is cancellable;
- tool results never appear as if authored by the human;
- a disconnected client marks the run state unknown until reconciled;
- approval cannot be accepted by an unintentional Enter key or background window;
- raw provider/ACP details are diagnostics, not primary interface labels;
- terminal bytes and remote-display frames are not translated into AG-UI.

## 8. Commands, keyboard, and touch

Shared commands use the same names and default shortcuts where the platform permits:

| Action | Default |
|---|---|
| Global command palette | `Ctrl/Cmd+K` |
| New session / launcher | `Ctrl/Cmd+Shift+N` |
| Focus primary navigation | `Ctrl/Cmd+Shift+L` |
| Toggle inspector | `Ctrl/Cmd+Shift+I` |
| Close transient layer | `Escape` |
| Move among stage panes | `Alt+Arrow` |
| Focus active terminal/surface | `Ctrl/Cmd+Shift+Enter` |

Do not override operating-system reserved shortcuts. A desktop menu exposes the same
commands and current bindings. User-configurable bindings are device-local unless the
product explicitly synchronizes them.

Touch clients retain the on-screen terminal modifier row. Long press may open context,
but no required command is available only through long press, hover, or right click.

## 9. State ownership

| Owner | Examples |
|---|---|
| Server/host | sessions, process state, projects, files, plugins, configuration, agent runs |
| User profile | favorites, pins, muted notification kinds, synchronized layouts, saved filters |
| Device | window geometry, download folder, local key bindings, native notification permission |
| Ephemeral view | hover, menu, drag preview, unsubmitted form state |

A frontend must not claim a server mutation succeeded until the server confirms it.
Optimistic motion is permitted only when rollback is clear and safe.

## 10. Connection and live-data vocabulary

Every streaming surface has one of these states:

- **Connecting** — no current authoritative stream yet.
- **Live** — receiving within the surface's expected interval.
- **Delayed** — stream exists but is behind its expected interval.
- **Stale** — displaying the last known snapshot beyond its validity window.
- **Disconnected** — no stream and reconnection is pending or stopped.
- **Replaying** — applying missed events or a replacement snapshot after reconnect.

Display last update time when delayed, stale, or disconnected. Never use a green dot for
cached data merely because the cached state was healthy.

## 11. Native operating-system integration

Desktop clients may use native presentation for:

- title bar, menus, tray, taskbar/dock badge, notifications;
- credential storage and biometric unlock where supported;
- file and folder pickers, share/open-with, downloads;
- global shortcuts with explicit permission;
- child windows and fullscreen surfaces;
- accessibility APIs and reduced-transparency preferences.

Native integration is an adapter around product commands. Business authorization and
validation stay on the server. Long-lived credentials remain in the native core and are
not injected into the shared web shell or plugin WebViews.

## 12. Accessibility

- WCAG 2.2 AA applies to browser and desktop renderers.
- Native renderers expose operating-system accessibility roles, names, values, state,
  and focus order.
- Focus is always visible, including around embedded terminal and remote surfaces.
- Dynamic updates use polite announcements; approvals and destructive confirmation may
  use assertive announcement only when they block progress.
- Color is never the only distinction in charts, status, selection, diff, agent state,
  or approval.
- Text and interface scaling must not clip commands or make the active surface
  unreachable.
- Reduced motion disables decorative movement; state transitions remain understandable.

## 13. Theming

Dark is the canonical shipped theme. All clients must consume semantic tokens so a
future light or high-contrast theme can replace values without changing component
logic. A client must not invent an independent operating-system-specific palette.

Platform-native dialogs may follow the operating-system theme. ByteDesk-owned windows,
workspaces, surfaces, and notifications use the current ByteDesk theme.

## 14. Acceptance gates

A frontend feature is not complete until it has:

1. capability and permission behavior defined;
2. compact, standard, wide, and 1600×900 review states;
3. keyboard, touch/coarse-pointer, and screen-reader behavior where applicable;
4. live, empty, loading, stale, disconnected, error, and permission-denied states;
5. browser and desktop representation decisions;
6. no uncataloged color, spacing, type, radius, shadow, or motion literal;
7. no credential flow through an untrusted renderer;
8. a parity record showing all existing actions and states retained.
