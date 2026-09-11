# EP-019 / TM-164: supervisor guard and intermittent supervision test (W1)

**Result:** both failures are fixed in test code only. `topology/lib/supervision.mjs` is unchanged.
The topology unit suite passes 397 of 397 at `2f4f163`, against 396 of 397 at `119006c`.

Commits: `9706a45` and `2f4f163` on `tm/EP019-supervision-start`, merged into
`tm/EP-019-integration` at `cecb22e`.

## 1. Mailbox guard: which process ran tmux

**The measurement.** A fake `tmux` shim on `PATH` logged each call's arguments and the caller's
command line. The run was at `119006c`, with `TMUX=''` and a per-test `TMUX_TMPDIR`.

**What it showed.**
- All five calls were `list-panes -a`, made by `topology/cli.mjs supervise --consumer <run dir>`.
  Their parent pid was the supervision pid that `send` returned.
- None came from `send`, and none wrote to a pane.

**Cause.** TM-162 makes `send` wait for its child supervisor to take the lock. The child lists
panes immediately, so the old "tmux never ran" check lost a race it had previously won.

**The test now:**
- isolates the child (`TMUX=''` and a per-test `TMUX_TMPDIR`);
- stops the child before removing the run directory;
- proves the shim is reachable with a `tmux -V` call before trusting an empty log;
- allowlists callers matching `/cli\.mjs supervise\b/`;
- rejects `send-keys`, `send`, `send-prefix`, `paste-buffer`, `pasteb`, `load-buffer`, `loadb`,
  `set-buffer` and `setb`.

**Shown able to fail.** With the allowlist pattern set to `/cli\.mjs NOT-A-MATCH\b/`, the test
failed and printed six recorded supervisor calls (exit 1). With the real pattern restored, both
files passed 20 of 20 (exit 0). A negative-control `send` that ran `tmux send-keys` was caught by
both assertions.

## 2. Intermittent supervision test: why it failed

**Failure text** (captured twice in 22 runs at `119006c`, load about 8.5):
`hookFailed: ENOTEMPTY: directory not empty, rmdir '/tmp/ao-supervise-restart-*/state/presence'`.
Every assertion had passed, in about 130 ms.

**Cause.** `t.after` hooks run in registration order (verified with a scratch test). `quietRepo`
registered `rm(root)` before the test's kill hook, so the state directory was removed while the
daemon was still writing presence.

**Fix.**
- "the supervisor records where it went…" now reaps its daemon in `finally`.
- "…survives losing its working directory" now uses a single hook that reaps, then removes.

**Still open.** The same order remains in `topology-supervision-consistency.test.mjs` and
`topology-management.test.mjs`. TM-171 tracks it.

## 3. Measurements

All at `2f4f163`, clean tree, load about 9 to 10.

| Check | Result |
|---|---|
| `node tests/stability.mjs --runs 10 --pattern tests/unit/topology-mailbox.test.mjs` | stable, 10 of 10, exit 0 |
| `node tests/stability.mjs --runs 10 --pattern tests/unit/topology-supervision.test.mjs` | stable, 10 of 10, exit 0 |
| Extra supervision-file loop | 0 failures in 30 runs (3 in 32 before the fix) |
| `node --test --test-concurrency=1 tests/unit/topology-*.test.mjs` | 397 pass, 0 fail, exit 0 |
| The same suite at `119006c` | 396 pass, 1 fail (the mailbox guard), exit 1 |
| Stability baseline at `119006c`, 10 runs | UNSTABLE: the supervision restart test failed 1 of 10, exit 2 |

No leaked `cli.mjs supervise` processes were found afterwards.

**Read, not run:**
- That the live writer in `state/presence` is the daemon's presence producer.
- That the old test could reach the operator's tmux server.
