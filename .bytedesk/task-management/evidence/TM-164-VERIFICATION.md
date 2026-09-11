# EP-019 / TM-164: final verification before push

**Result:** every check passed on the merged code. `main` at `450a259` merges
`tm/EP-019-integration` (`db010ef`, which includes the v0.8.0 release commit) into `3a0e038`.

## Checks on the integration branch

At `cecb22e`, a clean tree in `.bytedesk/worktrees/EP019-integration`.

| Check | Result |
|---|---|
| `node tests/stability.mjs --runs 5 --pattern 'tests/unit/topology-*.test.mjs'` | "tree clean at cecb22e"; fail counts 0, 0, 0, 0, 0; stable; exit 0 (load 14–21) |
| `npm run test:topology:tmux -- --test-concurrency=1` | 5 tests, 5 pass, 0 fail, exit 0 |
| `claude plugin validate ./agent-orchestration` | passed, with the one expected "No version specified" warning; exit 0 |
| `node --test --test-concurrency=1 tests/unit/*.test.mjs` | 529 pass, 5 fail, 4 skipped |

**The five unit failures were caused by the worktree, not the code.** All five were
`ERR_MODULE_NOT_FOUND`: `zod` in four files and `@modelcontextprotocol/sdk` in one. The worktree
has no `node_modules`, and symlinking it is ruled out because esbuild bakes in resolved paths. That
is why the full suite was run again in the main checkout below.

**The baseline before any fixes** was `119006c`: 396 of 397 topology tests passed. The one failure
was the `send` guard that W1 fixed.

## Checks on merged `main`

At `450a259`, in the main checkout, which has `node_modules` including `zod` and
`@modelcontextprotocol/sdk`. Nothing under `agent-orchestration/` was uncommitted before or after
the run; only board files were uncommitted elsewhere.

| Check | Result |
|---|---|
| `node --test --test-concurrency=1 tests/unit/*.test.mjs` | 574 tests, 570 pass, 0 fail, 4 skipped; no missing modules; exit 0 |
| `npm run build:check` | exit 0 |

## Direction checks at `450a259`

Each count below was read from the file itself, not inferred from a diff size.

| Marker | Value | Meaning |
|---|---|---|
| `git-common-dir` in `topology/lib/doctor.mjs` | 1 | TM-169's trust fix is kept |
| `isolatedEnv` in `tests/unit/topology-supervision.test.mjs` | 6 | the tmux isolation fix is kept |
| `topology/lib/incarnation.mjs` | present | TM-163 is included |
| `agent-orchestration/package.json` version | 0.8.0 | the release is included |
| Claude-side `version` in `plugin.json` and `marketplace.json` | absent | the plugin stays versionless |
| `agent-orchestration/` compared with `tm/EP-019-integration` | identical | the merge added nothing unexpected |
| Paths changed against `origin/main` (`1ccbc88`) | 34 | 23 under `agent-orchestration/`, plus the 11 graft wiring files from `3a0e038` |

## Related evidence

- W1's evidence (`TM-164-W1-SUPERVISION-GUARD.md`) covers the `send` guard and the supervision test.
- W2's evidence (`TM-164-W2-OBSERVER-TMUX.md`) covers the real-tmux acceptance test.
- Two follow-up tasks were filed from this work: TM-171 (teardown order) and TM-172 (a `TMUX_PANE` acknowledgement can be forged).
