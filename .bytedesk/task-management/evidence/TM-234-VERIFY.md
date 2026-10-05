# TM-234 verification — operator-granted standing delegation for integrate/record-landing

## What changed
- `agent-orchestration/topology/lib/delegation.mjs` (new): grantDelegation, listStandingDelegations,
  revokeDelegation, findActiveDelegation. Append-only records (grant/revoke events folded on read)
  under `$XDG_STATE_HOME/bytedesk/agent-orchestration/delegations/<repoKey>.json`. Scope is a fixed
  allowlist (`integrate`, `record-landing`); grant/revoke refuse inside any managed agent session
  (AO_AGENT_ID set) or for a self-grant.
- `agent-orchestration/topology/cli.mjs`: `ao-topology delegate grant|list|revoke`, dispatched
  alongside the pre-existing routing-delegation `delegate`/`delegations` commands (which read no
  positional argument, so the two coexist under one verb without collision).
- `agent-orchestration/topology/lib/management.mjs`: `integrationEligibility`/`integrateTask` and
  `recordLanding` accept a live delegation for the caller's AO_AGENT_ID + repo + scope in place of
  `--authorized`. The merge record's `authorization` gains `delegated_by`/`delegation_id`;
  `authorized`/`actor` are unchanged in shape, so `task-management/lib/governance-check.mjs`
  (governedCompletion) needed no change — confirmed by reading it and by the existing
  `record-landing records an operator landing that governed completion accepts` test, which still
  passes untouched.
- `docs/repository-leads.md`: new "Standing delegation of integration authority" section.
- `CHANGELOG.md`: Unreleased/Added entry.
- `dist/cli.cjs`, `dist/mcp.cjs`: rebuilt (`npm run build`) since `topology/cli.mjs` changed.

## Commands run and results

### Unit tests (agent-orchestration), env -u TMUX -u TM_DISPATCH_WORKER -u TM_DISPATCH_BRANCH -u TM_DISPATCH_TASK -u AO_AGENT_ID node --test --test-concurrency=1 tests/unit/*.test.mjs
```
tests 742
pass 738
fail 0
skipped 4
```
New coverage: `tests/unit/topology-delegation.test.mjs` (5 tests: scope allowlist, self-grant and
managed-session refusal, append-only grant/list, revoke and re-revoke refusal with the raw on-disk
file asserted byte-identical for the original grant event, findActiveDelegation matching on
grantee+repo+scope+liveness+expiry). Two new tests added to `tests/unit/topology-management.test.mjs`
exercise `recordLanding` and `integrateTask` accepting a delegation instead of `--authorized`,
refusing before the grant exists, refusing a wrong-scope grant, and asserting the recorded
`delegated_by`/`delegation_id`/`channel`.

Note: this task-management dispatch environment sets `TM_DISPATCH_WORKER=1`. Left in place, that
variable makes `governedCompletion` (and `tm govern`) refuse unconditionally — a pre-existing,
unrelated fact about running tests inside a dispatched worker's own shell, not a regression from
this change. Confirmed by running the same suite with those variables present: the same 3 tests
fail with `TM_DISPATCH_WORKER`-shaped refusals, and 0 otherwise.

### Build
```
npm run -s build && npm run -s build:check
```
Both succeeded (see /tmp/TM-234-buildcheck.txt tail).

### Plugin manifest validation
```
claude plugin validate ./agent-orchestration
```
Passed with the expected single "No version specified" advisory (this plugin is deliberately
versionless; see `.claude/rules/version-enforcement.md`).

### Manual CLI smoke test (real ao-topology bin, isolated state home)
- `delegate grant --repo <tmp-repo> --to lead-1 --scope integrate,record-landing --reason "test grant"` → succeeds, returns id/grantor/grantee/repo_id/scopes/created_at/expires_at.
- `delegate list --repo <tmp-repo>` → shows the grant with `revoked_at: null`.
- `delegate grant --to lead-1` with `AO_AGENT_ID=lead-1` → `TOPOLOGY_DELEGATION_SELF`.
- `delegate grant --to lead-1` with `AO_AGENT_ID=lead-2` → `TOPOLOGY_DELEGATION_OPERATOR_ONLY`.
- `delegate grant --to lead-2 --scope deploy` → `TOPOLOGY_DELEGATION_SCOPE`.
- `delegate revoke <id>` → succeeds; revoking again → `TOPOLOGY_DELEGATION_REVOKED`.
- `delegate bogus` → `TOPOLOGY_SUBCOMMAND_UNKNOWN` naming both the new and the pre-existing form.

## Scope discipline
`DELEGATION_SCOPES = ['integrate', 'record-landing']` is a closed allowlist enforced in
`grantDelegation`; there is no code path that widens a grant to deploy, publish, push or spend.

## Not done / left to reviewer judgment
- Did not touch `task-management/lib/governance-check.mjs` (not required; verified by reading and
  by the passing existing test that exercises it against a real merge record).
- Did not add a Claude Code permission-rule example beyond the doc pointer, since this repo's own
  permission rules are local operator configuration, not something this plugin ships.
