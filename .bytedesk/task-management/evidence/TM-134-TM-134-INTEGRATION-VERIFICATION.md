# TM-134 integration verification — lead session, 2026-09-09

Merged `tm/TM-134-role-cli` @ `cd6f385` into `main` as `78b976a`, then applied
the worker's CLI patch as `7191cc4`.

## Verified in the tree, not taken on report

- **`topology/lib/lead.mjs` has a genuine zero diff.** The brief said not to
  churn it; `git diff --stat f3f21e7..cd6f385 -- topology/lib/lead.mjs` is empty.
- **Six files changed, all in lane:** `roles.mjs` (new, 416), `reviewer.mjs`
  (+145 — `assignReviewer` / `detachReviewer` / `reviewerStanding`),
  `identity.mjs` (+1, the `TITLES` entry), `roles/image-gen.md` (new),
  `tests/unit/topology-role.test.mjs` (new, 166), and the CLI patch file. It
  touched neither `plugin.json` nor `package.json`, despite a `main..HEAD`
  listing that appears to show otherwise — that listing is divergence from the
  lander's commit, not this worker's edits.
- **The verb works end to end.** `node topology/cli.mjs role list --json` on
  `main` returns the `ROLE_KINDS` table with `lead` and `reviewer` marked
  singleton **and carrying the reason each is singleton** ("the cross-repo front
  door: routeMessage sends every unvouched contact to the lead" / "the
  independence guarantee"), and `worker` / `designer` / `image-gen` not.

## Gates on main after merge and patch

| Gate | Result |
|---|---|
| `npm run test:unit` | 397 tests, **393 pass, 0 fail, 4 skipped** |
| `npm run test:topology` | **222 pass, 0 fail** |
| `npm run build:check` | pass |
| `npm run roadmap:check` | `ROADMAP OK: 55 tasks, 96 unlocks, …` |
| presence validators | both pass, `fixtures/presence-v1/` untouched |

## The worker corrected the brief, and was right

**`detachLead` alone cannot perform a handoff.** It clears the registry record
but leaves `role: "lead"` on the outgoing agent's `agent.json`, so `findLead`
immediately raises `TOPOLOGY_MULTIPLE_LEADS` and neither `assignLead` nor
`routeMessage` can run — the repo would be wedged mid-handoff. `reassign`
therefore also releases the library role tag (→ `worker`), while leaving the
outgoing holder's conversation, cwd, task claim, grants and `coordinates_only`
untouched. It stops being *the* lead without stopping being an agent, which is
what the brief asked for; the brief just had an incomplete mechanism for it.

Two smaller corrections, both accepted: `pendingReplies` / `leadQueueDepth` are
run-scoped and a role reassign has no `runDir`, so outstanding mail is read from
`readStandingInbox` filtered on `!reply`, with `leadQueueDepth` included only
when a caller passes `--run`; and the two handoff messages go through
`sendStandingMessage` for real, with the test asserting `status === 'delivered'`
on both rather than merely that they were attempted.

## Routed, not fixed here

The `collectPresenceAgents` role-drop was investigated and deliberately left
alone, as instructed — it belongs to the frozen contract's producer. Full
finding routed to **TM-136** and **TM-138**. It is narrower than TM-136's AC6
assumed: the `ROLES` filter at `presence.mjs:160` sits only inside the
**run-agent** loop, so a run `image-gen` agent vanishes from the snapshot while a
**standing** `image-gen` role-session still appears.
