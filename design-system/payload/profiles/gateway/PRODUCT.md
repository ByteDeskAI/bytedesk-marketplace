# Product — ByteDesk Gateway

Canonical product direction for `bytedesk-remote-gateway`. Paired with
[`DESIGN.md`](DESIGN.md), [`CLIENT_UI.md`](CLIENT_UI.md),
[`COMPONENTS.md`](COMPONENTS.md), and
[`VISUALIZATIONS.md`](VISUALIZATIONS.md).

## Register

product

## Product purpose

ByteDesk Gateway provides **secure remote access to a workstation and the agents
running on it**. The host service owns authentication, policy, sessions, terminal and
remote-display surfaces, files, projects, system operations, plugins, and agent
execution. Browser and desktop clients provide consistent operator interfaces over
those capabilities.

Gateway is the free host-control layer in the ByteDesk product family. It does not own
the identity directory (Vault) or catalog, licensing, and billing (Store); it is an
authenticated client of both.

## Users

The primary user is a technical operator working alone or with a small trusted team:
developers, on-call engineers, systems operators, and agent supervisors. They are
comfortable with terminals and machine values, value density and precision, and may
move between a browser, Windows, Linux, macOS, and a phone during one incident or
work session.

## Product topology

Gateway is a client/server product with one authoritative Go host service and multiple
frontends:

- **Browser/PWA** for zero-install and mobile access.
- **Windows, Linux, and macOS desktop clients** for native credential storage,
  notifications, file integration, windowing, and shortcuts.
- **Web surface fallbacks** for terminal, noVNC, Monaco, and plugin panels until a
  native renderer demonstrably reaches semantic and operational parity.

The server advertises capabilities and representations. A client may choose the best
representation it supports, but it cannot omit an authorized workflow and still claim
feature parity.

Structured agent interaction crosses the client boundary through **AG-UI**. Provider
and agent-runtime protocols such as ACP stay southbound inside the host. Raw terminal
bytes, remote-display traffic, file transfer, and general product events retain their
purpose-built transports.

## What it does

- **Authenticated access**: password and TOTP, optional approval, scoped credentials,
  access policy, rate limiting, and auditable sessions.
- **Sessions**: durable terminal and coding-agent sessions, multi-pane staging,
  browser, desktop, live screen, recordings, handoff, pins, and stream capacity.
- **Projects**: project and worktree context, files, editor, Git, terminals, tasks, and
  a project-scoped agent workspace.
- **Files**: local and S3-compatible locations, guest grants, resumable transfer,
  archive operations, preview, editing, metadata, and trash.
- **Mission Control and Infrastructure**: live health, tunnel and service posture,
  deploy and watchdog state, and operational next actions.
- **System**: host telemetry, processes, anomalies, incidents, and approved actions.
- **Agents**: Assistant and Agentic workspaces with messages, tool activity, state,
  approvals, handoffs, and progress delivered through AG-UI.
- **Security and administration**: connections, bans, audit, users, tokens, plugins,
  settings, Store, and Vault integration.
- **Host awareness**: visible remote-view indication, clipboard integration, and
  explicit control/view permissions.

## Product experience

The interface is **The Operator Console**. The active terminal, file tree, editor,
remote surface, chart, or agent run is the product; chrome frames it without competing
for space. The same information architecture, action hierarchy, state vocabulary, and
consequences apply on every frontend.

Pixel identity is not required across operating systems. Semantic parity is:

- the same authorized capabilities are discoverable;
- the same action names and consequences are used;
- live, stale, disconnected, pending, approved, failed, and destructive states mean
  the same thing;
- keyboard and accessibility paths remain complete;
- native operating-system affordances may replace browser affordances where they are
  stronger.

## Brand and tone

Direct, operational, and honest. The console states current posture and the next
available action. It does not hide missing controls behind optimistic language, present
stale data as live, or add marketing decoration inside work surfaces.

## Anti-references

- Generic SaaS dashboards built from interchangeable metric cards.
- Separate visual languages for browser, Windows, Linux, and macOS.
- Desktop wrappers that expose privileged native APIs to arbitrary plugin WebViews.
- Agent chat streams that hide tool execution, approval state, or errors.
- Decorative gradients, unbounded glass stacks, illustration, or animation over live
  work; the shared structural Black Glass shell remains permitted.
- Fake enterprise controls standing in for policy the server does not enforce.
- A native rewrite that removes terminal, remote-display, editor, or plugin parity.

## Strategic principles

1. **The host is authoritative.** Authentication, authorization, launch validation,
   files, processes, agents, and destructive operations remain server-side.
2. **One design contract, multiple renderers.** Tokens, component semantics, state,
   accessibility, and interaction rules are shared across clients.
3. **Capability parity before native purity.** Reuse proven web surfaces until a native
   implementation is measurably better and complete.
4. **AG-UI is the agent-to-user boundary.** It does not replace terminal, file, VNC,
   telemetry, or ordinary resource APIs.
5. **Live state must be honest.** Clients distinguish live, delayed, stale,
   disconnected, and replayed data.
6. **Security follows the surface.** Credentials stay out of untrusted renderers;
   remote and plugin surfaces receive short-lived, narrow capabilities.
7. **Free core, clean seams.** Store and Vault remain separate authorities with
   explicit client contracts.
8. **Portable by design.** New features define browser and desktop representations,
   keyboard behavior, compact behavior, and accessibility before shipping.

## Success criteria

An operator can connect from a browser or a supported desktop client, authenticate
safely, resume the same workspace, open a terminal or remote surface, inspect host
state, work with files and projects, and supervise agents without learning a different
product on each platform.

A client is successful when it preserves all authorized workflows, clearly communicates
connection and execution state, and makes the active host surface the shortest path
between operator intent and result.
