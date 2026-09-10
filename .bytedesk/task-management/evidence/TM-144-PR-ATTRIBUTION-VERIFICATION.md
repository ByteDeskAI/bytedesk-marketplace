# TM-144 verification — PR attributed by repo, not cwd — lead session, 2026-09-09

Merged to `main` at `472a28b` (fix commit `8ddea85`).

## Gates, re-run against merged `main`

| Gate | Result |
|---|---|
| `tests/test-hooks2.sh` | **29 pass, 0 fail** |
| `tests/test-hooks.sh` | **65 pass, 0 fail** |
| `tests/test-link.sh` | **13 pass, 0 fail** |
| `tests/test-store.sh` | **134 pass, 0 fail** |
| `node --test tests/unit/*.test.mjs` | **1350 pass, 0 fail** |

## The four cases that carry the acceptance criteria

All in `task-management/tests/test-hooks2.sh`:

- `a PR opened in another repo is not attached to this board's task`
- `and the refusal is on the record, not silent` — asserts `git_link_skipped` carries the `ref`
- `a PR in another repo is refused even when the cwd says this board` — the regression that
  TM-036's cwd-based scope check could not catch
- `a PR that printed no URL attaches nothing, not the literal "pr"`
- `a PR in this board's own repo still links` — the guard is not over-tight

## What changed

`linkGit` asks the ref, not the cwd. `prBoard(url)` reads `owner/name` out of the pull-request
URL, which is the one part of a `gh pr create` that cannot lie about where the PR landed.
`commandCheckout(cmd)` covers commits by reading the command's own `git -C <dir>` or leading
`cd <dir> &&`, falling back to `CHECKOUT` when the command is silent.

## Known residue, not fixed here

Stores that ran the old hook still hold `"pr"` literal refs and cross-repo URLs — notably
bytedesk-persona's TM-001 (25 marketplace PR urls) and bytedesk-remote-gateway's TM-063
(bytedesk-passport's PR #17). This change stops new ones; it does not retro-clean existing
task files. They are safe to delete by hand.

## Versioning

No bump. `task-management` carries no ecosystem semver — CHANGELOG entry only, per
`.claude/rules/version-enforcement.md`.
