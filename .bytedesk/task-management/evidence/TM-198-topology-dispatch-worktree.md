# TM-198 — evidence

Topology dispatch refused every task in the first live pool run. This records what was **verified**
(a command was run and its output read) and what was only **read**.

- Base commit: `edd9a9390bb8373f68c74771555b84d19f1abdb6`, branch `tm/TM-198-task-management-topology-dispatch-fails-the-spec`.
- Date 2026-09-13, linux, node v22.22.3.
- Every "before" figure below was produced by reverting the seven source files to that commit,
  running, and restoring — the test files stayed in place, so the new tests are measured against
  the pre-fix code they were written to reproduce.

## Working tree at measurement time

```
 M .claude/helpers/graft-hooks.cjs
 M .claude/helpers/graft-statusline.cjs
 M .claude/settings.json
 M agent-orchestration/CHANGELOG.md
 M agent-orchestration/tests/unit/topology-spec.test.mjs
 M agent-orchestration/topology/lib/agents.mjs
 M agent-orchestration/topology/lib/spec.mjs
 M agent-orchestration/topology/lib/util.mjs
 M task-management/CHANGELOG.md
 M task-management/lib/dispatch/backend.mjs
 M task-management/lib/dispatch/index.mjs
 M task-management/lib/dispatch/pool.mjs
 M task-management/lib/dispatch/topology.mjs
 M task-management/lib/ntfy.mjs
 M task-management/tests/unit/dispatch-backends.test.mjs
 M task-management/tests/unit/dispatch.test.mjs
 M task-management/tests/unit/pool-safety.test.mjs
?? .bytedesk/task-management/evidence/TM-198-topology-dispatch-worktree.md
```

The three `.claude/` helper files are another session's edit; no test or command here reads them.

## AC1 — a dispatch into a provisioned worktree launches, with no TOPOLOGY_PATH_ESCAPES_REPO

Verified through the **real** `agent-orchestration/bin/ao-topology` binary, against a **real**
linked worktree of a real git repo, with an agent created by `ao-topology agent new`, and the spec
that `task-management/lib/dispatch/topology.mjs` `specFor()` itself produces — not a hand-typed
copy. `--dry-run` stops before opening a tmux pane; spec validation, agent-reference expansion,
library resolution and containment all run for real.

### Before (source files at the base commit)

```
agent: bcc914d6
agent dir under main? /tmp/tm198-e2e-PhPZOz/main/.bytedesk/agent-orchestration/agents/bcc914d6
--- agent entry tm wrote:
{
 "id": "worker",
 "agent": "bcc914d6"
}
--- ao-topology launch --dry-run --consumer <linked worktree>
REFUSED: TOPOLOGY_PATH_ESCAPES_REPO - agents.worker.cwd resolves to /tmp/tm198-e2e-PhPZOz/main/.bytedesk/agent-orchestration/agents/bcc914d6, which is outside this repository (/tmp/tm198-e2e-PhPZOz/wt). A spec may not launch an agent outside the repo that invoked it. Pass --allow-outside if that is genuinely intended.
(fixture at /tmp/tm198-e2e-PhPZOz)
```

That is the ticket's message verbatim, reproduced from a clean fixture.

### After

```
agent: f05e1fe7
agent dir under main? /tmp/tm198-e2e-L4gVJI/main/.bytedesk/agent-orchestration/agents/f05e1fe7
--- agent entry tm wrote:
{
 "id": "worker",
 "agent": "f05e1fe7",
 "cwd": "{{consumer}}"
}
--- ao-topology launch --dry-run --consumer <linked worktree>
LAUNCH OK (dry run). agent cwd = /tmp/tm198-e2e-L4gVJI/wt
cwd is the dispatched worktree? true
(fixture at /tmp/tm198-e2e-L4gVJI)
```

Not verified: a worker pane actually opening and a live `claude` process attaching. That needs a
tmux server and a provider, and the launch is bounded at 180s; the dry run covers every step up to
the pane.

## AC2 — who owns the definition of the consumer

Stated in code, on both sides:

- **task-management owns the working directory of the workers it dispatches.**
  `lib/dispatch/topology.mjs` `CONSUMER_CWD` — the spec now says `cwd: "{{consumer}}"` instead
  of relying on a default that a library-agent reference silently overrode.
- **agent-orchestration owns where its agent library lives, and what "the repository" means.**
  `topology/lib/util.mjs` `repositoryRoot` is now the layer's one answer, used by both the
  library lookup (`agents.mjs` `libraryConsumer`, previously its own `git worktree list`) and
  by containment (`spec.mjs` `containPath`, previously the consumer directory). Those two
  disagreeing is the whole bug.

Test covering a dispatch whose consumer is a linked worktree:
`agent-orchestration/tests/unit/topology-spec.test.mjs` — "a consumer that is a linked worktree is
contained against its REPOSITORY, not its own tree". It builds a real repo, a real linked worktree
and a real library agent, and also asserts that `/` and a sibling directory are **still** refused,
so the rule did not become "anywhere".

## AC3 — a backend that refuses at launch falls through

`dispatch()` now walks every usable backend and fails only when the chain is exhausted, naming
each refusal. An explicitly requested backend (`--backend topology`) still gets a chain of one.

The fix needed a second edit to reach the pool: `poolTick` resolved a backend for its per-backend
cap accounting and passed that name to `dispatch()` as `backend:` — an explicit request, which
pins the chain. Verified that the library fix alone changes nothing there: with `index.mjs` and
`backend.mjs` fixed but `pool.mjs` still pinning, the pool test fails exactly as it does at the
base commit.

## AC4 — the tests reproduce the failure against the pre-fix code

### Before

```
    not ok 3 - the spec is one agent that STATES the consumer as its cwd
    not ok 1 - walks to the next usable backend and does not report a failure
    not ok 2 - fails only when every usable backend has refused, and names each one
    not ok 1 - the tick falls through to the next backend instead of counting three failures and pausing
# tests 78
# pass 74
# fail 4
--- agent-orchestration/tests/unit/topology-spec.test.mjs
not ok 16 - a consumer that is a linked worktree is contained against its REPOSITORY, not its own tree
# tests 21
# pass 20
# fail 1
```

### After

```
# tests 98
# pass 98
# fail 0
--- agent-orchestration/tests/unit/topology-spec.test.mjs
# tests 21
# pass 21
# fail 0
```

One of the four new tm tests — "does NOT fall through when a backend was asked for by name" —
passes before and after by construction. It is a regression guard, not a reproduction.

`task-management/tests/test-pool.sh`: `34 passed, 0 failed`. It was green before
this change too — it never exercised a backend that refuses at launch, which is why the defect
reached a live run.

## Full suites

| suite | before (base commit) | after |
|---|---|---|
| `task-management/tests/unit/*.test.mjs` | 1506 tests, 14 fail | 1511 tests, 14 fail |
| `agent-orchestration/tests/unit/*.test.mjs` | 589 tests, 6 fail | 589 tests, 6 fail |
| `task-management/tests/test-pool.sh` | 34 passed, 0 failed | 34 passed, 0 failed |

The failing suites are identical before and after and are unrelated to this change:
`actor`, `a supplied registry participates in selection`, `tm_task_update start`, `tm_claim`,
`tm_worktree …`, `the handoff's completion contract`, `the event log's session column`,
`tm-hook.sh pre-bash` on the tm side; `control-seam`, `mcp-contract`, `runtime-engine`,
`service-routing`, `session-host`, `session-supervisor` on the ao side (these six fail at the
base commit with the source files reverted, so they are not caused by anything here).

One of those, `a supplied registry participates in selection`, is worth a follow-up: it reads this
repository's own `dispatch.backends` config through the default `paths()`, so its expectation
depends on the machine it runs on. Out of scope here; the new tests all pass an explicit store.
