# EP-020: EP-019 landed on main, graft tidied, old worktrees removed

**Result:** `origin/main` moved from `1ccbc88` to `e7c123f` in one push (10 commits). A fresh clone
of that tip passes the key checks. Local `main` matches `origin/main` exactly (0 ahead, 0 behind).

## What was pushed

| Commit | Content |
|---|---|
| `3a0e038` | Graft wiring for Claude, Codex, Copilot and Grok. Cursor, Gemini and Windsurf configs removed, plus the empty `=` file. The status line moved to the gitignored `settings.local.json`. Only the graft permissions kept. |
| `119006c` | EP-019 WIP snapshot (TM-162, TM-163, TM-164), replayed from its base `1de163b` onto `1ccbc88`. The TM-169 trust key and the tmux isolation fix were kept. |
| `9706a45`, `2f4f163` | W1: the `send` guard and supervision-test races fixed |
| `6f63b53` | W2: real-tmux acceptance test for TM-164 criterion 4 |
| `db010ef` | agent-orchestration v0.8.0: `package.json` and `CHANGELOG.md` only; Claude-side manifests versionless |
| `450a259` | Merge of `tm/EP-019-integration` into `main` |
| `e7c123f` | Board: TM-164 closed with evidence; TM-162…TM-172 records |

## Verification

**Before the push** (details in TM-164 evidence):
- Topology suite stable over 5 runs at `cecb22e`.
- Real-tmux contract tests: 5 of 5 pass.
- Full unit suite on merged `main` (`450a259`, main checkout): 570 pass, 0 fail, 4 skipped.
- `build:check` passed.

**Fresh clone** of `origin/main` at `e7c123f`, in the scratchpad:

| Check | Result |
|---|---|
| `git-common-dir` in `doctor.mjs` | 1 (TM-169 kept) |
| `isolatedEnv` in the supervision test | 6 (isolation kept) |
| `incarnation.mjs` and `observer-session.mjs` | present |
| `package.json` version | 0.8.0 |
| `version` key in `plugin.json` | absent |
| `.cursor`, `.gemini`, `.windsurf`, `GEMINI.md`, `=` | all absent |
| Graft wiring files | all present |
| `statusLine` in `settings.json` | absent |
| `settings.json` permissions | `Bash(graft:*)`, `Bash(npx graft:*)` |
| TM-164 | `status: done` |
| `topology-observer`, `topology-mailbox` and `topology-supervision` tests | 35 of 35 pass, exit 0 |
| `claude plugin validate ./agent-orchestration` | passed, with the expected version warning; exit 0 |

## Cleanup

Each removal was checked first: tip on `origin/main` (or, for superseded branches, still the
reviewed tip); no process working in the directory; nothing uncommitted except an untracked
`node_modules` symlink or `graft/` cache.

**Worktrees removed: 46.**
- 35 merged and clean.
- 4 merged whose only uncommitted item was a `node_modules` symlink (removed as a link, target untouched) or a `graft/` cache.
- 3 superseded: `feature/agent-orchestration-observer`, `tm/TM-134-role-cli`, `tm/TM-138-producer`.
- The 4 EP-019 worktrees created for this landing. The snapshot branch was force-deleted after confirming 17 of its 19 files are identical on `origin/main`. The other 2 differ only because of the fixes that landed after the snapshot was taken.

**Branches deleted: 55.**
- 51 with `git branch -d`, which refuses anything not merged.
- 4 with `-D`: the 3 superseded branches and the snapshot branch.

This includes 12 merged branches that had no worktree.

**Worktrees kept:**
- `fix/orchestration-metadata`, left for its owner.
- `codex/teamcity-shipped-bundle` and `feat/evidence-provenance`, which are not merged.

## Follow-ups filed

- **TM-171:** other topology tests still remove state directories before stopping the processes that write to them.
- **TM-172:** a prompt acknowledgement trusts the caller's `TMUX_PANE`, so any process of the same user can acknowledge on a pane's behalf.

**Not addressed:** five stale test supervisors from earlier runs in other worktrees are still
running, each with a `/tmp/ao-topology-run-*` consumer. They belong to other sessions, so they were
not stopped. TM-171 covers why test supervisors leak.
