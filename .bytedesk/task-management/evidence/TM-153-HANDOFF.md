# TM-153 — two defects, and the second is why nobody could see the first

**Merge:** head of `tm/TM-153-pool-launch`, off `main@e38a2ba`.

## Defect 1 — the reason was thrown away

`ao-topology --json` reports a refusal as `{ ok: false, code, message }` on **STDOUT**, exits 1, and
writes **nothing to stderr**. All three dispatch backends built their failure reason from stderr
alone, so the board recorded, verbatim:

```
ao-topology launch exited 1:
```

An exit code, a colon, and nothing. Measured directly:

```
$ node bin/ao-topology launch --workflow does-not-exist --json ; echo $?
1
STDOUT: {"ok": false, "code": "TOPOLOGY_TEMPLATE_NOT_FOUND", …}
stderr bytes: 0
```

`toolFailureReason` now reads the structured answer first, falls back to stderr, then to raw stdout,
and never returns an empty tail. The same failing run now says what it always knew:

```
ao-topology launch exited 1: TOPOLOGY_STARTUP_NOT_READY: Governed workflow launch requires a
responsive repository lead and independent reviewer.
```

Applied to all three call sites — `topology.mjs`, `idle.mjs`, `collect.mjs` — because all three had
the same line.

## Defect 2 — `TM_DISPATCH_REGISTRY` never participated in selection

This is the location dependence, and it is worse than "a test that reports the host".

`resolveBackend` walked `backendOrder(p)` — `["topology","tmux","orchestration","manual"]` — and a
supplied registry could only **substitute a module for a name already in that list**. The pool
test's registry names one backend, `fake`. It was therefore never consulted. Its own doc comment
says it exists "so dispatch can be exercised end to end … without spawning a worker", and it could
not do that.

So the outcome depended entirely on the host: with a real `ao-topology` present, `topology` won and
refused (no repository lead in a temp fixture); in an archive extract it was unavailable, the walk
fell through, and the suite passed.

Registry names absent from the configured order now go **first**; a registry that overrides a
configured name keeps that name's **place**, so overriding `topology` does not promote it.

## VERIFIED — the three locations the AC asks for

| where | before | after |
|---|---|---|
| linked worktree | 17 pass, **2 fail** | **19 pass, 0 fail** |
| detached copy (`tar` extract) | 19 pass, 0 fail | **19 pass, 0 fail** |
| canonical checkout | 17 pass, **2 fail** | (unpatched control, still 17/2) |

Same suite, same code, the fix as the only variable. The canonical row is deliberately the
**unpatched** control: it is what proves the other two are not measuring the location.

Four new assertions in `tests/unit/dispatch-surfaces.test.mjs` — that a registry backend outside the
order is reachable, that an overridden name keeps its place, that the structured stdout refusal is
read, and that the reason is never an empty tail. 15/15 in that file.

## READ ONLY, not executed

- Production dispatch with `TM_DISPATCH_REGISTRY` unset. The selection change is inert without it
  except for the ordering rule itself, which is exercised by the two new assertions but not by a
  real dispatch on this host.
- Whether `test-pool.sh`'s two failures were the ONLY consequence of defect 2. Any other suite
  relying on that registry would have had the same blind spot; I did not audit for others.
