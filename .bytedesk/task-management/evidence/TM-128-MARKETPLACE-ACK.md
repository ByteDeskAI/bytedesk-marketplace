# MARKETPLACE-ACK — bytedesk-marketplace side of the lead/template/presence rollout

Acknowledged by: Marketplace Claude, pane %3.
Date: 2026-09-09.
Scope source: PLAN.md + MANAGEMENT-ADDENDUM.md + PRESENCE-CONTRACT-DRAFT.md in this directory.
Status: **ready for the Store coordinator to launch ONE new Kimi worker.**

---

## 1. Launch this

```
WORKTREE   /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-127-agent-orchestration-persistent-repository-leads-
BRANCH     tm/TM-127-agent-orchestration-persistent-repository-leads-
BASE       82eaf62 (committed main; the worktree is clean)
TASK       TM-127
```

One Kimi worker, in that worktree, on that branch. No second worker for this task.

## 2. Board records (bytedesk-marketplace store, `.bytedesk/task-management/`)

| Id | Title | Owner | State |
|---|---|---|---|
| **EP-018** | Persistent repository leads, configurable agent templates, and the cross-repo presence contract | Marketplace Claude %3 | open |
| **TM-127** | agent-orchestration: persistent repository leads, configurable templates and prompts, durable mailbox | **the new Kimi worker** | open, worktree provisioned, 21 AC |
| **TM-128** | Agree the cross-repository presence contract with bytedesk-remote-gateway | Marketplace Claude %3 + Gateway Codex %35 | open, spike, 6 AC |
| **TM-129** | Review and integrate the lead/template/presence branch, then refresh the plugin cache | Marketplace Claude %3 | open, blocked-by TM-127 |

Marketplace **EP-018 is unrelated to Gateway EP-018** — same number, different repos, coincidence.
Please link the Gateway counterpart task id back here and I will `tm link` it onto TM-128.

`tm show TM-127` is the authoritative scope. Do not work from this file's summary.

## 3. Ownership boundary

- **Kimi worker** implements TM-127 only, inside its worktree. It runs **no git commands in the
  main checkout** and does not commit or merge to `main`.
- **Marketplace Claude %3** owns TM-128 (contract) and TM-129 (review, integration, cache refresh),
  reviews the worker's output, and is the only one who integrates.
- **Gateway Codex %35** owns the Gateway side and its own additional Kimi. Nothing in this repo's
  worktree touches the Gateway repo.
- I will shut down **only the worker I coordinate**, after collection. Persistent product leads and
  peer sessions (%37, %38, and any standing lead) are not mine and stay alive.

## 4. Overlap constraints — read before the first edit

1. **The main checkout has unrelated uncommitted work** in `task-management/` (`bin/tm`,
   `CHANGELOG.md`, `tests/test-hooks2.sh`) and in board files. It is NOT in the worktree, which is
   branched from committed HEAD. **The worker must not touch `task-management/`.**
2. **Owned paths: `agent-orchestration/` only.** Recorded as `tm touches TM-127 agent-orchestration/`.
3. **The `tm` binary is NOT reachable from inside the worktree.** The worktree's
   `.bytedesk/task-management/` is a git checkout at HEAD — it has no `bin/` and does not contain
   TM-127. The real shared store is the main checkout's. Drive it by absolute path, from anywhere:

   ```
   /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/bin/tm show TM-127
   ```

   That launcher resolves the store through the git common directory, so it reads and writes the one
   real board even with cwd inside the worktree. **Never** write into the worktree's own
   `.bytedesk/task-management/`, and never commit `.bytedesk/` from the worktree — either forks the board.
4. **Other live worktrees on this repo** (do not enter or clean them):
   `fix/orchestration-metadata`, `codex/teamcity-shipped-bundle`, `feat/evidence-provenance`,
   and a detached `legacy-9008-design-system`.
5. **Versionless manifests stay versionless.** `.claude/rules/version-enforcement.md` is
   load-bearing: adding a `version` to `agent-orchestration/.claude-plugin/plugin.json` or to its
   `marketplace.json` entry silently stops every consumer receiving commits. Only the plugin's own
   ecosystem semver markers and its CHANGELOG advance.

## 5. Grounding I verified in the source, so the worker does not rebuild it

The authoritative orchestration layer is `agent-orchestration/topology/`, per the knowledge-store
decision `topology-is-the-authoritative-orchestration-layer`. Not `src/` — there is no
`routeMessage` or lead concept in `src/` at all.

- `topology/lib/identity.mjs:30` already defines a `lead` role, titled "Engineering Lead".
- `topology/lib/mailbox.mjs:395-418` already resolves the lead from the agent **library** rather
  than the run record, and already documents that a repo's lead appears in its own run as
  `role: "orchestrator"`. Preserve that: a solo task's mechanical orchestrator role is **not**
  evidence of repository leadership.
- `topology/lib/routing.mjs` already implements redirect-to-lead and delegation checks. The defect
  named in the plan is narrow and real — at **`routing.mjs:246-249`** the `if (!lead)` branch sets
  `"no lead declared in this repo, so it was delivered as addressed"` and **fails open**. Fix that
  shared admission path, not only the optional CLI `--from-project` path at `topology/cli.mjs:580`.

## 6. Management addendum — folded into TM-127

MANAGEMENT-ADDENDUM.md is absorbed as nine additional acceptance criteria on TM-127 (AC 13-21),
kept in the same task and worktree rather than split to a second worker. They cover: tm-provisioned
isolated worktrees per task with safe migration for already-adopted workers; one dedicated
persistent code-reviewer session per repo, Claude or Codex chosen by global reviewer-template config
and never the author or the lead itself; reviewer-unavailable **fails closed**; the
start/during/finish communication protocol enforced mechanically rather than by prompt text; lead
status relay that never types into a nonempty composer; review queued per task with edits
invalidating the superseded revision; verified-merge-only cleanup in order (collect → close owned
worker → `tm` worktree removal → branch delete when safe) with a blocked-cleanup reason on any
failed gate; and crash recovery with no silent claim stealing.

**Merge authority is unchanged.** The operator's pending decision (approval-gated vs automatic)
sits in MANAGEMENT-ADDENDUM.md and is recorded as TM-127 AC 21. Existing repo rules stand until the
Store coordinator appends the answer. **Neither worker asks Ryan again.**

## 7. Presence contract — DELIVERED at revision 2

**Status: written, reviewed, revised, awaiting Gateway acknowledgment to freeze.**

- `PRESENCE-CONTRACT.md` — revision 2, supersedes the draft and revision 1.
- `fixtures/presence-v1/` — 7 fixtures + `validate_presence.py` (stdlib, negative-tested) + README.
- `CONTRACT-HASHES.txt` — the hashes Gateway records to freeze v1.
- `GATEWAY-NOTIFY-presence-v1-rev2.md` — the notification to %35 / TM-222.

Revision 1 applied three corrections against the producer's source (the draft's
`team-lead|coordinator|worker` roles do not exist; `rootRunId` is not always derivable; the stale
clock and revision ordering were unanchored). Revision 2 then applied all six findings from
CONTRACT-REVIEW.md — authoritative membership replacement, the six-tuple server/session incarnation
binding, grouping by run rather than `agentId`, `depth` uncapped beyond the `--max-depth` default,
clock-free `(generation, revision)` ordering with a bounded future skew, and unresolved roots that
are never grouped by resemblance. Details in the notify file.

Counterpart: **Gateway TM-222**, linked on TM-128.

## 8. Sequencing

TM-128 does **not** block TM-127 as a whole — the worker starts immediately on lead lifecycle,
configuration/templates and the mailbox. It gates only TM-127's presence-snapshot criterion (AC 12),
and it gates the Gateway side entirely. I expect to land the contract well before the worker reaches
the producer.

## 9. Next step

Store coordinator: launch the Kimi worker on the worktree and branch in §1, pointed at TM-127.
Have it write bounded STATUS and RESULT files into this directory.

**Claim handoff.** `tm worktree new` left a provisioning claim on TM-127 held by actor `main` — this
coordinator — which is why `tm doctor` currently reports `TM-127 claim-stale-status`. That is
expected and resolves the moment the worker takes the task. The worker should run, via the absolute
launcher path in §4.3:

```
tm start TM-127                 # normal path
tm claim TM-127 --steal         # only if start refuses on the provisioning claim
```

The `--steal` is from `main`, is the intended handoff, and prints what it stole — it is not silent
claim stealing, and it is the only claim the worker may take. It must never `--steal` any other
task.

I am proceeding on TM-128 now and will append PRESENCE-CONTRACT.md + fixture here.

— Marketplace Claude, pane %3

---

# COUNTERSIGNED — Presence v1 is FROZEN at contract revision 3

Marketplace Claude %3, TM-128. 2026-09-09.
Counterpart: Gateway Codex %35, TM-222, whose `## ACCEPTED` block in GATEWAY-ACK.md this
countersigns.

## Verification performed before signing

I did not take the acknowledged hashes on trust. Extracted Gateway's eleven from GATEWAY-ACK.md and:

1. `sha256sum -c` against the actual bytes on disk — **11 of 11 OK**.
2. Diffed their set against my own `CONTRACT-HASHES.txt` — **identical, no drift and no
   transcription error** in either direction.
3. Re-ran both gates at the signed revision:
   - `validate_presence.py` → `ok — 7 snapshot(s) conform to Presence v1 (contract revision 3)`
   - `test_validator.py` → `all negative tests pass`

## The frozen set

```text
3748e32d26f6f7b3764009a95a2227c44a1b7107504f1934bace1c4d7a6297f5  PRESENCE-CONTRACT.md
4fef13c80f8a9c4e27dcf9345d6edec0cf375a46ae44ba884f53aae93150baa7  fixtures/presence-v1/README.md
b6711de9321a23223a1eda82385c604e3e09c5d85972d4d5b4fd8c81ef01fd78  fixtures/presence-v1/validate_presence.py
b095ba737175ab080ae01381623ca2e9e9f1b2da2d0b885cbbf7f283d3bf6e79  fixtures/presence-v1/test_validator.py
253141cca84b699a59c29d127ecbd87c863217c195c422b6756a1748fbf6afaa  fixtures/presence-v1/01-exact-match.json
9b6ba0356e8c85039c32bd23c7ffbcaeee80b274896ef2ef0e275f54f2e51302  fixtures/presence-v1/02-stale.json
e8784ecfcf18cbc9c2111f7e353d8133401f3ca25f29393b72466c0ef1c7d9ea  fixtures/presence-v1/03-nested-runs.json
074d3e3b2be00f4503ba2d5f91639fa1c322665216658fdb343a71e31bdfff87  fixtures/presence-v1/04-standing-session.json
ddcda9b9578204196080c942096333df204ee28df0fab35a5b1b536bf2e52efb  fixtures/presence-v1/05-empty-clears.json
c3cb40a914fe7d661c485953b1146414dbb9cee562358edb559f836ed82b0e05  fixtures/presence-v1/06-membership-removal.json
60d27bfa2e66317a0af12d89b3f4e2ef939712be0930c419046173f75b7322f5  fixtures/presence-v1/07-server-restart.json
```

**Presence v1 is frozen at this set.** Any change to the wire format from here is
`schemaVersion: 2`, not an edit to these files. If either side needs a correction, raise it rather
than editing — a silent edit invalidates every hash above and both implementations built on them.

## Agreed without reservation

Gateway's closing conditions are correct and I record them as jointly held, not merely received:

- Fixture validation is **contract evidence, not a substitute** for parser, state-machine or browser
  tests on either side. A conforming snapshot says nothing about a consumer that mishandles it.
- The consumer validates untrusted wire shapes and dates defensively; a producer's good intentions
  are not an input guarantee.
- Last-known metadata is retained **only against matching authorized live six-tuples** — the
  incarnation rule in §4.1 is what makes retention safe.
- Cold-start `unknown`, then stale and replacement semantics, per §6 and §6.1.
- Terminal-captured reviewer readiness is **readiness only** and carries no authenticated-mailbox
  claim and no code approval.
- No additional worker on either side. %113 (marketplace) and %116 (Gateway) remain the sole
  implementers, each with its own coordinator.

## Producer status

The producer is TM-127 AC 12, implemented by Kimi %113 in the marketplace worktree. It has not
started — the worker is on lead lifecycle and configuration, and is currently iterating on
`topology/lib/lockfile.mjs` under coordinator review 01. AC 12 is unblocked as of this
countersignature and will be built against revision 3.

Fixtures land in-repo at `agent-orchestration/topology/fixtures/presence-v1/` under AC 12. This
coordinator does not write into `agent-orchestration/`.

**Gateway %116 is unblocked to begin.**

— Marketplace Claude, pane %3
