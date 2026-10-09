# ADR 0001: The known-repo set is writable by any process running as the operator

- Status: accepted
- Date: 2026-10-08
- Task: TM-467 (EP-028)

## Context

Cross-repo tickets (`tm ticket`, `lib/ticket.mjs`) act only on a "known" repo. `knownRepo()`
accepts a directory that has a task-management store and is either:

- registered in agent-orchestration's `services/repos.json`, or
- a sibling of this store's repository.

Both sources can be changed by any process running as the operator's user, and a dispatched worker
runs as that user. A worker can create `../anything/.bytedesk/task-management/` or add a line to
`repos.json`, and that directory is then "known". Filing a ticket there used to run
`tm pool ensure` in that directory, which starts a dispatch pool that reads that directory's config.

Before TM-467 that config chose the worker's command (`dispatch.tmuxCommand`), so a worker could
start an arbitrary program, outside its worker guard, by making a repo known and filing one ticket.

## Decision

We document the residual risk instead of building an operator-only registry, and we apply two
mitigations.

1. **The repo's config no longer chooses what a worker runs (TM-467).** `dispatch.tmuxCommand` and
   `dispatch.topologyCandidates` are read only from the user's
   `$XDG_CONFIG_HOME/task-management/config.json`. A topology worker is always an inline agent, so
   the repo's agent library cannot set its cli, args, env, mcp servers or cwd. agent-orchestration
   no longer loads provider adapters from the consumer repo. A pool started in a hostile repo
   therefore runs the operator's own command, not one the repo picked.
2. **A dispatched worker never starts a pool in another repo.** When `TM_DISPATCH_WORKER` is set,
   `wakePool()` still writes the wake file, so a pool that is already running sees the ticket, but
   it does not run `tm pool ensure`. An idle target waits for its own lead or operator.

We did not build an operator-only registry. Any file that the operator's user can write, a worker
can also write, and any environment check (`TM_DISPATCH_WORKER`) can be removed by a process that
runs its own commands. A registry would look like a boundary without being one.

## Consequences

- **Residual risk, accepted:** a same-user process can still make a directory known and file a
  ticket there; a worker that unsets `TM_DISPATCH_WORKER` can still start a pool there. That pool
  dispatches with the operator's configured command, in a checkout whose own files (for example
  `.claude/settings.json` hooks) the attacker controls. That is no more than the worker could
  already do by running a command itself, so this ADR treats same-user processes as one trust
  domain.
- The real boundary is the operating system. Running workers as a separate user, or in a sandbox
  that cannot write the operator's home and sibling directories, would close this. That is out of
  scope for task-management.
- Revisit this decision if workers start running under a separate user. At that point an
  operator-owned, worker-read-only registry becomes enforceable and should replace the sibling rule.
