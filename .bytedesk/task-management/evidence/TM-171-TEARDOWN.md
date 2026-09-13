# TM-171: stop every writer before removing the directory it writes into

**Commit:** `0b63a79` on `tm/TM-171-teardown`, cut from `1668292`.
**Tree:** measured in a clean worktree (`dirty=0`). The main checkout held another session's
in-flight TM-187 work (`delivery.mjs`, `lead.mjs`, `reviewer.mjs`, `topology-probe-wakeup.test.mjs`),
so nothing here was measured there — rule 8.

## AC1 — every topology test stops its writers before removing their directory: PASS

Found with a detector (`scratchpad/teardown-order.py`) that flags an `rm`-only `t.after` whose
registration line precedes a stop hook in the same test, and counts hooks registered in a **helper**
separately, because those run before every hook a test adds later.

| tree | violations |
|---|---|
| pristine `HEAD` (`git archive`) | **7**, across 5 files |
| `0b63a79` | **0** |

Same 46 files, same detector, same run. The first version of the detector had no helper pass and
reported 4 — it missed `topology-management` and `topology-presence`, whose `rm` lives in a fixture.
That blind spot is why the ticket's own list was short by one file.

Sites and fixes:

| file | was | now |
|---|---|---|
| `topology-lead.test.mjs:32` | `rm(root)` then `-L kill-server` | one hook, server then root |
| `topology-supervision.test.mjs:31` | `rm(root)` then `-L kill-server` | one hook, server then root |
| `topology-supervision-consistency.test.mjs:43` | `rm(root)` then `controller.abort()` | one hook, abort then root |
| `topology-supervision-consistency.test.mjs:115` | `rm(root)` then kill-server, then acker abort | one hook: acker, server, root |
| `topology-management.test.mjs:10` (fixture) | fixture `rm` runs before each test's `child.kill` / kill-server | tests pass a stop to `onStop`; the fixture's one hook drains them, then removes |
| `topology-presence.test.mjs:19` (fixture) | fixture `rm` runs before the test's kill-server, whose socket is inside root | same `onStop` shape |
| `topology-repo-enrollment.test.mjs:44` | already reaped before `rm`, and still failed | see below |

`repo-enrollment` is the one the ordering rule does not explain, and it is the instance that was
actually measured failing (1 in 5 runs, `hookFailed ENOTEMPTY rmdir .../home`). Its hook reaped
first. What it got wrong:

1. it scanned `pgrep -f "supervise --consumer <canonical repo>"` — one path, a single snapshot;
2. it never stopped a tmux server under the fixture's own `TMUX_TMPDIR`, whose socket is inside the
   root being removed.

`tests/helpers/teardown.mjs` (which also replaces the fourth copy-paste of `reap`) scans by the
shared temp **root** so one pattern covers the canonical repository and every linked worktree,
rescans after reaping so a process that was mid-spawn during the first scan is still caught, waits
for the pid to actually leave after `SIGKILL`, and kills each tmux server by explicit `-S` socket.

## AC2 — no tmux server or supervise process left alive after a full run: PASS

`node --test --test-concurrency=1 tests/unit/topology-*.test.mjs` → **446 tests, 446 pass, exit 0**
(67.7 s, 1-minute load 13.5).

| | before | after | leaked |
|---|---|---|---|
| live tmux servers + `supervise --consumer` processes | 8 | 8 | **0** |

Control: a planted `LIVE-SERVER` line must appear in the same comparison, and did (`1`). Without it
the empty result would prove nothing.

**The first instrument was wrong and is worth recording.** It counted socket *files* under
`/tmp/tmux-*` and reported 2 leaks. Both were dead — `tmux -S <sock> list-sessions` answered
`no server running` for each. tmux leaves the socket file behind after `kill-server`, so a file
count cannot answer "is a server still alive"; the second census probes liveness instead. Rule 9.

Those two dead sockets did surface something real, logged on **TM-184** rather than fixed here:
`topology-supervision` and `topology-lead` call `run('tmux', …)` with no env at all — the former
even builds an isolated env and never passes it — so their servers land in the operator's default
`/tmp/tmux-1000` with `$TMUX` inherited. Guards 1 and 2 of `.claude/rules/tmux-test-isolation.md`
are absent; only the unique `-L <name>` on every call is holding.

## AC3 — `tests/stability.mjs --runs 10`: PASS, and the verdict alone did not earn it

```
commit=0b63a79 dirty=0   tree clean at 0b63a79
10 runs · fail counts 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
stable: every run agreed, and every run passed.        exit=0
```

**That output is not by itself evidence, and TM-181 is exactly why.** Control: the same harness run
against `tests/unit/zzz-no-such-file-*.test.mjs` prints

```
1 runs · fail counts 0
stable: every run agreed, and every run passed.        exit=0
```

— byte-identical in form, exit 0, having executed nothing. A pass/fail bit cannot separate "ten
clean runs" from "ten empty runs", so the bit was replaced with a value (rule 7): elapsed time.

| run | wall time | per run |
|---|---|---|
| empty pattern, 1 run | **0 s** | 0 s |
| one real file, 1 run | **3 s** | 3 s |
| the AC3 run, 10 runs | **652 s** (16:26:35 → 16:37:27) | **65.2 s** |
| a directly measured full topology suite | 67.7 s | — |

65.2 s per run against 67.7 s measured independently, versus 0 s for an empty pattern. The ten runs
executed the suite.

Logged on TM-181 as a second, exactly reproduced instance.
