# EP-019 / TM-164 criterion 4: real-tmux observer acceptance (W2)

**Result:** the new test proves on a real, isolated tmux server that `observer start` commits a
version-2 attachment only after the observer's own pane acknowledges the prompt composed now. It
passed 5 of 5 runs on a clean tree. Two deliberately broken versions each failed where they should.

- Commit `6f63b53` on `tm/EP019-observer-tmux`, merged into `tm/EP-019-integration` at `cecb22e`.
- File: `agent-orchestration/tests/contract/topology-tmux.test.mjs` (161 insertions, 5 deletions).
- Test name: "observer start commits a v2 attachment only after its own pane acknowledges the current prompt".

## What the test asserts

1. **No attachment before the acknowledgement.**
   - During a 2-second hold that starts after `openRoleSession` finished, no attachment file exists.
   - Prompt state is `awaiting-ack`, and `observer start` is still running.
   - An acknowledgement sent from the test process with `TMUX_PANE=""` is refused with
     `details.reason: incarnation-mismatch`, and no attachment appears.
2. **A valid attachment after the pane's own acknowledgement.**
   - The file on disk equals the attachment `observer start` reported.
   - It has `version: 2`, `observation_allowed: true` and `prompt_acknowledged_at`.
   - `observer_binding` matches exactly one live pane in the observer session, on a socket under the test's `TMUX_TMPDIR`.
   - `activation_delivery.delivered` is `true`, and `observer status` reports attached, observation allowed and prompt current.
3. **No stale prompt source.** `prompt_revision` equals:
   - the revision `prompt preview` composes now;
   - the sha256 prefix of `prompt.md`;
   - prompt-state's `desired_revision` and `applied_revision`.

   `applied_binding` is the bound pane.
4. **The supervisor is isolated.** The supervisor that `launch` starts has `TMUX=` and `TMUX_TMPDIR=<consumer>` in `/proc/<pid>/environ`.

## Changes to the existing tests in the same file

Teardown now stops the supervisor that `launch` starts. It kills the tmux server by socket (`-S`)
only after asserting `TMUX === ''` and that the socket is under `TMUX_TMPDIR`. This replaces two
bare `kill-session -t` teardowns that broke the tmux isolation rule 3.

## Runs

All runs used `npm run test:topology:tmux -- --test-concurrency=1` at `6f63b53`, on a clean tree.

| Run | Tests | Pass | Fail | Exit | Load |
|---|---|---|---|---|---|
| 1 | 5 | 5 | 0 | 0 | 10.25 |
| 2 | 5 | 5 | 0 | 0 | 10.38 |
| 3 | 5 | 5 | 0 | 0 | 8.68 |
| 4 | 5 | 5 | 0 | 0 | 9.38 |
| 5 | 5 | 5 | 0 | 0 | 18.71 |

The baseline at `119006c` was 4 tests, 4 pass, exit 0.

## Proof the test can fail

- **Red A (acknowledgement withheld).** 1 failure, exit 1:
  `observer start failed after the pane was released` with `TOPOLOGY_PROMPT_ACK_TIMEOUT`, and `ack.json` absent.
- **Red B (`waitForObserverPrompt` made to return `current` at once).** 1 failure, exit 1:
  `an attachment was committed before the observer acknowledged its prompt` (`true !== false`, in the hold loop).

## Leak check

- **Before and after the five runs:** no process carried a test `TMUX_TMPDIR`, and no
  `supervise --consumer` process for this file's consumers remained.
- **Why a wider scan was needed:** the pattern `ao-topology supervise` cannot see test supervisors,
  which run as `node …/topology/cli.mjs supervise`. The `/proc/*/environ` scan used instead was
  shown able to match.

## Defect found outside scope (filed as a follow-up task)

An acknowledgement can be forged with `TMUX_PANE`. In Run C, a process outside the pane set
`TMUX_PANE=%2` with the correct nonce and revision, and was accepted as `current`. The binding is
built from a variable the caller controls, so it guards against a stale or replaced process
acknowledging by mistake. It does not guard against a hostile process of the same user.

## Verified versus only read

**Only read, not run:**
- That `openRoleSession`'s startup journal line is its last step. Red B supports this indirectly.
- That the reattach and controlled-restart paths behave the same as a new session. The test covers
  only a newly created observer session.
