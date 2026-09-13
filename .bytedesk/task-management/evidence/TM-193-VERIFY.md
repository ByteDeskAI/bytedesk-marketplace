# TM-193 — evidence

Commit under test: `edd9a93` plus the working-tree change described below.
Uncommitted paths at measurement time (`.claude/settings.json` is graft's session wiring, not part
of this change):

```
     M .claude/settings.json
     M agent-orchestration/CHANGELOG.md
     M agent-orchestration/dist/cli.cjs
     M agent-orchestration/dist/mcp.cjs
     M agent-orchestration/dist/probe-worker.cjs
     M agent-orchestration/src/runtime/acpx-driver.mjs
     M agent-orchestration/src/service.mjs
     M agent-orchestration/src/state/store.mjs
     M agent-orchestration/tests/unit/service-routing.test.mjs
     M agent-orchestration/tests/unit/state-store.test.mjs
```

Node 22.22.3, Linux, `agent-orchestration/`, `npm ci` in this worktree (151 packages).

## AC1 — a run directory without a snapshot never fails an unrelated spawn

Two tests, both **red before the fix and green after**. The control matters: without it a passing
test proves only that the fixture ran.

| test | file | at HEAD (before) | after |
|---|---|---|---|
| a half-swept run directory is ignored by list instead of failing every caller | `tests/unit/state-store.test.mjs` | `not ok 13 … code: 'AO_RUN_NOT_FOUND'` | `ok` |
| an orphaned run directory does not fail an unrelated spawn | `tests/unit/service-routing.test.mjs` | `not ok 18 … code: 'AO_RUN_NOT_FOUND'` | `ok` |

The "before" column was produced by restoring `src/state/store.mjs` and `src/service.mjs` from
`git show HEAD:…` and re-running the same two files.

The fixture reproduces the reported directory exactly: `run_484f8ec2-7f76-4b61-ac8e-fe91f27b422d`
holding `session.json` and `.sweep`, no `snapshot.json`, no journal. The service test then spawns
an unrelated run through the real `spawn` path, which is where the production failure surfaced
(`spawn` lists runs to enforce its concurrency limits).

The existing guard **"list fails closed when a valid run directory contains a corrupt journal"**
still passes, so the change distinguishes *no state* from *unreadable state* rather than swallowing
both.

## AC2 — an unadvertised model is refused during routing, and visible at doctor time

Test: *a model the ACP agent no longer advertises is refused before execution, not during it*
(`tests/unit/service-routing.test.mjs`) — red at HEAD, green after. It asserts the endpoint states
and that the `design` alias falls through the three Claude candidates
(`rejectionCodes: ["MODEL_UNAVAILABLE"]` each) to `codex`.

Run on a live machine, not only in a fixture — `AGENT_ORCHESTRATION_STATE_HOME=/tmp/tm193-doctor-state
node bin/agent-orchestration doctor`, against Claude Code 2.1.270 and Grok 1.0.30:

```json
"advertisedModelIds": {
  "claude": ["default", "opus[1m]", "sonnet", "haiku"],
  "codex": [],
  "grok-build": ["grok-4.6", "grok-4.5"],
  "kimi": []
},
"endpoints": {
  "claude.opus-5": "unavailable", "claude.fable-5-1": "unavailable",
  "claude.fable-5": "unavailable", "claude.opus-4-8": "unavailable",
  "openai.gpt-5.6-sol": "unavailable", "grok-build.default": "available",
  "kimi.default": "unavailable"
}
```

The claude list is character-for-character the one in the reported `ACP_MODEL_UNSUPPORTED` error, so
the probe is reading the same source the failure came from. `codex` and `kimi` are `unavailable`
for an unrelated reason on this machine (no authenticated session / no executable), and their empty
lists change nothing, which is the intended "advertised nothing ≠ refuses everything" behaviour.

**Consequence worth reading before merge:** on this Claude build every catalog Claude endpoint is now
refused at routing time. That is the honest state — those routes could not execute; they died at
their first turn — but it means `design` / `implementation` aliases will report
`AO_ROUTING_BLOCKED` instead of producing a run that fails later, until the model catalog is
reconciled with the ids the current agent advertises. Filed as a follow-up rather than guessed at
here: mapping `claude-opus-5` onto `opus[1m]` would be an unverified claim about which model runs.

## AC3 — both cases use a fixture state root

`state-store.test.mjs` builds a `RunStore` over `mktemp -d`; `service-routing.test.mjs` builds an
`OrchestrationService` over the suite's existing `{pluginRoot, stateRoot}` fixture and writes the
orphan into `fx.service.stateRoot/runs`. No test touches `~/.local/state/bytedesk`.

## Suite state

`node --test tests/unit/state-store.test.mjs tests/unit/service-routing.test.mjs` → **32/32 pass**.

Full unit run, `node --test --test-concurrency=1 tests/unit/*.test.mjs` → **617 pass, 17 fail,
4 skipped**. All 17 failures are in `tests/unit/roadmap.test.mjs` ("Roadmap validation failed with
71 errors"), which reads `ROADMAP.md` and `scripts/roadmap.mjs` — neither touched by this change,
so they are pre-existing and unrelated. Not verified as green; read as stale.

`npm run build` + `npm run build:check` → exit 0, and the only dist churn is this change
(`cli.cjs`, `mcp.cjs`, `probe-worker.cjs`).
