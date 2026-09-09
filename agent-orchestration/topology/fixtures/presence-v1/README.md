# Presence v1 fixtures — contract revision 3

Acceptance artifact for `../../PRESENCE-CONTRACT.md`. Marketplace TM-128 / Gateway TM-222.
Producer and consumer test against these exact files.

```
python3 validate_presence.py          # all fixtures, per-snapshot AND cross-snapshot rules
python3 test_validator.py             # the validator rejects what it must
```

Both must pass. The positive fixtures alone cannot catch a validator that accepts a JSON-number
counter, orders `"10"` before `"9"`, or lets an unbounded skew through — Gateway TM-222 found all
three by inspection, and `test_validator.py` is what stops them coming back.

Agreed bounds, enforced by producer, consumer and validator alike:

| Field | Range (inclusive) | Default |
|---|---|---|
| `staleAfterMs` | `1000` .. `300000` | `30000` |
| `clockSkewToleranceMs` | `0` .. `30000` | `5000` |
| `depth` | `0` .. `64` | — (`--max-depth` default is 3) |

`generation` and `revision` are JSON **strings** of ASCII decimal digits and are compared as
integers. A value outside a bound, or of the wrong type, makes the snapshot **invalid** — the
`unknown` path, not a clamp.

| File | Case | What it must prove |
|---|---|---|
| `01-exact-match.json` | Happy path | Lead (`repoRole: lead`, `runRole: orchestrator` — the Team lead label comes from `repoRole`), a standing reviewer, two run agents, one `pending` external terminal. Full six-tuple bindings. |
| `02-stale.json` | Stale | Well-formed, `generatedAt` far beyond `staleAfterMs`. Retain the last known grouping **labelled stale**; do not drop to standalone, do not reassert as fresh. |
| `03-nested-runs.json` | Nesting, deep runs, unresolved roots | `depth` 0/1/2 with verified ancestry; a `depth: 5` entry from a raised `--max-depth` that must **not** be rejected; and **two** orphans with `rootRunId: null` sharing runName/depth/chain but with different `runId`s — they must render unresolved and must **not** be grouped together. |
| `04-standing-session.json` | Standing team group | A second repository, lead + dedicated reviewer only, `primaryRunId: null`, `memberships: []`. Standing sessions need not appear in any run's `run.agents`. |
| `05-empty-clears.json` | Empty clears | Valid, fresh, `agents: []`. Everything becomes standalone. The degenerate case of §6, not a special case. |
| `06-membership-removal.json` | **Individual removal** | Successor to `01` (same generation, higher revision). One run agent is gone entirely, the reviewer is `detached`, and the list is still non-empty. A consumer that only clears on an empty list keeps a departed worker in its group forever — this is the fixture that catches it. |
| `07-server-restart.json` | **Incarnation invalidation** | Same socket path, **new `serverPid`**, deliberately reusing `01`'s `$` session ids and `%` pane ids. Every prior binding must be dropped. Keying on `(serverKey, paneId)` alone silently labels new processes with old metadata. |

## The eighth case has no file, by definition

**Missing snapshot.** Delete the file, or point the consumer at a `repositoryKey` with none. The
result is **`unknown`**: retain the last known grouping, labelled unknown. It is **not** a
successful zero-member result and **not** standalone. Contrast `05`, which *is* the successful
zero-member result. A consumer that treats those two alike has the bug this set exists to catch.

Malformed JSON, an unrecognised `schemaVersion`, and a `generatedAt` beyond the future bound take
the same `unknown` path. Truncate `01` mid-file to exercise the malformed case.

## What the validator enforces

Per snapshot: envelope shape, `generation`/`revision` as decimal strings (and that the old `epoch`
field is gone), the role vocabularies, the six-tuple binding with its incarnation fields, spawn
naming (`<agentId>-<7hex>`), ancestry consistency at depth 0 and beyond, `primaryRunId` membership,
and the §5 exclusion list.

Across snapshots: that `06` really supersedes and really removes; that `07` reuses `01`'s ids under
a new incarnation and shares no binding with it; that `03` carries look-alike-but-unrelated
unresolved roots and a `depth > 3`; and that `05` is empty.

The validator has been negative-tested twice over: six injected fixture defects, one per Store
review finding; and `test_validator.py`'s 28 assertions covering counter typing (JSON numbers,
floats, `\u00b2`, `\u0667`, signed, empty, null), the TTL and skew bounds including the boolean leak
that `isinstance(True, int)` opens in Python, the `0..64` depth bound, the incarnation fields, and
both directions of cross-generation ordering.

## Notes

- Names and ids are synthetic. tmux values are realistic (`#{socket_path}`, `#{pid}`,
  `#{session_id}`, `#{session_created}`, `#{pane_id}`, `#{pane_pid}` — all verified on tmux 3.4)
  but bind to nothing.
- Ordering is `(generation, revision)` as integers. Never `generatedAt`.
- Canonical in-repo destination once TM-127 lands:
  `agent-orchestration/topology/fixtures/presence-v1/`.
