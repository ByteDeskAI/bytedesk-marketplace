---
name: bytedesk-software-engineer
description: ByteDesk software engineer — TDD-first, full development lifecycle for the bytedesk-platform repo. Invoke whenever starting a new feature, resuming in-progress work, committing changes, pushing, opening a PR, building frontend pages or components, implementing backend endpoints or consumers, running tests, doing a pre-commit review, or checking coverage. Also invoke for "brainstorm X", "let's explore building X", "start BDP-42", or any open-ended feature exploration. Use for "start feature X", "resume", "commit", "commit and push", "open a PR", "build the X page", "add endpoint for Y", "implement Z consumer", "run tests", "check coverage", "review my changes", "what's my status", or any full-stack development task in this repo. This skill is the single entry point for the day-to-day developer workflow and enforces Red-Green-Refactor on every code change — use it rather than calling bytedesk-feature-start or bytedesk-pr-ready directly.
user-invokable: true
argument-hint: "brainstorm [topic] | start {BDP-N | description} | tasks {BDP-N} | resume | commit [message] [--push] | push | pr | test | review | status | build <description>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
  - mcp__atlassian__searchJiraIssuesUsingJql
  - mcp__atlassian__getJiraIssue
  - mcp__atlassian__editJiraIssue
  - mcp__atlassian__transitionJiraIssue
  - mcp__atlassian__getTransitionsForJiraIssue
  - mcp__atlassian__addCommentToJiraIssue
  - mcp__atlassian__createJiraIssue
  - mcp__atlassian__createConfluencePage
  - mcp__atlassian__getConfluencePage
  - mcp__atlassian__searchConfluenceUsingCql
  - mcp__atlassian__getPagesInConfluenceSpace
---

## Mission

Single entry point for day-to-day development on `bytedesk-platform`. Handles the full loop: kickoff → **test RED** → implement → **test GREEN** → refactor → commit → PR. Covers both frontend (Next.js) and backend (.NET).

**Operator handoffs:** Two sibling skills own the fragile lifecycle verbs — don't reproduce their command chains here.

- `/bytedesk-worktree-operator` — `scripts/dev/workflow.mjs` for this repo: worktree lifecycle, localDev remaps, develop-runtime sync, ship/land/cleanup, Helm apply, pod verify, cluster health, drift remediation.
- `/bytedesk-omnigent-operator` — `scripts/dev/workflow.mjs` in the `bytedesk-omnigent` repo: plugin-reload, config-sync, ship/land, drift-check. Invoke for any omnigent plugin, agent config, or gateway work.

**TDD is not optional here.** The repo enforces it via a `tdd-gate.sh` PreToolUse hook (blocks edits to new `.cs` files if no test file exists), a Stop hook that runs the unit suite and warns on <90% coverage, and a CI coverage gate that blocks PR merge at <80%. Working with the grain of these gates — not around them — is faster.

**Worktree guard:** Before `start`, `resume`, `build`, `commit`, `push`, or `pr`, verify the session is in a dedicated feature worktree:

```bash
git rev-parse --path-format=absolute --show-toplevel
git rev-parse --path-format=absolute --git-common-dir
git branch --show-current
```

Implementation work must happen under `.claude/worktrees/<name>` on `feature/*`, `bugfix/*`, `release/*`, or `hotfix/*`. If the current checkout is the canonical repo or the branch is `develop`/`main`, stop and create or switch to a worktree first:

```bash
canonical="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
node "$canonical/scripts/dev/workflow.mjs" new BDP-123-short-slug   # worktree-operator (ADR-0058)
cd "$canonical/.claude/worktrees/BDP-123-short-slug"
```

Use the canonical checkout only for pulling/updating `develop`, creating/removing/listing worktrees, release/back-merge bookkeeping, and read-only inspection. Keep one Jira scope per worktree.

**Skill handoffs:**

| Need | Action |
|---|---|
| Session start / where was I? | Call `/bytedesk-session-start` |
| Start a new feature | `start` command below → calls `/bytedesk-feature-start` |
| Worktree / localDev / ship / land / Helm-apply / pod-verify / cluster-health / drift | Call `/bytedesk-worktree-operator` |
| Omnigent plugin / agent config / gateway work | Call `/bytedesk-omnigent-operator` |
| Create the PR | `pr` command below → calls `/bytedesk-pr-ready` |
| Design critique / token choices | Call `/bytedesk-design` |
| Extract inline JSX into atoms | Call `/bytedesk-atomize` |
| Wire browser realtime | Call `/bytedesk-realtime-engineer` |
| Office workflow runtime proof | Call `/bytedesk-workflow-runtime-smoke` |
| DevProjects sandbox image/runtime/deploy proof | Call `/bytedesk-devprojects-sandbox-refresh` |
| DevProject custom domains / DNS / Railway proof | Call `/bytedesk-devproject-domain-operator` |
| Multi-agent integration branch / merge-commit fan-in | Call `/bytedesk-integration-branch-operator` |
| Production release / TeamCity / Fleet status | Call `/bytedesk-production-release-teamcity` |
| Remote gateway host/service/screen/files diagnostics | Call `/bytedesk-remote-gateway-operator` |
| Maya Office-chat workflow routing | Call `/bytedesk-maya-workflow-router` |
| Structurizr drift / diagram co-commit | Call `/bytedesk-architecture-sync` |
| Partition decomposition / C2–C3 modeling | Call `/bytedesk-architecture-decompose` |
| Named agent dispatch | `named-agent-dispatch show <agent>` |

**Omnigent exception:** The `bytedesk-omnigent` repo does not use the Platform
managed worktree operator. For Omnigent tasks, use `/bytedesk-omnigent-operator`
and follow its raw-worktree/PR-to-`main` lifecycle. Do not apply Platform
`workflow.mjs new/ship/land` assumptions to Omnigent.

**Operator verb quick-routing** (delegate to `/bytedesk-worktree-operator`; verbs run via `scripts/dev/workflow.mjs`):

| User says | Verb |
|---|---|
| "apply helm" / "helm upgrade" / "apply chart" | `apply-helm` |
| "did the pod come up?" / "is my change loaded?" / "tail logs to check {service}" | `verify-pod <service>` |
| "are pods healthy?" / "any restarts?" / "is the cluster ok?" | `health-check` |
| "drift" / "manifests out of sync" / session-start drift warning | `drift-remediate` |
| "develop-remote missing/dirty/behind" | `ensure-develop-remote` |
| "land failed to apply manifests" / "re-apply after merge" | `apply-merged-manifests` |

---

## TDD First — The Development Law

Every new behavior follows this cycle. The full rules are in `.claude/rules/testing.md` — read it before touching any test or production code. Here's the cycle you'll use constantly:

```
RED    → write a failing test that names the behavior you want
         (compile error counts — reference a class that doesn't exist yet)
         confirm it fails: dotnet test ... --filter "Category=Unit&FullyQualifiedName~MyTests"

GREEN  → write the minimum production code to pass that one test
         nothing more — resist the urge to build the full feature

REFACTOR → rename, extract, simplify — no new behavior, no new tests
            re-run to confirm still green

REPEAT → back to RED for the next behavior
```

**The three laws (enforce themselves via the gate hooks):**
1. No production code unless to make a failing test pass.
2. No more test code than needed to produce one failure (compile error counts).
3. No more production code than needed to pass the current failing test.

**For frontend:** TypeScript types and component props interfaces serve as the partial specification. Define types and the hook/component interface first, then implement. Full xUnit-style TDD applies to backend only — but the discipline of "define the contract before the code" carries across.

---

## Tool-use safety (BDP-1493 / BDP-1494)

These prevent two recurring, expensive mistakes from transcript review:

- **Read before every Edit.** `Edit` fails with *"File has not been read yet"* unless the file was `Read` earlier in the current turn. In a worktree, the canonical-path Read does **not** count — Read the worktree copy. Re-Read after any external/agent/operator modification before editing again.
- **Never co-batch git mutations.** Run `git add`/`commit`/`checkout`/`reset`/`stash`/`land` **alone, one per turn**, and read the result before the next action. A cancelled multi-call batch that contains a git mutation corrupts the repo (lost commits, stray stashes). Edits/builds/tests may batch; git mutations may not.
- **Commit → push is atomic.** Never leave a commit unpushed — an unpushed commit breaks the localDev/deploy path. Use the operator's `ship` (always pushes) rather than a bare `git commit`.

---

## Workflow Commands

### `brainstorm [topic]`

Open-ended exploration for when you know the direction but not the scope. Use before committing to a Jira Epic or implementation plan.

**Phase 1 — Iterate**

Use the topic as the seed (or ask: "What are you thinking about building?"). Iterate freely — ask clarifying questions, explore edge cases, challenge assumptions, propose alternatives.

Listen for: the core problem being solved, what success looks like, what's in/out of scope, and what's unknown. Keep going until the user signals done ("that's it", "create the epic", "let's capture this").

**Phase 2 — Synthesize**

Produce a summary and confirm before creating artifacts:

```
## Brainstorm Summary: {topic}
Core problem: {1–2 sentences}
What we're building: ...
In scope: ...
Out of scope (this iteration): ...
Open questions / unknowns: ...
Suggested approach: ...
```

**Phase 3 — Capture**

After user confirmation:

1. **Create a Jira Epic** (`mcp__atlassian__createJiraIssue`, type: Epic, project BDP) — summary: topic name, description: synthesis, labels: relevant `service:*` labels

2. **Find the "Discovery" folder** in Confluence space `491524`:
   CQL: `title = "Discovery" AND space.key = "BDP"` — take first result's `id` as parent page

3. **Create Confluence page** named `{BDP-N} Discovery` under Discovery with synthesis + Jira Epic link (`mcp__atlassian__createConfluencePage`)

4. **Add Jira comment** on the Epic linking to the Confluence doc

Tell the user: "Epic `BDP-N` created. Discovery doc saved. Run `/bytedesk-software-engineer start BDP-N` when ready to plan implementation."

---

### `start {BDP-N | description}`

**If a Jira Epic ID is provided** (e.g., `start BDP-42`) — an Epic + Discovery doc exist from `brainstorm`:

Read `references/brainstorm-and-planning.md` → "Planning Phase" for full steps. In brief:
1. Fetch the Jira issue and search Confluence for `BDP-N Discovery` doc
2. Present your read of the Discovery, then iterate — fill gaps, confirm implementation details, settle TDD sequence
3. When done: produce the feature brief, upload as Confluence page `BDP-N Plan` under the "Plans" folder, add Jira comment with URL
4. Tell the user: "Plan ready. Run `/bytedesk-architect review BDP-N` before implementation."

Transition the Epic to **In Progress** before starting the hardening session. If the Discovery doc isn't found, proceed as if given a description.

**If a description is provided** (new feature, no existing Epic):

Read `references/brainstorm-and-planning.md` → "Brainstorm Phase" for full steps. In brief:
1. Gather context — fetch Jira/Confluence if a ticket is referenced, or use `AskUserQuestion` for the 6 critical scope questions
2. Research the codebase — find similar patterns, existing pages, relevant ADRs
3. Write the feature brief — concrete acceptance test, scoped backend/frontend work, TDD sequence
4. Get sign-off — share the brief, refine, then call `/bytedesk-feature-start <description>`

### `tasks BDP-N`

Convert an architect-approved Plan doc into concrete Jira child Tasks on the Epic. Run after plan mode is approved — this is the bridge from "plan approved" to "implementation started."

**Step 1 — Fetch the plan:**
Search Confluence for `BDP-N Plan` (CQL: `title = "BDP-N Plan" AND space.key = "BDP"`). Read the full page content.

**Step 2 — Propose implementation units:**
Group the plan's backend scope, frontend scope, and TDD sequence into logical Tasks — typically one per service layer and one per frontend area. A Task should represent roughly a half-day to a day of work. Never one Task per test.

Show the proposed list before creating anything:
```
Proposed Tasks for BDP-N:
1. Backend: {feature} — service + endpoint [~{N} TDD cycles]
2. Backend: DB migration + {entity} model
3. Frontend: {feature} page + components
```

Ask: "Create these as child Tasks on `BDP-N`?"

**Step 3 — Create Tasks:**
For each confirmed Task, call `mcp__atlassian__createJiraIssue`:
- `issueType`: Task, `project`: BDP, `parent`: BDP-N Epic ID}
- `summary`: the Task summary
- `description`: relevant scope excerpt + applicable TDD sequence items

Report the created IDs, then suggest: "Start with `first-BDP-N` — run `/bytedesk-software-engineer start first-BDP-N`."

---

### `resume`

Pick up where you left off in the current worktree. If the session is in the canonical checkout or on `develop`/`main`, locate or create the relevant worktree before implementing.

```bash
git rev-parse --path-format=absolute --show-toplevel
git rev-parse --path-format=absolute --git-common-dir
git branch --show-current
git status --short
git log --oneline origin/develop..HEAD
```

Classify the checkout as canonical or `.claude/worktrees/<name>`, then extract BDP-N from the branch name. Fetch the Jira issue — if it isn't **In Progress**, transition it now. Check whether a red test exists for in-progress work; if not, write it before any implementation. Report: worktree, branch, Jira status, uncommitted changes, commits ahead of develop, and whether the unit suite is currently passing.

### `commit [message] [--push]`

Commit staged changes with a properly formatted message. Run whenever the user says "commit" or "commit and push".

**Step 0 — Confirm the worktree guard:**
```bash
git rev-parse --path-format=absolute --show-toplevel
git branch --show-current
```
If the branch is `develop` or `main`, or the top-level path is the canonical checkout instead of `.claude/worktrees/<name>`, stop. Move the work into a feature worktree before committing.

**Step 1 — Run the test gate first:**
```bash
cd src && dotnet test ByteDesk.sln --filter "Category=Unit" 2>&1 | tail -20
```
If any test fails, stop. Do not commit failing tests. Fix the failure, then commit.

```bash
# Also verify no skipped tests crept in
grep -rn "Skip\s*=" tests/ --include="*.cs"
```
If any Skip entries exist, stop — they violate the zero-tolerance rule.

**Step 2 — Understand what's staging:**
```bash
git status --short
git diff --stat HEAD
```
If nothing is staged, stage tracked modifications: `git add -u`

**Step 2a — Architecture drift (when `src/ByteDesk.*` or shared infra changed):**

Invoke `/bytedesk-architecture-sync` or run:

```bash
architecture-sync --mode working-tree
```

If the gate reports violations, update `docs/architecture/workspace.dsl` (or
`fragments/*.dsl`), stage the diagram with the code, then re-run. Install hooks
once per machine: `bash scripts/dev/install-hooks.sh`.

**Step 3 — Format the commit message:**

Determine type and scope from changed files:

| Changed files | Type | Scope |
|---|---|---|
| `*.tsx`, `*.ts` in `ByteDesk.Web/` | feat / fix | frontend |
| `*.cs`, `*.csproj` | feat / fix | backend |
| `tests/**/*.cs` only | test | unit / integration |
| Both prod `.cs` and `tests/**` | feat / fix | backend |
| `.github/`, `infra/` | ci / chore | infra |
| `*.md`, docs | docs | — |

Extract BDP-N: `git branch --show-current | grep -oE 'BDP-[0-9]+'`

```
type(scope): concise description [BDP-N]
```

Examples:
```
feat(backend): add contact archiver service [BDP-138]
test(sales): add unit tests for radar scan consumer [BDP-145]
feat(frontend): add notifications list page [BDP-142]
feat(backend,frontend): wire archive mutation end-to-end [BDP-142]
```

**Step 4 — Commit:**
```bash
git commit -m "$(cat <<'EOF'
type(scope): description [BDP-N]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

**Step 5 — Post-commit:**
- `.cs` files committed → if runtime validation is needed, hand off to `/bytedesk-worktree-operator` for `workflow.mjs verify-pod <service>` (rolls + tails until the new code is loaded). Never hand-build `helm upgrade` or `kubectl rollout`/`logs` chains.
- Domain model files changed → verify a migration was included: `git diff --name-only HEAD~1 | grep Migration`
- `--push` or "commit and push" → `git push origin HEAD`

### `push`

```bash
git push origin HEAD   # add -u if no upstream yet
```

Stop if on `develop` or `main`, or if the checkout is canonical. Push only from the dedicated feature worktree branch.

### `pr`

Open a pull request. First verify the worktree guard, then delegate entirely to `/bytedesk-pr-ready`.

That skill handles: rebase from develop → unit tests → lint → coverage check → PR creation with BDP-N title → CI watch → Jira comment.

### `test`

Run the appropriate tests and show coverage. Detect what changed:

```bash
git diff --name-only HEAD | head -40
```

| Files changed | Tests to run |
|---|---|
| `*.cs` | Unit suite for affected service |
| `*.tsx`, `*.ts` | ESLint + TypeScript check |
| Both | Run all |
| `tests/**` | Full unit suite |

**Backend — unit suite with coverage:**
```bash
# Single service (fast dev loop)
dotnet test tests/ByteDesk.{Service}.Tests --filter "Category=Unit" \
  --collect:"XPlat Code Coverage" --results-directory ./coverage/{Service} \
  --settings src/coverage.runsettings 2>&1 | tail -20

# Check coverage (requires reportgenerator)
reportgenerator -reports:"./coverage/{Service}/**/coverage.cobertura.xml" \
  -targetdir:./coverage/report -reporttypes:TextSummary
cat ./coverage/report/Summary.txt
```

Coverage thresholds: **90% for new code** (Stop hook warns), **80% overall** (CI blocks merge).

**Frontend — lint + TypeScript:**
```bash
cd src/ByteDesk.Web && npx next lint --max-warnings 0 2>&1 | tail -15
```

Report pass/fail and actual coverage %. On failure: identify the failing test or lint error and suggest a targeted fix. Do not proceed to `commit` until the suite is green and coverage is ≥90% for changed services.

### `review`

Pre-commit sanity check — scans without modifying files.

**TDD checks (run first):**
```bash
# New production .cs files without a corresponding test file
for f in $(git diff --name-only HEAD --diff-filter=A | grep "src/.*\.cs$" | grep -v "Migrations\|Designer\|Program"); do
  service=$(echo $f | grep -oP 'ByteDesk\.\w+')
  classname=$(basename $f .cs)
  test_exists=$(find tests/ -name "${classname}Tests.cs" 2>/dev/null | head -1)
  [ -z "$test_exists" ] && echo "MISSING TEST: $f"
done

# Skipped tests (zero tolerance)
grep -rn "Skip\s*=" tests/ --include="*.cs"

# Assert-less tests (smell)
grep -rn "\[Fact\]\|\[Theory\]" tests/ --include="*.cs" -l | \
  xargs grep -L "Should()\|Assert\." 2>/dev/null
```

**Frontend rule checks:**
```bash
grep -rn "fetch(" src/ByteDesk.Web/src --include="*.ts" --include="*.tsx" \
  | grep -v "// ok" | head -10

grep -rn "refetchInterval" src/ByteDesk.Web/src --include="*.ts" --include="*.tsx" \
  | grep -v "//" | head -10

grep -rn 'style={{' src/ByteDesk.Web/src/app --include="*.tsx" \
  | grep -v "var(--\|--index\|// legit" | head -10
```

**Backend rule checks:**
```bash
grep -rn "JsonSerializer.Serialize\|JsonSerializer.Deserialize" src --include="*.cs" \
  | grep -v "Extensions.SharedJsonOptions\|JsonDefaults.Options\|// ok" | head -10
```

Report findings as P0 (block commit) / P1 (should fix) / P2 (nice to fix).

### `status`

Quick situational awareness:

```bash
git rev-parse --path-format=absolute --show-toplevel
git rev-parse --path-format=absolute --git-common-dir
git branch --show-current
git status --short
git log --oneline origin/develop..HEAD | head -10
```

Fetch the Jira issue for the current BDP-N. Show: worktree classification, summary, status, uncommitted changes, commits ahead of develop, and whether the last unit run was green.

For cluster-level state (pre-PR sanity, post-localdev compile check, session-start drift warnings), hand off to `/bytedesk-worktree-operator`:

- "are pods healthy?" / pre-PR sanity → `workflow.mjs health-check`
- "did the dotnet watch actually recompile?" after `use-localdev` → `workflow.mjs verify-pod <service>`
- session-start says "drift" / manifests out of sync → `workflow.mjs drift-remediate`

---

## Build Mode — Implementing Features

When the user asks to build or implement something, always determine work type first, then follow the TDD cycle.

### Detect work type

Use `AskUserQuestion` when scope is ambiguous between backend-only, frontend-only, or full-stack. Most features are full-stack.

### Backend — Red-Green-Refactor

Read `.claude/rules/testing.md` and `.claude/rules/backend.md` first.

**For every new service class, consumer, or endpoint:**

1. **RED** — Create the test file first:
   ```
   tests/ByteDesk.{Service}.Tests/Unit/{ClassName}Tests.cs
   ```
   Write a test referencing the non-existent production class. Confirm it fails:
   ```bash
   dotnet test tests/ByteDesk.{Service}.Tests \
     --filter "Category=Unit&FullyQualifiedName~{ClassName}Tests"
   ```
   Compile error = valid RED. Only proceed to GREEN when you have a clear failing test.

2. **GREEN** — Create the production file:
   ```
   src/ByteDesk.{Service}/{Layer}/{ClassName}.cs
   ```
   Write the minimum code to pass that one test. Run the filter again to confirm green.

3. **REFACTOR** — Simplify structure without changing behavior. Re-run to confirm green.

4. **Repeat** — Back to RED for the next behavior. One cycle per class method or behavior.

Additional backend rules:
- Cross-service work → read `.claude/rules/inter-service.md`
- Schema changes → read `.claude/rules/database.md`; add EF Core migration
- Async work >2s → Tool Action Pattern (7-step: JobType + Command + Consumer + Endpoint + register + frontend tool + frontend API)
- After any `.cs` change needing runtime validation: `/bytedesk-worktree-operator` → `workflow.mjs verify-pod <service>` (don't hand-roll `helm`/`kubectl`)

### Frontend — Types-First

Read `references/frontend-impl.md` for full patterns. The TDD discipline for frontend starts with the contract:

1. **Define types first** — write the `interface {Type}` and API service method signatures before any implementation
2. **Define the hook interface** — write the hook signature and return shape before the `useQuery` body
3. **Implement** — follow the API service → hook → page → UI composition order
4. **All four states** — loading / empty / error / default are required; missing states = incomplete

After implementation: `/bytedesk-atomize --path <changed-dir>`, then `test`, then `commit`.

### Full-stack

Backend first (RED → GREEN for the endpoint and any consumers), then frontend:
1. Backend: RED → GREEN → REFACTOR → `/bytedesk-worktree-operator` → `workflow.mjs verify-pod <service>` if runtime validation is needed
2. Frontend: types → API service method → React Query hook → page/component
3. `/bytedesk-atomize` → `test` → `review` → `commit`

---

## Self-Verification Checklist

**TDD gate (backend — must all be true before commit)**
- [ ] Test file written BEFORE production file — confirmed red
- [ ] All new behavior covered: 2+ tests per public method (happy + failure path)
- [ ] `dotnet test ... --filter "Category=Unit"` passes — all green
- [ ] Coverage ≥90% for modified services (Stop hook passed, no warnings)
- [ ] No `[Fact(Skip=...)]` or `[Theory(Skip=...)]` anywhere in `tests/`
- [ ] Integration test exists for any new HTTP endpoint
- [ ] Smoke test updated for any new message contracts

**Backend**
- [ ] `ApiResponse<T>` wraps every response — never raw entity
- [ ] `ApiResults` helpers used throughout
- [ ] Async work >2s uses Tool Action Pattern
- [ ] Manual serialization uses `Extensions.SharedJsonOptions`
- [ ] New services registered in `Program.cs` with correct DI scope
- [ ] New consumers registered in `AddByteDeskMessaging()`

**Frontend**
- [ ] Types defined before implementation
- [ ] No raw `fetch()`; browser realtime uses `useTopic` / `useAdminTopic`
- [ ] Domain API service used; query key factory exists
- [ ] All four states covered: loading / empty / error / default
- [ ] No hardcoded hex/rgb/oklch — CSS vars only
- [ ] Formatters from `@/lib/utils/format`, not redefined
- [ ] Mutations: `invalidateQueries` on success, toast on both outcomes
- [ ] `npx next build` passes with zero TypeScript errors

**Design patterns (non-negotiable — CLAUDE.md §5)**
- [ ] Non-trivial approach fits a documented pattern (ADR-0008 GoF, ADR-0013 Tool Action, ADR-0009 EIP, domain ADRs) — no ad-hoc structure where a pattern fits
- [ ] Cross-service / new-entity / new-pattern approach validated via `/bytedesk-architect` and ADR evidence **before** coding
- [ ] Significant new approach with no fitting pattern → ADR written (`/bytedesk-adr`)

**Both**
- [ ] Jira transitioned to correct status
- [ ] Commit message: `type(scope): description [BDP-N]`
- [ ] `/bytedesk-atomize` run on the changed path — **required** for any `src/ByteDesk.Web/**` change, not optional

---

## Audit Mode — `--audit [path]`

Run the `review` command scans above against a specific path, or the whole frontend if no path given. Report P0/P1/P2 violations without modifying files.
