# TM-174 verification — `tm config` read and dotted keys

**Result:** both defects are fixed.
- `tm config <key>` with no value prints the key and writes nothing.
- `tm config dispatch.enabled true` sets `config.dispatch.enabled` and keeps the other `dispatch` keys.

## What was measured

- **Commit:** `d7e1019` on branch `worktree-agent-ae4cd2e0a9e505712`, based on `cd1b1ac`.
- **Tree:** the worker's worktree, clean (`git status --short` printed nothing), not the shared main checkout.

| Command | Exit | Result |
|---|---|---|
| `node --test --test-concurrency=1 task-management/tests/unit/config-cli.test.mjs` | 0 | 6 pass, 0 fail |
| `node --test --test-concurrency=1 task-management/tests/unit/*.test.mjs` | 0 | 1380 tests, 1380 pass, 0 fail |

The lead ran both commands again independently after the worker's report.

## Red before green (worker's run)

- **On the unmodified `cd1b1ac`:** `config-cli.test.mjs` exited 1, with 3 fail and 3 pass.
  - **B1:** both read tests failed, because the whole config was printed instead of the value.
  - **B2:** the dotted write test failed, because `dispatch.enabled` stayed `false`.
- **By hand on the same commit:**
  - after `tm config wipLimit`, `wipLimit` was missing from `config.json`;
  - after `tm config dispatch.enabled true`, the file had a literal top-level `"dispatch.enabled": true`.

## Acceptance criteria

1. **The read is non-destructive.** A read of a plain key and a dotted key leaves `config.json` byte-identical (test asserts equality of file contents).
2. **The dotted write lands in the right place.** A dotted write sets the nested value, keeps `dispatch.poolWip`, and writes no top-level `"dispatch.enabled"`.
3. **The helpers are reused, not copied.** `getPath` and `setPath` are exported from `lib/settings.mjs`, and `bin/tm` imports them.
4. **Regression tests exist.** They are in `tests/unit/config-cli.test.mjs`, and were shown red on `cd1b1ac` and green on `d7e1019`.

## Notes

- **Suite command:** `node --test <directory>` does not run the suite. Node treats the directory as one missing module. Use the `*.test.mjs` glob.
- **Unset keys:** reading a key that is not set prints `null`.
