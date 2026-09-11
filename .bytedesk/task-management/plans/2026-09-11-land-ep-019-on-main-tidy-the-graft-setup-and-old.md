# Land EP-019 on `main`, tidy the graft setup and old worktrees, then push

## Context

You want the unfinished agent-orchestration work fixed, merged and pushed, so the next feature
(TM-167 or TM-168, both blocked on TM-164) can start. You also asked for three things: commit the graft
wiring you use and remove the Cursor, Gemini and Windsurf configs; delete superseded branches and merged
worktrees; and leave `fix/orchestration-metadata` alone.

Facts from this session (verified unless marked *read*):

- **Nothing is committed and unpushed.** `main` = `origin/main` = `1ccbc88`.
- **The waiting work is uncommitted, in the shared main checkout.** 17 modified files plus 2 untracked
  (`topology/lib/incarnation.mjs`, `topology/lib/observer-session.mjs`). It holds TM-162 (supervisor
  ownership), TM-163 (prompts bound to one exact process) and TM-164 (proof-gated `observer start`).
  Author: Codex session `01a088d4-…`, last write 2026-09-10 18:09; no process running now.
- **Its base is `1de163b`.** `main` later changed only 2 of those files: `topology/lib/doctor.mjs`
  (TM-169, `7490c23`) and `tests/unit/topology-supervision.test.mjs` (tmux isolation, `5a962d5` / `394c5d1`).
  Committing the working copy as it stands would revert both.
- **Likely cause of the mailbox guard failure** (from reading the code, not yet measured):
  - The new `startRepositorySupervision` waits up to 10 s for the spawned `ao-topology supervise`
    child to take the lock and publish its record. That child then lists tmux panes.
  - On `HEAD`, `send` returned before the child got that far, so the guard passed by winning a race.
- **`topology-supervision.test.mjs` fails about 1 run in 6** on "records where it went and how often it has been restarted" (*read*, TM-164 comments).
- **TM-164 criterion 4 has no test.** Nothing tests the observer against real tmux.
- **Graft:**
  - The `graft/` cache is already gitignored at the root.
  - `graft init --dry-run --agents claude agents copilot grok` lists the wiring to keep: `.claude/settings.json`, `.claude/helpers/*.cjs`,
    `.claude/skills/graft/`, `.mcp.json`, the `AGENTS.md` section, `.grok/`, `.github/copilot-instructions.md`.
  - `GEMINI.md` belongs to the Gemini agent. `.cursor/hooks.json` hard-codes absolute paths.
  - A stray graft cache sits in `.bytedesk/agent-orchestration/agents/fd2b831f/graft/.cache/`.
  - Project `settings.json` also adds a `statusLine`, which overrides your own global status line, plus two unrelated permissions:
    `Bash(graft-dev:*)` and `Bash(node dist/cli.js:*)`.
- **Worktrees:**
  - 39 are merged into `origin/main`, and no process runs in any of them.
  - 35 of those are clean. The other 4 hold only an untracked `node_modules` symlink or a regenerable `graft/` cache.
  - 12 more merged branches have no worktree.

## Roles

- **Lead (this session):** every git operation on shared state, the board, the release, the graft commit, the merge, the push and the clean-up.
- **W1 and W2:** parallel `general-purpose` subagents, each in its own worktree and branch cut from the integration commit.
  - File sets are disjoint.
  - Each commits on its own branch with explicit `git add` paths.
  - Neither runs `tm`, touches `.bytedesk/`, or commits `graft/`.

## Steps

### 1. Integration branch (lead)

1. `git fetch origin main`; confirm the tip (use the new tip if it moved). Re-confirm nothing holds session `01a088d4`.
2. **Back up the WIP** to the scratchpad:
   - `git diff HEAD` as a patch.
   - The diff from `1de163b` for the 17 files.
   - Copies of the 2 untracked files.
3. `git worktree add .bytedesk/worktrees/EP019-snapshot -b tm/EP-019-snapshot 1de163b`. Copy the 19 files in, then commit
   `EP-019 WIP snapshot: TM-162, TM-163, TM-164 (Codex session 01a088d4)`.
4. `git worktree add .bytedesk/worktrees/EP019-integration -b tm/EP-019-integration origin/main`, then
   `git cherry-pick tm/EP-019-snapshot`. Resolve the 2 expected conflicts by keeping **both** sides:
   - `doctor.mjs`: TM-169's git-common-dir trust key plus TM-162's `SUPERVISOR_*` problems.
   - Supervision test: the isolation helper plus TM-162's ownership assertions.
5. **Check direction, not counts** (rule 9). Print each line and confirm:
   - `git-common-dir` appears once in `doctor.mjs`.
   - `isolatedEnv` appears 6 times in the supervision test.
   - `SUPERVISOR_OWNERSHIP_MISMATCH` is present.
   - Both new lib files are present.
   - `git diff origin/main --stat` lists only the 19 WIP paths.
6. Baseline on this clean tree: `node --test --test-concurrency=1 tests/unit/topology-*.test.mjs`. Record the commit and the failing test names.

### 2. Parallel fixes (W1 and W2 start together; lead does step 3 meanwhile)

**W1 — supervisor start handshake** · `.bytedesk/worktrees/EP019-supervision`, branch `tm/EP019-supervision-start`.
Owns `tests/unit/topology-mailbox.test.mjs`, `tests/unit/topology-supervision.test.mjs` and `startRepositorySupervision`
in `topology/lib/supervision.mjs`.
1. **Measure before fixing** (rule 7). Make the fake `tmux` shim append `$*` and the caller's argv
   (`ps -o args= -p $PPID`). Print the list, then decide from those values:
   - **Caller is the spawned `supervise` child:**
     - Keep the invariant that `send` itself never runs tmux and nothing sends keys.
     - Isolate the child three ways: `TMUX=''`, a per-test `TMUX_TMPDIR`, and a scoped server.
     - Kill it in `t.after` using the pid `send` returns.
     - Do not loosen the assertion to "reads are fine" without this evidence.
   - **Caller is `send`:** find and remove the inline tmux path.
2. **The intermittent failure:**
   - Run `node tests/stability.mjs --runs 10 --pattern tests/unit/topology-supervision.test.mjs`, then read the failing assertion's text and fix what it names.
   - If the cause is the 10 s start deadline under load, return an explicit not-yet-published state instead of a record with no source identity. Then have the test pass a generous `startTimeoutMs`.
3. **Done when** both files pass 10 of 10 stability runs on a clean tree. Report the shim output and the stability summary verbatim.

**W2 — TM-164 criterion 4, real-tmux acceptance** · `.bytedesk/worktrees/EP019-observer-tmux`, branch `tm/EP019-observer-tmux`.
Owns `tests/contract/topology-tmux.test.mjs`. It may fix `topology/lib/observer*.mjs` only if the test exposes a defect, and must say so.
1. Follow `.claude/rules/tmux-test-isolation.md`. Copy the pattern in `tests/unit/topology-supervision-consistency.test.mjs`:
   `TMUX: ''`, a per-test `TMUX_TMPDIR`, and every `kill-*` scoped with `-L` or `-S`.
2. The test must prove three things:
   - `observer start` commits no attachment before the managed observer acknowledges its prompt from the exact process.
   - The committed attachment is `version: 2` with `observation_allowed: true` and a live `observer_binding`.
   - `prompt_revision` matches the current composed prompt.
3. **Done when** `npm run test:topology:tmux` passes 5 of 5 on a clean tree. Report the output verbatim.

Run `npm ci` in the worktree if dependencies are needed. Never symlink `node_modules` (rule 2).

### 3. Graft wiring (lead, main checkout, in parallel with step 2 — disjoint files)

1. **Delete** `.cursor/`, `.gemini/`, `.windsurf/`, `GEMINI.md`, the stray `.bytedesk/agent-orchestration/agents/fd2b831f/graft/`,
   and the empty file named `=`.
2. **`.claude/settings.json`:**
   - Keep the graft `hooks` blocks and `footerLinksRegexes`.
   - Keep only `Bash(graft:*)` and `Bash(npx graft:*)` in permissions.
   - Move `statusLine` and `subagentStatusLine` into your gitignored `.claude/settings.local.json`. Your view in this repo stays the same, and nobody else's status line gets overridden.
3. **`.gitignore`:** keep `/graft/`, and add `**/graft/.cache/`, `**/graft/.graph/` and `.claude/settings.local.json`.
   Do not add an unanchored `graft/`, because it would also ignore `.claude/skills/graft/` and `.grok/skills/graft/`.
4. **Commit these explicit paths only:**
   - `.claude/settings.json`, `.claude/helpers/graft-hooks.cjs`, `.claude/helpers/graft-statusline.cjs`
   - `.claude/skills/graft/SKILL.md`, `.mcp.json`, `.ignore`, `.gitignore`, `AGENTS.md`
   - `.github/copilot-instructions.md`, `.grok/config.toml`, `.grok/skills/graft/SKILL.md`

   The helpers keep graft's generated fast path `/home/ryan/.volta/…`. On this machine it is the only
   path that resolves (`npm root -g` misses the Volta install). Elsewhere it is skipped and the helper falls back, or quietly does nothing.
   Message: `Wire graft for Claude, Codex, Copilot and Grok; drop Cursor, Gemini and Windsurf`.
5. Check:
   - `jq . .claude/settings.json` parses.
   - `echo '{}' | node .claude/helpers/graft-hooks.cjs session-start` exits 0.
   - `git check-ignore` ignores `x/graft/.cache/y` but not `.claude/skills/graft/SKILL.md`.
   - `git diff --cached --stat` lists only the paths above.

### 4. Integrate, verify, release (lead)

1. Read both worker diffs. Merge `tm/EP019-supervision-start` and `tm/EP019-observer-tmux` into `tm/EP-019-integration`.
2. On that clean tree, record the commit beside each result:
   - `node --test --test-concurrency=1 tests/unit/*.test.mjs` — 0 failures.
   - `node tests/stability.mjs --runs 5 --pattern 'tests/unit/topology-*.test.mjs'` — no inconsistent tests.
   - `npm run test:topology:tmux` and `npm run build:check`.
   - `claude plugin validate ./agent-orchestration` (plain; one "No version specified" warning is expected).
3. **Release v0.8.0.** It is a minor release because it adds the `observer start` command and controlled restart.
   - `agent-orchestration/package.json`: `0.7.1` → `0.8.0`.
   - `CHANGELOG.md`: `[Unreleased]` → `## [0.8.0] — 2026-09-11`. Add TM-162 (Changed), TM-163 and TM-164 (Added), and W1's fix (Fixed).
   - `src/mcp.mjs` stays `0.5.0`, because v0.6.0–v0.7.1 never advanced it.
   - Add no `version` to `plugin.json` or `marketplace.json`.
   - Commit: `agent-orchestration: release v0.8.0 — proof-gated observer start (TM-162, TM-163, TM-164 / EP-019)`.

### 5. Land on `main` and push (lead, main checkout)

1. `git fetch origin main`. If it moved, rebase the integration branch and repeat the unit and stability runs from step 4.2.
2. **Clear the WIP from the main checkout.** This is the destructive step.
   - First confirm the step 1.2 backup exists and `git diff tm/EP-019-integration -- <19 paths>` shows only the intended fixes.
   - Then `git restore -- <17 paths>` and remove the 2 untracked lib files.
3. `git merge --no-ff tm/EP-019-integration -m "Merge EP-019: supervisor ownership, incarnation-bound prompts, proof-gated observer start"`.
4. **Board:** `tm accept TM-164` for criteria 1–4, `tm evidence` with the step 4.2 outputs, then `tm done TM-164`. Confirm TM-167 and TM-168 are unblocked.
5. **Store commit, explicit paths only.** Commit `7885aa9` reverted code from a store commit, so each path is named.
   - Paths: the TM-162…TM-170 task files; evidence `TM-137-PRODUCER-V2.md`, `TM-165-MEASUREMENT.md`, `TM-169-TRUST.md` and `TM-170-GUARD.md`; EP-018 and TM-137; `config.json`; `.bytedesk/knowledge/.km/events.jsonl`; `.bytedesk/agent-orchestration/agents/eff264fa/*`; and the TM-164 records.
   - `git diff --cached --stat` must list only `.bytedesk/` paths.
6. `git status` must show no unexpected changes. `fix/orchestration-metadata` is a separate worktree and is not touched.
7. `git push origin main`.

### 6. Clean up (lead)

1. **Shut down the workers.** Send `shutdown_request` to W1 and W2 and confirm with `ListAgents`.
2. **Re-check before removing anything.** For every worktree, confirm again: merged into `origin/main`, no process has its cwd there,
   and `git status` is empty or holds only an untracked `agent-orchestration/node_modules` symlink or a `graft/` cache.
   Remove a symlink with `rm` and no trailing slash, so its target is untouched. Then `git worktree remove --force`.
   Expect 39 worktrees, including the 4 this plan created.
3. **Remove the 3 superseded worktrees** and force-delete their branches:
   `feature/agent-orchestration-observer`, `tm/TM-134-role-cli`, `tm/TM-138-producer`.
4. **Delete merged branches** with `git branch -d`, which refuses anything unmerged: the branches of removed worktrees, the 12
   merged branches with no worktree, and this plan's 4 branches. Then run `git worktree prune`.
5. **Keep** `codex/teamcity-shipped-bundle`, `feat/evidence-provenance` and `fix/orchestration-metadata`, which are not merged.
   Keep the scratchpad WIP backup.

## Verification after push

- `git rev-list --left-right --count main...origin/main` prints `0 0`.
- **Fresh clone of `origin/main` into the scratchpad.** A directory marketplace hides delivery bugs, so the clone is the real check.
  - Run `node --test --test-concurrency=1 tests/unit/topology-observer.test.mjs tests/unit/topology-mailbox.test.mjs tests/unit/topology-supervision.test.mjs`
    and `claude plugin validate ./agent-orchestration`.
  - `doctor.mjs` still contains `git-common-dir`.
  - `.cursor`, `.gemini`, `.windsurf` and `GEMINI.md` are absent; the graft wiring files are present.
- `tm board` shows TM-162, TM-163 and TM-164 done, and TM-167 and TM-168 ready.
- `git worktree list` shows main plus the 3 kept worktrees.

## Out of scope

- TM-167 and TM-168, the next feature. TM-167 criterion 6 already covers "ordinary commands must not start supervision or list unscoped tmux servers".
- `fix/orchestration-metadata`, which you asked to leave for its owner.
- Upgrading graft from 0.16.0 to 0.18.0.
