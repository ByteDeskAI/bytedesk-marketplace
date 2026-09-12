# TM-167 criteria 1, 2 and 6: enrollment, activation, scoped tmux listing (W3)

**Result.** All three criteria are delivered at `ccd3ed1` on `tm/TM-167-activation`, merged into
`tm/EP-019-leads-icons` at `7cca13f`. Commits after the seam `4d76a60`: `863ed0c`, `95eed25` and
`ccd3ed1` (18 files, 712 lines added, 64 removed).

## Criterion 1: one enrollment resolver

`topology/lib/repo-enrollment.mjs` answers from the canonical root, so every linked worktree gets
the same answer. It checks, in order:

1. The repo config sets `enabled: false`: the repository is disabled. This beats every other source.
2. The repo config sets `enabled: true`: enrolled (`repo-config`).
3. The project `.claude/settings.json` has `enabledPlugins["agent-orchestration@<marketplace>"] === true`:
   enrolled (`project-plugin`). An explicit `false` there does not disable.
4. A lead registration exists: enrolled (`lead-registration`).
5. Otherwise, not enrolled (`none`).

A repo config that cannot be read, is not a JSON object, or has a non-boolean `enabled` counts as
disabled, and the result says why.

## Criterion 2: activation

- **One start path.** Every command that used to start a supervisor itself now goes through
  `activateRepository`:
  - `census`, `lead`, `role`, `launch`, `session open` and `send`;
  - `enrollment ack`, which no longer fails the command;
  - the startup-check hook and the managed-launch path, which report `session-start`.
- **Enrolled repositories only.** `activateRepository` starts a supervisor only when the repository
  is enrolled.
- **One supervisor for many worktrees.** When several linked worktrees activate at once, they end up
  with a single supervisor. This holds in unit tests and on real tmux, with 5 command-line processes
  and 2 session starts inside panes.

## The supervisor's own behaviour (the revised decision)

- **It runs read-only in every repository, enrolled or not.** It keeps presence, census, slots,
  quota and prompt refresh running.
- **Only enrolled repositories get new agents.** Starting or recovering an agent is gated on
  enrollment (W4's `recoverLead`).
- **The watcher labels only its own repository's panes.**
- **Why:** of the 11 repositories running a supervisor on this machine, only 3 are enrolled. The
  resolver was run read-only against each of them.

## Criterion 6: no listing on an unnamed tmux server

- **The guard.** `listServerPanes` throws `TOPOLOGY_TMUX_SERVER_REQUIRED` unless it is given a
  server (`tmuxServer`), a session (`session`), or both.
- **Every caller now names its server:**
  - `send` uses the binding's server;
  - `launch` uses the server of its first pane;
  - `openRoleSession` and `failover` use the recorded binding or the new pane;
  - `prompt` and `startup-check` use the recorded server or the caller's own `$TMUX` socket;
  - `presence` and `census` list only for bindings or an explicit `--server`;
  - `lead assign` looks up its session, where the server is implicit (`lead.mjs:494`);
  - `reviewer assign` and `role status` pass the session together with its recorded server;
  - `manage` uses the binding, or the session with its cwd checked.
- **Server-wide listing** remains only in `startup watch` and the supervisor's watcher.
- **Guard test.** Ordinary commands run through the real CLI with a fake `tmux` that records its
  arguments.

## Evidence at `ccd3ed1` (clean tree before and after)

| Check | Result |
|---|---|
| `node --test --test-concurrency=1 tests/unit/topology-*.test.mjs` | 408 tests, 408 pass, exit 0 (baseline at `4d76a60`: 397/397) |
| `npm run test:topology:tmux -- --test-concurrency=1` | 5/5, exit 0; the observer isolation check ran against a real supervisor |
| `tests/contract/topology-activation-tmux.test.mjs` | 3/3, exit 0 |
| Five direct runs per file (test counts shown) | activation 5/5 each time, repo-enrollment 6/6, presence 18/18, supervision 14/14 |
| Leftover supervisors from these test directories | none |

**Before the approved `lead.mjs:494` change:** 402 of 408 passed. All 6 failures were at that line.

## Red runs

Each run changed the code on a scratch copy and failed as intended:

| Run | What was broken | Test that failed |
|---|---|---|
| (a) | the `startup-check` listing unscoped | "enumerated an unnamed server" |
| (b) | the watcher's own-repository filter removed | labelled `other-work` |
| (c) | the old supervise gate | exit 1 against expected 0 |
| (d) | `enabled:false` no longer winning | got `project-plugin`, expected `disabled` |
| (e) | the `listServerPanes` refusal removed | missing expected rejection |
| (f) | `lead.mjs:494` reverted | `TOPOLOGY_TMUX_SERVER_REQUIRED` thrown |
| (g) | the exit in unenrolled repositories restored | the presence assertion |
| (h) | `tmux new-session` injected into `supervise` | the "never starts" assertion |
| (i) | the `activateRepository` gate removed | a real supervisor was spawned in an unenrolled repository |

## Read, not proven by a test

These scoped call sites have no test of their own:

- `send`'s `stillBound`, `failoverAgent`, and the restart branch of `openRoleSession`;
- the real `manage bind|assign` and `reviewer assign` paths, and `observer`.

The tested refusal in `listServerPanes` still covers them, because all of them go through it.

## Known limit

`session list` still runs `list-sessions` on the implicit server.
