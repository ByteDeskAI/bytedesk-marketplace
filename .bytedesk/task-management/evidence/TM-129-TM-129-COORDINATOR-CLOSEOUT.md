# TM-129 — coordinator review, integration, cache refresh, collection

Lead session, 2026-09-09. `main` = `origin/main` = `36b9308`.

## AC1 — reviewed, not accepted on the worker's word

TM-127 was reviewed against its 21 criteria before merge, and every gate was run
by the integrator rather than quoted from the worker. Recorded in
`TM-127-INTEGRATION-VERIFICATION.md`, including the finding that all four
coordinator reviews were **already fixed at `f3f21e7`** — verified in the tree,
not read from the review text — and that `lead.mjs` had a genuine zero diff.

Subsequent merges each got the same treatment, with worker claims checked rather
than accepted. Two worker claims were found **wrong** and corrected in writing: a
reported "pre-existing `build:check` failure at the base commit" that was really
an unprovisioned worktree, and a stale-patch-file reading that was one commit out
of date.

## AC2 — local runtime proof, reported separately from any publish claim

Run against a **fresh clone of the remote default branch**, not the working
checkout — the authoring machine registers this marketplace as a `directory`
source and therefore reads it live off disk, which is exactly how a delivery bug
stays invisible locally.

```
git clone --depth 1 --branch main https://github.com/ByteDeskAI/bytedesk-marketplace.git
cloned at: 36b9308
  ok  agent-orchestration/topology/lib/slots.mjs
  ok  agent-orchestration/topology/lib/census.mjs
  ok  agent-orchestration/topology/lib/delivery.mjs
  ok  agent-orchestration/topology/lib/addressing.mjs
  ok  agent-orchestration/topology/lib/roles.mjs
  ok  agent-orchestration/monitors/monitors.json
  ok  agent-orchestration/topology/PRESENCE-CONTRACT.md
```

The CLI runs from that clone **with no `node_modules`** — the topology layer is
dependency-free by design, and this proves it:

```
node topology/cli.mjs providers --json      → ok
node topology/cli.mjs role list --json      → roles: ['lead','reviewer','worker','designer','image-gen']
```

`claude plugin validate ./agent-orchestration` → **passes with exactly one
warning**, `"No version specified"`. That warning is the proof the plugin still
resolves to a commit SHA; following it would pin the plugin and stop consumers
receiving commits.

Gates on `main`: unit **464 tests / 460 pass / 0 fail / 4 skipped**, topology
**289/289**, contract 6 tests / 5 pass / 1 expected skip (design-client needs the
private registry), build and roadmap green, both frozen presence validators pass
**unmodified**, `topology/fixtures/presence-v1/` untouched throughout.

## AC3 — integrated, unrelated work preserved, cache verified

Integrated by the lead session across ten merges. **`task-management/` was never
staged**: it carries another session's in-flight changes to `bin/tm`,
`CHANGELOG.md` and `tests/test-hooks2.sh`, which this criterion requires
preserving. `git status` still shows them modified and untouched.

Versionless invariant held and re-verified on `main`: no `version` key in
`agent-orchestration/.claude-plugin/plugin.json`, none in the `marketplace.json`
entry, `package.json` at `0.7.1` as the only ecosystem semver marker.
`plugin.json` gained exactly one thing, `experimental.monitors` — the same
mechanism the sibling `task-management` plugin uses, whose monitors demonstrably
run.

**Cache — and a correction worth recording.** My first check reported the cache
as stale because every new module was missing from
`~/.claude/plugins/cache/bytedesk/agent-orchestration/`. That reading was wrong:
the cache is keyed by **resolved commit SHA**, one directory per delivered
version (53 of them). The entry for current `main`, `36b930898778`, contains
every new module including `monitors/monitors.json`.
`claude plugin update agent-orchestration@bytedesk` → *"already at the latest
version (36b930898778)"*. SHA resolution is working exactly as the versionless
design intends: every commit is a new version and the consumer already has it.

## AC4 — collected, then shut down; peers untouched

Verified **before** anything irreversible: the TM-127 worktree had zero dirty
files, its branch had zero commits not in `main`, the branch was merged, and the
merged content is present on `origin/main` (checked with `git cat-file -e` against
`origin/main`, not the local ref).

Only then: the TM-127 worker session `ao-marketplace-kimi-tm127-20260909` was
terminated, its worktree removed, and its branch deleted. That session had been
handed to this coordinator explicitly by the previous one — *"Store owns shutdown
of %113 after TM-129 review and collection"* — and it was quota-blocked and idle.

**Persistent product leads and peer sessions survive**: 37 tmux sessions still
alive afterwards, including all 32 gateway peer sessions. Nothing else was
touched.
