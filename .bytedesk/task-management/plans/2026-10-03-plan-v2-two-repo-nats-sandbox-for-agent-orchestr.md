# Plan v2: two-repo NATS sandbox for agent-orchestration (AO), with per-agent credentials and NATS-only storage

Revised after the operator's directions and an independent blind-spot review. Status: operator decisions recorded (end of file). Next: Phase 0b per-agent credentials, then the hand-ack run for Phases 1-3.

## Context

AO sends mail over NATS JetStream; tmux is only a doorbell. Much of the NATS surface is built but unused (work queue, `ORCH_AGENTS`, `compareAndSetClaim`, KV watch). There is no event stream, and the local fallback server uses one shared user for every agent.

Operator directions (2026-10-02):
1. **Every agent gets its own NATS credential**, scoped to its own relationships, streams and KV. Not deferred.
2. **NATS is the only data store.** No SQLite. Tasks, epics and evidence eventually live in NATS KV and the object store, not in local files. This applies to Phase 4 and later work.
3. OpenRig ideas (closure contract, computed diagnoses, bounded investigations) are adapted, not rejected. Its SQLite daemon is not adopted; the NATS equivalents replace it.

## Verified so far (Phase 0, done)

- Sandbox in the session scratchpad: `repo-a`, `repo-b`, one `nats-server`, tmux isolated (default server unchanged at 24 sessions). `sandbox.sh` has `sb_up`, `sb_ao`, `sb_down`.
- Same-repo mail passes over NATS: send, inbox, reply, wait; journal shows `message.sent`, `message.replied`, `wait.satisfied`.
- Cross-repo A→B mail is held with `leads_not_ready`.
- Not yet tested: a real ring into a composer, and any use of per-agent credentials.

## Findings that shape the plan

**Gateway credentials today** (`bytedesk-remote-gateway/internal/bus/natsembed/orch.go`):
- `IssueOrch(repo, agent, role)` gives one creds file per (repo, agent); no expiry, rotation is manual (`RotateOrch`), `RevokeOrch` deletes the record.
- Lead/worker may use `orch.<repo>.{mail,tasks,presence,claims,probe}.>`. Reviewer may publish only its own verdict subject.
- **Gap (unconfirmed, verify first):** those grants include no `$JS.API.>`, `$KV.>`, `$O.>`, `_INBOX.>` or `$JS.ACK.>`, so a minted credential may not be able to pull mail or use KV at all. Only the in-process admin user has those.
- Per-agent isolation is by subject convention only: any lead/worker in a repo can read another agent's `mail.>`. KV key prefixes cannot be enforced by the grants as written (`$KV.<bucket>.<key>` subjects could be, if the grants are narrowed).
- No subject, bucket or grant exists for events, handoff/closure, or task-management data.

**Task-management store today** (`task-management/lib/store.mjs`, `paths.mjs`): markdown + JSON frontmatter per entity in `.bytedesk/task-management/`, atomic file writes, `state.lock` for locking, `events.jsonl`, derived `index.json`, 308 task files, 4.4 MB evidence, shared across worktrees via git-common-dir, and sharing through git clones and PRs. Nearly every module touches it.

## Blind spots and how the plan handles them

| # | Blind spot | Handling |
|---|---|---|
| 1 | Shared user means every result is measured with no authorization | Per-agent creds become **Phase 0b**, before any feature. Each grant gets a negative test (B publishing to A's mail, B writing A's claim, B deleting a stream must be refused; print the server's refusal text). |
| 2 | Same-OS-user agents can read each other's cred files and `/proc/<pid>/environ` | Operator decision below (threat model). The write-up states it either way. A check shows what agent B can read of A's creds. |
| 3 | NATS-only task store loses git history, PR review of board changes, clone sharing, offline board | Task-store move is **last, behind its own gate**: scheduled export to files as backup, restore drill into a fresh server, markdown kept as a read-only mirror until the drill passes. Decide what is given up. |
| 4 | No server means no board and no mail | Test: kill the server mid-run; `send` and `tm` must fail with a clear message, not hang. Restart and confirm streams and KV return. Decide whether `tm` gets a read-only degraded mode. |
| 5 | Acked mail is deleted (work-queue retention), so no audit trail | `ORCH_EVENTS` is a limits-retention stream with a real `max_age`. Replicas are 1 on a single server, so durability is one disk; say so. |
| 6 | Claim expiry lets a stalled worker and a new claimer both work | Claims carry a fencing token (KV revision) checked on every write. Test: worker sleeps past expiry, second claims, first writes; the write is refused. Print the winner. |
| 7 | Dedupe window is 120 s; a retried handoff after 3 min makes a second copy; "create successor then close source" is at-least-once | Consumers are idempotent: KV `create` on the message id fails if it exists. Test: same id at +0 s and +150 s, print the stream count. |
| 8 | No schema version in envelopes, KV values or stream configs | Every value carries `schema: <int>`. One migration script with dry run and count check on both sides. |
| 9 | ADR-0001 classes (hooks) and NATS grants are two separate policies | One table maps each class to a grant set. A test confirms hooks and grants refuse the same actions. A grant never widens what a hook blocks. |
| 10 | Hand-typed `lead ack` makes the readiness proof vacuous | Phases 1-3 results are labeled "gate bypassed by hand ack". Each phase also runs once with **no ack** to show the gate refuses. The real-claude run is the only evidence that readiness works. |
| 11 | Ambient `NATS_URL`/`AO_NATS_URL` could point tests at a real server | `sandbox.sh` clears them, uses its own account and store dir, and prints the connected server name before any write. |

## Phases (reordered)

**Phase 0b: per-agent credentials (first).**
- Extend the sandbox server config (`nats-local.mjs` `serverConfig`) from one user to one user per agent, each with role grants plus the JetStream, KV and object-store subjects needed to work, narrowed to that agent's own `mail.<agent>` and key prefixes.
- Prefer the gateway's creds-file form so `AO_ORCH_CREDS` works in sandbox and production.
- Verify the gateway grant gap against `EnsureOrchLayout`/`orchGrants` and write the exact grants the gateway must add.
- Negative tests per grant, revocation test (a revoked agent's open connection drops), rotation test.

**Phase 1: cross-repo handoff with a closure contract.**
- Closure reasons: `handed_off_to`, `blocked_on`, `denied`, `canceled`, `no-follow-on`, `escalation`; the first three require a target. Successor first, then close source; idempotent by message id (blind spot 7).
- First get B's lead past `leads_not_ready` by hand ack (labeled), plus one run with no ack showing refusal.

**Phase 2: event stream and KV watch.**
- `ORCH_EVENTS` (limits retention) mirroring journal events; replace polling in `waitForReplies` with a durable consumer or KV watch, with a poll fallback. Computed diagnoses (`PARKED`, `DONE-UNSEEN`) as read-side views.
- Dependency: the events subject needs a gateway-side grant.

**Phase 3: work queue and claims.**
- Drive `ORCH_TASKS` with fenced claims in `ORCH_CLAIMS` (blind spot 6). Race test and worker-death test.

**Phase 4: write-up, then tracked `tm` tasks.** One task per adopted feature. The skills layer waits until after the findings doc (unproven features add surface and teach nothing).

**Phase 5: task-store move to NATS (gated).**
- Mapping: entities to KV with history above 1 and `schema`; claims to CAS (replaces `state.lock`); evidence to the object store named by content hash; `events.jsonl` to a stream; `index.json` dropped in favor of key listing and watch. Per-machine files (`pool.state.json`, `dashboard.*`, `planner/`) stay local.
- Straight cutover (operator decision). Preconditions: Phase 0b creds with `TM_*` buckets in the same role model; the schema extension above (history, proposals, hub/leaf sharing, offline queue) designed and exercised in the sandbox first; one pre-cutover `tm export` snapshot.
- Task-management and AO stay independent: no cross imports, no manifest dependency, so any shared NATS client must not make one depend on the other.

**Final run: real `claude` leads in each repo**, with real credentials, to prove readiness and the real ring into a composer.

## Verification

- Every phase has a script that fails when the behavior is absent. It prints raw values (stream count, winning agent id, the server's refusal text), not a pass count.
- Each result records the commit and dirty state of the tree measured, and names what the sandbox removed (no gateway, shared state home, hand ack).
- tmux: three-way isolation per `.claude/rules/tmux-test-isolation.md`; confirm the default server's session count is unchanged after each phase.
- No edits under `agent-orchestration/` or `task-management/` until Phase 4 produces tracked tasks. Unit suite (`node --test --test-concurrency=1`) must stay green.
- Teardown: scoped tmux kill, sandbox `nats-server` pid dead, default `tmux ls` unchanged.

## Operator decisions (2026-10-02, final)

1. **Credential threat model: stop mistakes AND a malicious agent, with cross-server project coordination in mind.**
   - Creds must not be readable by a sibling agent on the same OS user: gateway-issued creds delivered per process (inherited pipe/fd or a unix-socket handshake), never a file or env var in the agent's reach. Check `/proc/<pid>/environ`, `ps`, and the agent directory for leaks.
   - Use nkey/JWT users (not passwords), a separate NATS account per repo, and a leaf-node or mirror link between servers, so a cross-server agent holds a credential valid only on its own account plus explicit imports/exports.
   - Revocation must drop an open connection; credentials get a finite lifetime with rotation (the gateway has no expiry today).
   - Phase 0b exit test: agent B, acting as B, cannot read A's creds or use A's subjects, and the refusal text is printed.
2. **Task-board move: straight cutover, with the schema extended to carry what git gives today.** No dual-write and no restore-drill gate. Safeguard kept because it is cheap: one `tm export` snapshot is taken immediately before cutover.
   Schema extension, one answer per thing lost:
   | Lost with files | NATS replacement |
   |---|---|
   | History and `git blame` | KV `history` set high for entity buckets, plus an append-only `TM_EVENTS` stream (limits retention, long `max_age`) where every write records actor, agent id, revision, old/new digest, reason and, when known, the git commit/PR. |
   | PR review of board changes | A `proposal` entity: a write that needs review lands as a proposed revision (own key), with a diff view computed from the two revisions; accept/reject is a gated action for the human (ADR-0001 repo-destructive class). |
   | Sharing by clone | A durable hub account; other servers connect as leaf nodes or JetStream mirrors, so every server sees the same board. Board identity stays the `owner/name` of the origin remote. |
   | Offline use | Leaf node with a local JetStream cache: reads work offline; writes queue as proposals and sync when the link returns. `tm` reports "offline: read-only/queued" instead of hanging. |
   | Evidence files | Object store keyed by content hash; the entity stores the digest. |
   | Backup and recovery | Stream snapshots on a schedule plus mirror to a second server. Replica count noted: 1 on a single server. |
   Every value carries `schema: <int>`; one migration script with a dry run and a count check on both sides. Per-machine files stay local.
