# Product — ByteDesk Task Management

Canonical product direction for the `task-management` plugin in `bytedesk-marketplace`.

## Register

product

## Product purpose

Task management takes over the ephemeral task systems of Claude Code, Codex CLI and Grok
and mirrors every task, plan, decision and commit into a git-tracked markdown store at
`.bytedesk/task-management/`. The dashboard is the live window onto that store: one board
per project, shared by every git worktree, with claims, WIP limits and gates that keep
parallel sessions honest.

It is not an issue tracker for a company, not a replacement for Jira, and not a chat
surface. It shows the store; it does not have opinions the store does not have.

## Users

- Operators steering one or several coding-agent sessions on one repository.
- The agents themselves, reading the board through MCP tools and resources.
- Reviewers reading the store in a PR diff and opening the board to see why a card
  stopped.
- Maintainers running `tm doctor`, sweeping dead claims, and exporting the board.

## Product promises

1. Every write on the board goes through the same functions and gates as the CLI and
   MCP; a refusal reads the same on all three surfaces.
2. Nothing the plugin can do is reachable only from the terminal.
3. The board is truthful about liveness: a claim, a session and a stale card are shown
   as the store knows them, with age and expiry.
4. The board works without a mouse, on a phone, and offline with a replayable outbox.
5. The board reads the store; it never invents state, metrics or ordering the store
   does not carry.

## Primary journeys

- Open the board, see the active epic, who holds what, and the next unblocked task.
- Open a card, read why it is blocked to the root, tick criteria, attach evidence,
  finish it.
- Watch a session write in real time and see its subagents attributed.
- Group by epic, plan a sprint, rank the backlog, batch parallel work by touched files.
- Read the dependency graph, the standup, cycle time; export the board.
- Run doctor, fix what is unambiguous, sweep dead claims, set a one-shot override.

## Success criteria

An operator can answer "what is being worked on, by whom, and what is stuck" from the
first screen. Every CLI verb and MCP tool has a board surface. A gated action refused on
the board shows the CLI's own reason. The board passes its keyboard, drawer and
design-check gates on every build.
