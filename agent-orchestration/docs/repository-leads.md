# Repository leads and standing services

The topology runtime identifies a repository by its canonical Git common directory. Linked
worktrees share the agent library, lead and reviewer; workers retain their own task branches and
working directories. `lead status` distinguishes absent registration, registered but dead,
alive but unresponsive, and nonce-acknowledged responsiveness. A failed probe never kills or
duplicates a live session. `lead assign <agent> --session <name>` requires a live nonce handshake;
assignment preserves conversation, cwd, task and privileges. `lead detach` never kills an
externally owned session.

```sh
ao-topology lead status --consumer /path/to/repo
ao-topology lead ensure --consumer /path/to/repo
ao-topology reviewer ensure --consumer /path/to/repo
ao-topology startup install-hooks --provider claude
ao-topology startup watch --server default
ao-topology supervise --consumer /path/to/repo
```

`lead ensure` starts the repository supervisor automatically; run standalone watcher/supervisor
commands under the host's process supervisor when managing them separately. The watcher observes provider
processes in arbitrary tmux sessions and records pending enrollment using the exact server/session/
pane incarnation. This observation happens after startup and does not claim arbitrary CLI work was
blocked. Native-hook installation preserves foreign hooks and settings. Only adapters declaring an
observed hook capability support installation. Managed role-session launch also invokes the check.
The repository supervisor refreshes presence, checks prompt sources and resumes held mail. A live
or unknown lock owner is never evicted by age.

### Enrollment and activation

**Every Git repository is enrolled by default. Enrollment is opt-out.** To opt out, put
`{ "enabled": false }` in `.bytedesk/agent-orchestration/config.json`. A repository that is not a
Git repository (a scratch directory, `/tmp`, a path that does not exist) is not enrolled by default.
The answer is labelled with where it came from, checked in this order: `repo-config` (`"enabled": true`),
`project-plugin` (the project `.claude/settings.json` enables `agent-orchestration@<marketplace>`),
`lead-registration`, then `default`.

`"enabled": false` in the repository config disables a repository whatever else is true. An
unreadable repository config, or a non-boolean `enabled`, also counts as disabled. Every linked
worktree gets the answer from the main checkout.

**Only enrolled repositories get a supervisor started for them, which now means every repository that has not opted out.** Session start (the startup-check
hook, or a managed launch) and ordinary verbs such as `launch`, `send`, `session open`, `census`,
`lead` and `role` start the repository's single supervisor this way. Many concurrent starts from
different worktrees converge on one supervisor.

**The supervisor also runs read-only in opted-out repositories.** There it keeps presence, census,
slots and quota current, and its watcher labels only its own repository's panes. It never starts or
recovers an agent for an opted-out repository.

**Ordinary verbs list tmux panes only on a named server**: a binding's server, their own pane's
server, or `--server`. Otherwise they refuse with `TOPOLOGY_TMUX_SERVER_REQUIRED` rather than
enumerate whichever server tmux would pick.

### Lead recovery

For an **enrolled** repository only, the repository's own supervisor keeps its lead, once per
reconcile and before held mail is resumed:

| Lead state | Ownership | What the supervisor does |
|---|---|---|
| responsive | any | Reuses it. Attempts and errors reset. |
| alive, unresponsive | any | Nothing. It is never restarted, killed or duplicated. |
| dead | managed (`lead ensure`) | Restarts it under the same identity, only after re-observing that the recorded pane incarnation is gone. |
| dead | externally owned (`lead assign`) | Holds. Raises an alert naming the reassignment command, journalled once. Never replaced. |
| missing | — | Creates it through the `lead ensure` create path. |

A record with no exact pane binding, or a tmux listing that fails, is never read as dead: recovery
fails with a visible error instead. An unenrolled repository is never given an agent.

A recovery that fails or is held retries after 10 s, 30 s, 2 min, then every 10 min, and resets once
the lead is proven responsive. A lead is actively probed (rung) only when held mail asked for proof
or a lead was just launched, and at most once per retry window. `lead status` shows the recovery
`action`, `attempts`, `last_error`, `next_retry_at` and any alert; `doctor` lists a dead externally
owned lead (`LEAD_DEAD_EXTERNAL`) and a failing recovery (`LEAD_RECOVERY_FAILING`) as problems.

## Enrolling an existing session

`startup pending` lists watcher-discovered sessions and their exact pending keys.
Choose the intended existing repository-library agent, then request a challenge:

```sh
ao-topology startup pending
ao-topology enrollment request --consumer /path/to/repo --pending-key <key> --agent <agent-id>
```

The response gives a nonce and a pollable challenge file under that agent's
`enrollment-challenges/` directory. The session remains pending until it explicitly
acknowledges. Run the acknowledgement **inside the original discovered tmux pane**:

```sh
ao-topology enrollment ack --consumer /path/to/repo --pending-key <key> --agent <agent-id> --nonce <nonce>
```

The command requires `AO_AGENT_ID` to equal the assigned agent and `AO_CONSUMER`
to identify the same repository. For a directly started session without launcher
metadata, supply those two values for this acknowledgement command only, using
the identity and repository printed by the request. Its existing `TMUX` and
`TMUX_PANE` must identify the challenged server and pane; the live session and
process incarnation are checked again. Copying the command to another pane fails.

Acknowledgement preserves the session's cwd, current task, conversation and
privileges. It queues prompt refresh and reports `queued` or `restart-required`;
enrollment does not prove a new system prompt was applied. The enrolled record
becomes available to presence, and only its exact pending record is removed.
Wrong identity, changed incarnation, invalid configuration or an expired nonce
leaves the session pending. Request again for an expired challenge; conflicting
identity assignments are refused. Neither command types into or restarts a session.

## Configuration and prompts

Configuration merges bundled `config.defaults.json`, global
`$XDG_CONFIG_HOME/agent-orchestration/config.json` (default `~/.config/...`), then repository
`.bytedesk/agent-orchestration/config.json` additions. `lead.template`, `reviewer.template`,
provider/model overrides and `templates` choose dedicated agents without hardcoding a provider.
`agent new --template <name>` mints a fresh identity and retains the template name and custom
instructions.

One resolver composes generated identity/protocol, template, bundled common/role, global
common/role, repository common/role and per-agent instructions. Relative prompt paths resolve from
their declaring configuration file. `prompt preview <agent>` shows sources and revision.
`prompt refresh <agent>` stages cold-start content, or queues a live change. At a safe boundary,
live changes report `restart-required`: no current adapter promises native system-prompt
replacement. `prompt ack` checks agent identity, nonce and exact staged revision before recording
an applied revision. Malformed configuration and missing/unreadable referenced files preserve the
last valid prompt with a visible error. Prompts grant no permissions.

### Prompt entries: add or replace (TM-296)

Every prompt entry — `prompts.common`, `prompts.common_by_role.<role>` and `prompts.roles.<role>`
— is either a plain string, which is a Markdown path that is **appended** (the behaviour before
modes existed, composed byte for byte the same), or an object:

```json
{ "prompts": {
    "common": { "file": "./common.md", "mode": "replace" },
    "roles": { "lead": { "text": "Answer in British English.", "mode": "append" } } } }
```

Give exactly one of `file` or `text`; `mode` defaults to `append`. Layers compose widest first:
bundled defaults, global, repository, then the agent's own. A `replace` entry drops the **same
slot** from every wider layer and keeps the rest. The slots are `common` (common or its per-role
variant), `role`, and the agent's own text (template plus per-agent instructions).

Per-agent instructions live in `agent.json` as `instructions` (inline text) or `instructions_file`
(a Markdown path), with `instructions_mode`. Set them with
`ao-topology agent set-instructions <id> (--file <md> | --text <s>) [--mode append|replace]`. The
new source replaces the agent's previous own instructions; `--mode replace` also drops its template
prompt. `--file` must name a file inside the agent directory or the repository, and is stored
relative to the agent directory, because `agent.json` is tracked and another host or worktree would
not have an absolute path from this one; a file outside the repository is refused (use `--text`).
`prompt refresh <id>` applies the change, staged as `restart-required` for a live agent.

No mode can remove the generated identity and protocol layer, so the statement that prompts grant
no permissions is always present. Role protocol is protected the same way: the `lead` and
`reviewer` templates and the bundled `common_by_role` variant (for example the reviewer's) survive a
`replace`, which then replaces only the operator-authored text in that slot. `prompt preview` and
`agent set-instructions` report each such kept layer in `warnings`, so the reviewer's `review_submit`
verdict format cannot be configured away by accident.

### Global prefix

`prompts.prefix` — a Markdown path or `{ "text": "..." }`, no `mode` — is composed **first**,
before the generated layer. It is honoured only in the global configuration file; in a repository
or bundled layer it is ignored and reported in `warnings`. It is part of the composed text, so
changing it changes the prompt revision and the usual refresh and restart-required flow applies.

### Configuration verbs

These are the contract the gateway settings UI uses. All print JSON with `--json`.

| Verb | Result |
|---|---|
| `config get --scope global\|repo [--consumer <repo>]` | `path`, `present`, `document` (the raw layer, not the merge), `revision`, `errors`, `warnings` |
| `config set --scope global\|repo [--consumer <repo>] --file <json> [--if-revision <rev>]` | validates first, refuses a stale revision with `TOPOLOGY_CONFIG_STALE`, writes atomically, returns the new `revision` |
| `config validate --file <json> [--scope global\|repo]` | `ok`, `errors`, `warnings`; writes nothing |
| `prompt preview (--agent <id> \| --role <role>) [--consumer <repo>]` | composed `text`, `sources` (layer, path, sha256, mode), `revision`, `warnings` |

The revision is the sha256 of the file's bytes, or `absent` when the file does not exist; pass
`--if-revision absent` to create a file only if nobody else has. A refused write leaves the file
untouched. `--role` previews what a new agent of that role would be told, using the configured
`lead`/`reviewer` template for those roles.

## Standing mailbox

`mailbox send` takes an explicit source repository (or launcher-owned `AO_CONSUMER`) and source
agent, destination, body, task and optional stable `--id`. Inbox/outbox views do not require a run.
Cross-repository messages wait durably until both registered leads acknowledge readiness. Each
resume rechecks routing and the task-backed delegation; revocation cannot leave a cached grant.
Readiness is read from existing proof only; delivery never rings a lead. When a message is held
because a lead is not proven ready, the envelope is already on disk; each non-ready side then gets
a recovery request for its own supervisor, and that repository is activated so the supervisor
exists. The supervisor that proves the lead responsive makes the waiting mail due at once. A held
message records `attempts`, `last_error` and `next_retry_at` (10 s, 30 s, 2 min, then 10 min), and
resume skips it until it is due; `mailbox resume --force` retries now. A side that is not ready and
not enrolled holds as `destination_not_enrolled` or `source_not_enrolled`, on the same backoff
(enrollment can change), and no recovery is requested for it: enrollment decides which repositories
are given a lead, not whether a lead already proven responsive may receive mail. Holds no retry can change
(`hop_limit`, `loop`, `coordinator_not_worker`, `source_identity_required`,
`repository_identity_changed`) are marked `permanent` and are never retried by resume.
Reusing an ID with different content is rejected. `mailbox forward --parent <id>` derives ancestry
from the stored parent instead of allowing a caller to erase hops. `supervise` resumes holds.
Pollable records never inject input into terminal composers.

Run `send` also leaves a durable notification pending; it does not type a pointer
into a live terminal. A live pane does not prove an empty composer or safe tool
input. `--no-ring` remains accepted, but no current provider has a mechanically
verified safe notification channel. Delivery output distinguishes durable inbox
publication from notification acknowledgement.

Messages addressed to child workflows forward from the persisted parent envelope,
including the original source repository, body, task and provenance. The host
appends the delivered workflow participant to the ancestry, derives a stable retry
identity, and rechecks admission in the child's repository. Forwarding never takes
its source identity from the forwarding shell's environment. Held child requests
remain held; notification output includes those holds instead of claiming a ring.

## Review and task management

`manage admit --task TM-id --file protocol.json` uses the repository's own `tm` launcher for
claims, dependency/WIP gates and isolated worktree provisioning. Start reports name intent, files,
boundaries, dependencies and checks. Adopted active workers receive an ownership-review result;
they are not silently moved. During-work reports capture blockers and conflicts. `manage bind` verifies the task dispatch registry against the observed worker process; unknown
or reused identities fail closed. Finish requires
artifacts, the exact committed revision, checks and risks, and records `ready-for-review`, never
automatic task completion.

A finish files the independent review request itself. If that request is refused (for example, no
designated reviewer), the record keeps `review_blocked`, and the lead receives one standing-mail
notice per task revision, from `ao-topology manage`, carrying the refusal text. Fix the cause, then
retry with `ao-topology manage retry-review --task TM-id`. It re-files the request for the recorded
finish revision and clears `review_blocked`. If it is refused again, it exits with the new refusal.
`tm doctor` lists finished tasks that have commits and no review for their current revision.
`tm review-sweep` uses the same detector.

### Starting, adopting and stopping a worker

Leads do not launch workers ad hoc. A hand-made tmux session or an unrecorded subagent has no
ownership record, so `manage eligible` refuses the task with "Task dispatch must name the claim
owner and worker run.", and `manage cleanup` cannot prove it may close the session. Use these verbs,
run as the session that admitted the task (`TM_SESSION_ID`):

1. **Start.** After `manage admit`, run `manage start-worker --task TM-id [--backend tmux|topology]`.
   It calls `tm dispatch` in the admitted worktree, then binds the observed worker: tmux server,
   session, pane, pane PID and creation time, plus the workflow run ID. It refuses a task that is not
   admitted or has a bound worker that is not stopped. After `stop-worker`, `start-worker` starts the
   next round's worker and keeps the stopped binding in `previous_workers`. After changes are
   requested, run `manage rework` first (see below). A dispatch tm has already collected no longer
   blocks the re-dispatch; if tm still refuses because the previous worker is uncollected, run
   `tm collect TM-id` first. A refused `tm dispatch` is reported as `TOPOLOGY_MANAGEMENT_DISPATCH`
   with tm's own message. If the worker cannot be observed yet, the result says `bound: false`; run
   `manage bind --task TM-id` then. Do not launch a second worker.
2. **Adopt.** For a worker started before this rule, run `manage bind --task TM-id --pane <id>
   [--server <socket>]` or `--pid <pid>`. The pane must be live, the only live pane in its session,
   and in the task worktree, its session must have been created after the task was admitted, and its
   process must not be a login shell; the process must be live in the task worktree. Adopting a pane
   authorizes `stop-worker` and `cleanup` to close it, so never adopt an operator's own terminal. The server defaults to
   the caller's own tmux server. The caller itself, a pane or process another task already binds, and
   a respawned pane are refused. An in-process subagent runs in the lead's own process, so it cannot
   be adopted; finish it and start the next worker with `start-worker`.
3. **Stop.** Run `manage stop-worker --task TM-id`. It closes the bound pane only when this session
   owns the binding, the worker's finish report is recorded, and the pane is idle: its process is a
   shell with no children, so the harness has exited. Idle detection reads `/proc`, so it works on
   Linux only; on other systems a live pane is never treated as idle and never closed. A worker whose pane already exited is recorded
   as stopped. Anything else is refused with a recovery path, and the worker keeps running. It never
   closes a session it did not start or bind, and never an active one. `manage cleanup` uses the same
   rule.
4. **Retire a dead worker (TM-247).** When the worker's pane or process is observed gone (or its
   pane is an idle shell) and it never sent a finish report, `manage stop-worker` retires it instead
   of refusing. It moves the dead incarnation to `previous_workers` with the observation and what the
   worker left behind (a `tm block` reason or a blocker report), runs `tm collect` so tm records the
   dispatch as ended, and leaves the worktree and any uncommitted work untouched. A live or unproven
   worker is still refused. Then `manage start-worker` binds a successor to the same admission and
   base revision; its finish queues review as usual.
5. **Unblock and resume (TM-247).** A worker that ran `tm block` released the claim. After the
   blocker is resolved: `manage stop-worker` (retires it), `tm unblock TM-id`, then
   `manage start-worker`. Start-worker, like a resumed `manage admit`, re-claims a released claim for
   the admission owner through `tm start`, so no `TM_SESSION_ID=<owner> tm start` is needed. A claim
   held by another session is never taken. While a lead holds the claim, the pool's collector records
   a dead worker's result but never parks the task or drops the claim.
6. **Hand over an admission (TM-247).** Run
   `manage transfer --task TM-id [--to <session>] --reason "<why>"`.
   - The owner can hand the task to `--to` at any time.
   - Another lead can take the task over for itself only when the owner's claim is no longer live
     (released or expired). So review rounds are not stranded when the admitting session leaves.
   - A bound worker that is not stopped refuses the transfer. Stop or retire it first.
   - The transfer is recorded as an `ownership-transfer` event and a task comment, which both leads
     can read. Only the owner and the claim move. The admission, base, worktree, branch and lead id
     stay the same.
   - A worker stopped before the transfer still counts toward integration under its original
     owner's identity.

### Rework after changes are requested

A finish report moves the task to `ready-for-review`, and a governed task cannot be dispatched again
from there. When the independent review of the finish revision returns `changes_requested`:

1. Stop the finished worker with `manage stop-worker --task TM-id`.
2. Run `manage rework --task TM-id`. It refuses with `TOPOLOGY_MANAGEMENT_REWORK_REVIEW` unless the
   latest review is `changes_requested` for the exact current finish revision (no review, an
   approval, or a review of another revision is refused), and with `TOPOLOGY_MANAGEMENT_REWORK`
   for an unadmitted or landed task, another session, or a worker that is not stopped. It records
   a `rework` event that keeps the reviewed revision and its findings, clears the finish, returns
   the record to `working`, and runs `tm rework`, which returns the governed task to `working` and
   moves its finished dispatch into `governance.reworks`.
3. Run `manage start-worker --task TM-id` and give the worker the findings from the `rework` event.
4. The next finish report must name a new commit; the reviewed revision is refused with
   `TOPOLOGY_MANAGEMENT_REVISION`. That new revision needs its own review: integration keys the
   review on the exact revision, so the earlier verdict never applies to it.

`reviewer request --task TM-id --revision <full-sha> --author <agent-id>` queues an independent
review. The reviewer submits its verdict as JSON with its `review_submit` MCP tool (or, from a
shell, `ao-topology review submit <request-nonce> --verdict approve|changes_requested|blocked
--findings @file.json`). The submission is checked at once, written to
`<state>/reviewers/inboxes/<repo>/verdicts/<task>-<revision>.json` and mirrored to the NATS
`ORCH_REVIEWS` object store when NATS is live. `reviewer collect` reads that record; nothing reads
a verdict off the reviewer pane (TM-365). A verdict submitted before a reviewer restart is still
collected.
Findings, a changed revision, wrong identity, or an unavailable reviewer block integration.
Restricted reviewer providers must offer an enforced read-only launch; unsupported configurations
fail closed instead of substituting another provider. Review role alone grants no merge authority.

Global `management.auto_merge` defaults to true. It applies only to an operator shell: a managed
agent session always needs a covering plan grant (see "Standing delegation of integration
authority" below). Repository policy must also configure `management.target_branch` and named
`management.required_checks` as executable argv arrays.
Integration reruns those checks and verifies revision, claims, reviewer and worker ownership.
Cleanup requires collected results and verified landing ancestry, stops only a proven owned idle
worker, removes the task worktree through `tm`, and safely deletes its local branch. Missing writer
proof or any dirty/uncollected state returns a blocked reason and recovery path. Deployment,
publication and spending retain separate authorization.

### Integration policy for a repository

`manage eligible` and `manage integrate` refuse every task until the repository sets two keys in
`<repo>/.bytedesk/agent-orchestration/config.json`. That file merges over the global layer.

- `management.target_branch` is the branch the main checkout must have checked out. Integration
  fast-forwards only that branch.
- `management.required_checks` is a non-empty array of `{ "name", "argv", "timeout_ms"? }`. `name`
  is a non-empty string. `argv` is a non-empty array of strings. It is executed directly, without a
  shell, with the task worktree root as its working directory. `timeout_ms` defaults to 120000.
  Every check must exit 0. Integration runs the checks again itself and never trusts a worker's
  report. A fresh task worktree has no `node_modules`, so install dependencies in a check before
  any check that needs them.

This is the policy for the bytedesk-marketplace repository. It runs the unit suites of
agent-orchestration and task-management, the agent-orchestration bundle check, and
`claude plugin validate` for both plugins:

```json
{
  "enabled": true,
  "management": {
    "target_branch": "main",
    "required_checks": [
      { "name": "agent-orchestration: npm ci", "argv": ["npm", "--prefix", "agent-orchestration", "ci", "--no-audit", "--no-fund"], "timeout_ms": 300000 },
      { "name": "agent-orchestration: unit", "argv": ["sh", "-c", "cd agent-orchestration && env -u TMUX node --test --test-concurrency=1 tests/unit/*.test.mjs"], "timeout_ms": 900000 },
      { "name": "agent-orchestration: build:check", "argv": ["npm", "--prefix", "agent-orchestration", "run", "-s", "build:check"], "timeout_ms": 300000 },
      { "name": "task-management: unit", "argv": ["sh", "-c", "cd task-management && node --test tests/unit/*.test.mjs"], "timeout_ms": 600000 },
      { "name": "agent-orchestration: plugin validate", "argv": ["claude", "plugin", "validate", "./agent-orchestration"], "timeout_ms": 120000 },
      { "name": "task-management: plugin validate", "argv": ["claude", "plugin", "validate", "./task-management"], "timeout_ms": 120000 }
    ]
  }
}
```

Use plain `claude plugin validate`, never `--strict`. The strict form fails every versionless
internal plugin.

### Integrating through the task's pull request (TM-249)

Set `management.integrate_via` to `"pull-request"` and `manage integrate` merges the task's pull
request itself instead of fast-forwarding the main checkout. `management.required_checks` is then
not required: the pull request's CI replaces the local checks. **Leads never run raw
`gh pr merge`.** They run `ao-topology manage integrate --task <TM-id>`, which TM-243's installed
rule `Bash(ao-topology manage integrate *)` already covers; no rule is ever written for `gh pr merge`.

The pull request is the one open PR whose head branch is the task's branch. Integrate refuses,
naming each unmet condition in the error (`TOPOLOGY_INTEGRATE_REFUSED`, with a `refusals` list):

| Condition | Holds when |
|---|---|
| `plan` | A live plan grant covers this caller, repository and task. A managed session always needs one; an operator shell keeps `--authorized` and `auto_merge`. |
| `caller` | The caller is the grantee in its own pane: never a worker, never a self-asserted `--authorized` or `--actor`. |
| `pr` | Exactly one open PR has the task's branch as its head. |
| `base` | The PR's base is `management.target_branch`. |
| `head` | The PR head equals the approved review's revision **and** the task's recorded finish revision. |
| `ci` | Every check `gh pr checks` reports is `pass`. `skipping` is allowed only for a check not listed by `gh pr checks --required`; if that list cannot be read, every check counts as required. No checks, or none passing, is refused. |
| `review` | Review eligibility holds (independent reviewer, range covering the head) and the verdict is `approve`. |
| `mergeable` | GitHub reports the PR `MERGEABLE`. |

The eligibility conditions integrate always had (`protocol`, `ownership`, `config`, `scope`,
`dirty`, `worker`) are refused by name the same way.

When every condition holds, integrate runs exactly
`gh pr merge <n> --merge --match-head-commit <approved sha>`. It never passes `--admin`,
`--squash`, `--rebase` or `--auto`, and never forces anything. It then reads the merge commit
from `gh pr view`, fast-forwards the local integration branch to it (fetching `origin`), writes
the same landing record `record-landing` writes, and closes the task through the store's gates:
it attaches the management record as evidence and runs `tm done` as the authorized actor. The
landing and a `close` comment carry `actor`, `delegated_by` and `delegation_id` from the grant.
The authorization record is built exactly as the fast-forward path builds it: `authorized` is true
only for `--authorized` from an operator shell or a covering grant, so an operator-shell integrate
under `auto_merge` alone records `authorized: false, policy_auto_merge: true`.

**Integrate never accepts acceptance criteria on the task's behalf.** The lead is a managed
session; attesting that criteria are met is not its call. If the store refuses `tm done` because
criteria are unaccepted, or for any other gate, the merge and landing stand and integrate returns
`TOPOLOGY_INTEGRATE_UNCLOSED`, naming each unaccepted criterion by index and text
(`details.unaccepted`). Whoever can attest them accepts them (`tm accept <TM-id> <n>`, from the
worker's evidence or by the operator), and a rerun of `manage integrate` closes the task.

Rerunning is safe. A PR already merged at the approved head is recorded rather than merged again;
one merged at a different head is refused as `head`. If the merge succeeded but recording failed,
integrate says so (`TOPOLOGY_INTEGRATE_UNRECORDED`) and a rerun records it. If the landing is
recorded but the task is not closed, a rerun retries only the close, and only after the same
`caller` and `plan` checks the merge needed: a worker, or a managed session without a covering
grant, is refused by name (`TOPOLOGY_INTEGRATE_REFUSED`) and the task stays open.

### Tool store paths in the integration checkout

The main checkout must be clean before integration, with one exception. Task management and
orchestration write their own state into these paths, so they may be dirty or untracked:

- `.bytedesk/task-management/`
- `.bytedesk/agent-orchestration/agents/`
- `.bytedesk/knowledge/.km/`

Any other modified, staged or untracked path still blocks integration, and the refusal names it.
Integration also refuses a landing whose commits change any of these paths, so the fast-forward
never overwrites store state. Land such a change by hand and record it with `record-landing`. The
list is `INTEGRATION_STORE_PATHS` in `topology/lib/management.mjs`.

### Recording a landing that already happened

An operator sometimes lands a reviewed task without `manage integrate`, for example by merging it
by hand. A governed task then cannot close, because completion needs the merge record that only
integration writes. Record that landing with:

```bash
ao-topology manage record-landing --task TM-123 --landed <commit> --actor <name> --reason "<why>" [--authorized]
```

The command never merges or pushes. It fetches `origin/<target>` first and checks the landing
against it (TM-247), so an operator who has not pulled is not refused. When the landing is only on
the server, it fast-forwards the local target branch, exactly as `manage integrate` does after a
merge. It accepts the landing only when all of these hold:

- The task has a finished worker revision in `ready-for-review` and no recorded landing yet.
- The finish revision is an ancestor of `<commit>`.
- `<commit>` is on `management.target_branch` (on `origin` after a fetch, else the local branch).
- An eligible independent review of that exact finish revision exists. This is the same review
  gate integration uses, so the designated reviewer must be available and unchanged.
- `--actor` and `--reason` are non-empty.
- Integration authority exists, exactly as for `manage integrate`. From an operator shell:
  `management.auto_merge` is true, or you pass `--authorized`. From a managed agent session: a live
  plan grant covers you, this repository and the task, whatever `auto_merge` says.

`record-landing` runs no required checks. The actor attests to the checks that were run when the
change landed, so `--reason` should name them. The merge record says so with `checks: []` and
`checks_skipped: true`.

It collects the management record as task evidence. It then writes the same `merge` record that
integration writes, with `authorization.channel` set to `recorded-landing` and the reason
attached, and it logs a `recorded-landing` event. The task's normal completion (`tm done`, or
`manage cleanup`) then passes the governed completion gate unchanged. That gate has no override.

**A merge-in of the integration branch counts as the approved revision (TM-247).** A PR updated
with the target branch after review (GitHub's "Update branch", or `git merge develop`) has a new
head. `eligible`, `integrate`, `cleanup` and governed completion accept that head only when all of
these hold:

- It is exactly one merge commit with two parents.
- Its first parent is the approved revision.
- Its second parent is on the target branch.
- Its own change has the same patch-id as the approved revision's change.

Any other head is refused, and the refusal names both revisions. A conflict resolution or any edit
inside the merge changes the patch-id, so it needs a new finish report and a new review.

**Closing a landed task with one verb (TM-247).**
`ao-topology manage close --task TM-123 [--landed <commit> --reason "<why>"]` runs these steps in
order:

1. If no landing is recorded, it records one from `--landed` and `--reason`.
2. It stops the bound worker.
3. It runs `cleanup`, which removes the worktree and closes the task.

Each step keeps its own gates. The first refusal ends the sequence and returns its recovery.
`stop-worker` and `cleanup` also accept a task whose landing is already recorded and whose claim
`tm done` has released. So closing the task first no longer strands the worker.

### Standing delegation of integration authority

`--authorized` on `manage integrate` and `manage record-landing` is the lead attesting its own
authority to itself. When a coding-agent harness treats that as self-approval and refuses to run
it unattended, the operator otherwise has to type the command by hand every time. A standing
delegation lets the operator grant that authority once, in advance, so the lead can exercise it
without attesting to it itself:

```bash
ao-topology delegate grant --to <agent-id> --repo <consumer> --scope integrate,record-landing \
  --epic <EP-nnn> | --tasks <TM-nnn,...> --expires <duration> [--reason <text>]
ao-topology delegate list [--repo <consumer>]
ao-topology delegate revoke <id> [--repo <consumer>]
```

- **An approved plan (TM-248, ADR-0022).** A grant is how an approved plan becomes checkable. It
  names a `plan`: an epic (`--epic EP-19`), a task list (`--tasks TM-248,TM-249`), or both.
- **The plan is frozen at grant time.** `--epic` is resolved once, when the grant is made, to the
  task ids the task store lists under that epic (`tm find epic:<id> kind:task`). Give the id exactly as
  the store writes it (`EP-019`, not `EP-19`); an epic with no tasks is refused. The grant records them,
  with any `--tasks`, as `plan.tasks`, next to `plan.epic` and `plan.sha256` (sha256 of the sorted
  ids joined by newlines). The confirmation prompt lists the exact tasks being approved. A task is
  covered only when `plan.tasks` names it; its current epic is never read. So moving a task into
  the epic, or creating a task under it, changes nothing: **a new task needs a new grant.** A
  listed task moved out of the epic stays covered. A grant whose `plan.sha256` does not match its
  `plan.tasks` is refused with `TOPOLOGY_DELEGATION_INTEGRITY`, like the other evidence fields, and
  like them it catches casual edits only. A grant with no plan covers no task, and neither does an
  epic grant without a frozen list (written by TM-248's first revision): re-grant it.
- **Interactive same-user channel.** `grant` requires stdin and stdout to be a terminal and asks
  the operator to retype `<grantee> <scopes> <plan>` exactly, for example
  `lead-1 integrate,record-landing EP-19`. `grant` and `revoke` refuse a shell that
  carries any agent marker (`AO_AGENT_ID`, `TM_SESSION_ID`, `TM_DISPATCH_WORKER`, `CLAUDECODE`, `CLAUDE_CODE_*`,
  `CODEX_*`), that has a Claude Code or Codex process among its ancestors, or that sits in a tmux
  pane the census binds to an agent. `grant` also refuses a grantee granting to itself. Each grant
  records the checks it passed under `channel`, with `kind: "interactive-same-user"`,
  `agent_proof: false` and a `note`. `manage integrate` and `manage record-landing` refuse the
  whole delegations file if any grant lacks that evidence.
- **Not agent-proof.** These checks stop an agent that runs the command the ordinary way. They do
  **not** stop a deliberate agent running as the same OS user. Such an agent can unset the
  markers, start a shell outside its own process tree, and drive a TTY through tmux or `script`.
  It can also write the delegations file directly, evidence fields included. Read a grant as
  "made through the interactive channel", not as "proven operator".
- **Future work: a stronger channel.** Excluding a same-user agent needs a channel it cannot
  reach. One option is a grant store owned by a different OS user; another is a capability
  channel on the session host that agents cannot call. Choosing one is an operator decision.
- **Scope is a fixed allowlist**: `integrate` and `record-landing` only. The grant never covers
  deploy, publish, push or spend; those keep their own separate authorization and this command
  cannot widen to them.
- **`--expires` is required**, at most 14 days (`72h`, `7d`, `14d`). Set it to the plan's expected
  close; `revoke` ends a grant early.
- Records are **append-only**, under the state home
  (`$XDG_STATE_HOME/bytedesk/agent-orchestration/delegations/<repositoryKey>.json`): a grant event
  and, if it happens, a later revoke event. Nothing is ever rewritten in place.

`manage integrate` and `manage record-landing` accept a live, unexpired, unrevoked grant that
names the caller's own `AO_AGENT_ID`, this repository, the scope in use, and a plan covering the
task, in place of an explicit `--authorized`, **but only after proving the caller is the grantee**.
A task outside every live grant's plan is refused with `TOPOLOGY_DELEGATION_PLAN`. The caller's
`TMUX_PANE` must be a live pane whose `pane_pid` the census binds to the grantee, and that pane
process must be an ancestor of the caller, which is checked by walking `/proc/<pid>/stat`. Setting
`AO_AGENT_ID` or `TMUX_PANE` alone is refused with `TOPOLOGY_DELEGATION_ACTOR`.

- **Linux only.** The ancestry proof reads `/proc`. Where `/proc` is unavailable, for example on
  macOS, it fails closed. Standing delegation then never applies, and every attempt is refused
  with `TOPOLOGY_DELEGATION_ACTOR` ("process ancestry is unreadable"). Pass `--authorized` from an
  operator shell instead.
- **Remaining limit.** A process that can ptrace or inject code into the lead's process tree, or
  that is started by typing into the lead's pane, still passes as the lead. This is the same-user
  limit above.
The merge record then carries `authorization.authorized: true`, with
`authorization.actor` set to the grantee that exercised the grant, and
`authorization.delegated_by` (the grantor's OS user), `authorization.delegation_id` and
`authorization.plan` alongside. The evidence shows who acted, who granted the authority and for
which plan.

**Managed sessions cannot self-assert (TM-248).** Inside a managed agent session, `--actor` and
`--authorized` are refused with `TOPOLOGY_MANAGEMENT_SELF_ASSERT`, even when `--actor` names the
grantee. A managed session is one with any agent marker listed above in its environment, or a
Claude Code or Codex process among its ancestors (so `env -u AO_AGENT_ID` does not escape it).
There, authority comes only from a covering plan grant, and the actor only from that grant. In an
operator shell, `--actor` and `--authorized` keep working as before.

**Managed sessions always need a grant, whatever `management.auto_merge` says.** From a managed
session, `manage integrate` and `manage record-landing` require a live grant covering the caller,
this repository, the task and the scope in use, even with `auto_merge: true` (the shipped default).
Without one, eligibility reports "a managed agent session needs a valid standing delegation" and
both verbs refuse. The recorded `actor`, `delegated_by`, `delegation_id` and `plan` always come
from that grant. `auto_merge` keeps its meaning only for an operator shell: there it means no
explicit `--authorized` is needed, and the record carries `policy_auto_merge: true` with the actor
from `TM_ACTOR` or the operator's `USER`. Governed completion's checks
(`task-management/lib/governance-check.mjs`) are unchanged: they read `authorization.authorized`
and `authorization.actor` exactly as before and simply ignore the added fields.

If your harness gates commands by name, pair this with a permission rule for the governed verbs
themselves (next section). The delegation record is what makes running them without `--authorized`
safe; a harness-level rule is what lets the lead run them without a prompt.

### The repository lead's lifetime authority (TM-263, ADR-0027)

The repository's own lead can record landings, and can integrate under a server-side policy,
without a plan grant. This applies only to the lead that `findLead` returns for this repository
(the one agent with `role: "lead"`). The caller must be proven to BE that lead with the same proof
a grant needs: its live tmux pane is census-bound to the lead, and the lead's pane process is an
ancestor of the calling process. Setting `AO_AGENT_ID` or `TMUX_PANE` is not enough. A dispatched
worker (`TM_DISPATCH_WORKER`), a worker's pane, and any agent that is not the lead are refused.

**Recording a landing never needs a grant.** `manage record-landing` from the proven lead needs no
grant and no `--authorized`, and passing `--authorized` or `--actor` there is still refused as
self-assertion. Every other landing check stays, and two are added for this path:

- the task's review verdict is `approve`, at the exact finish revision; and
- the server confirms the landed commit is on its default branch (`gh api
  repos/<owner>/<repo>/compare/<landed>...<default>` answers `ahead` or `identical`). If the
  server cannot answer, the lead path refuses with `TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY`, and a
  plan grant is required as before;
- when the server's `management.lead_autonomy` policy exists, the lead it names must be the lead
  `findLead` returned. Otherwise the call is refused with `TOPOLOGY_MANAGEMENT_LANDING_AUTHORITY`.

`findLead` reads local agent files, which a same-user session can edit to re-role itself as
lead. With a server policy, the policy's `lead` field overrides that. With no server policy, the
local answer stands, and the damage is bounded: the landing must already be on the server's
default branch, with an approving review at the finish revision.

The record carries `authorization.channel: "repository-lead"`, `authorization.adr: "ADR-0027"`
and `authorization.actor` set to the lead's id. A live grant covering the task still takes
precedence and is recorded as before; a grant whose plan misses the task no longer blocks the lead.

**Integrate under the lead-autonomy policy.** `manage integrate` accepts the lead without a grant
when the repository's `management.lead_autonomy` policy **on the server's default branch** names
this lead and lists the `integrate` scope. For example:

```json
"lead_autonomy": { "lead": "fd2b831f", "authorized_by": "Ryan Helms", "adr": "ADR-0027",
                   "scopes": ["integrate", "record-landing"], "granted_at": "2026-09-28" }
```

Integrate reads the policy from the pinned repository (below) with `gh api
repos/<owner>/<repo>/contents/.bytedesk/agent-orchestration/config.json?ref=<default>`. It never
reads it from the local file, because any same-user session can edit that. If gh, the network, the
file or the key is unavailable or malformed, there is no policy, and a grant is required. The
policy authorizes only the lead id it names, only when that id is this repository's lead and the
caller is proven to be it. All other integrate guardrails are unchanged: the plan-independent
eligibility checks, the approved head, green CI, an approving review, mergeability, the base
branch and the exact `gh pr merge <n> --merge --match-head-commit <sha>` argv. The record carries
`authorization.channel: "lead-autonomy-policy"` and `authorization.policy` with `adr`,
`authorized_by` and `source: "server-default-branch"`. Grants keep working as before, for any lead.

**The GitHub repository is pinned.** `gh repo view` resolves the repository from the checkout's
remotes and gh's default, and a same-user process can repoint either at a repository it controls.
So the first successful resolution is recorded in host state at
`<stateRoot>/repositories/<repoKey>.github.json`, and every later resolution must agree with it
(GitHub names compare case-insensitively). When they disagree, the lead-autonomy policy is treated
as absent (grant required), `manage integrate` refuses with the named condition `repository`, and
the server compare used by record-landing and the reviewer range (TM-257) fails. Every later `gh`
call names the pinned repository: `--repo <owner>/<repo>` on `gh pr`, and the name in the `gh api`
path. If the move is intended, the operator deletes the pin file. The pin is trust-on-first-use
host state, so a same-user process can still edit it.

**How to revoke it.** Remove `management.lead_autonomy` from `.bytedesk/agent-orchestration/config.json`
on the default branch, through a reviewed pull request. Integrate then needs a grant again on its
next run. Removing the policy does not revoke record-landing: that authority follows from ADR-0027
itself. To withdraw it, demote the lead or supersede ADR-0027 and change the code.

**What this no longer protects against.** Before ADR-0027, every landing waited on operator intent
for a specific plan. Now:

- A compromised or misbehaving lead session can merge any reviewed, green, mergeable PR in this
  repository, and record any landing the server already has. Per-plan operator approval no longer
  limits which tasks it may land.
- The policy's integrity rests on the default branch: branch protection and PR review on the
  config file are the control. Someone who can push to the default branch can grant the policy.
- The same-user limit of the pane proof still applies: code injected into the lead's process tree,
  or a command typed into the lead's pane, passes as the lead. A process as this user can also
  replace `gh`.

The backstop is the independent reviewer's verdict, CI, and GitHub branch protection.

### Permission rules for the lead

Claude Code's auto mode can refuse a lead running `manage record-landing` or `manage admit` as
self-approval, and the same command may pass one minute and be refused the next. A plugin cannot
ship a settings allow rule. Since TM-369, the plugin ships a `PreToolUse` allowlist hook instead
(README, "Lead and worker autonomy"). It covers routine `ao-topology` verbs, including
`manage admit|start-worker|stop-worker|report`, plus `tm` and read-only `tmux`. It deliberately
leaves out `manage integrate`, `manage record-landing`, `manage cleanup` and `manage close`. For those verbs, the
operator installs the per-lead rules once per repository:

```bash
ao-topology permissions install [--mcp mcp__plugin_teamcity-mcp_teamcity] [--dry-run]
ao-topology permissions uninstall [--dry-run]
```

**The rules change no authority.** They only remove the per-command prompt:

- `record-landing` and `integrate` still refuse without a live, unexpired standing delegation that
  covers the proven caller, this repository, the scope and the task's frozen plan (see above). A
  bare verb named by its pane binding is a managed session, so this holds even under
  `management.auto_merge: true` (TM-248).
- `admit`, `start-worker` and `stop-worker` keep their claim-owner checks. `close` (TM-247) runs
  `record-landing`, `stop-worker` and `cleanup` in that order, each with its own gates.
- A dispatched worker session (`TM_DISPATCH_WORKER` set by `tm dispatch`) is refused every
  `manage` verb except `report`, `status`, `eligible` and `assignment`, and a worker never reads
  the file the rules live in.

**Exact rules written** (Ryan, 2026-09-25), plus each `--mcp` name the operator passes:

```text
Bash(ao-topology manage record-landing *)
Bash(ao-topology manage integrate *)
Bash(ao-topology manage start-worker *)
Bash(ao-topology manage stop-worker *)
Bash(ao-topology manage admit *)
Bash(ao-topology manage report *)
Bash(ao-topology manage close *)
Bash(tm *)
```

`Bash(tm *)` covers every `tm` subcommand, as Ryan decided; a narrower `tm accept` / `tm done`
pair was suggested and not adopted. No rule is ever written for `gh pr merge`, `git push`, or a
deploy command. `--mcp` takes an MCP server name (`mcp__<server>`) or a tool name
(`mcp__<server>__<tool>`), with no wildcards. An allow rule does not load a server: a standing lead
runs with `--strict-mcp-config`, so the server must also be declared in the lead's `agent.json`
`mcp` field.

**Where the rules go.** `install` writes to `<lead agent dir>/.claude/settings.local.json`. Claude
Code reads project settings from the directory a session starts in, and a standing lead starts in
its own agent directory, so only that lead reads the file. Workers start in task worktrees. The
file is machine-local; keep it out of git (a `**/.claude/settings.local.json` ignore rule). The
target is taken from the lead's launch record, `session.json` `cwd`. If that record is missing,
`install` asks you to start the lead first. If the lead launches anywhere other than its own agent
directory (TM-242 moves standing agents to the repository root), `install` refuses with
`TOPOLOGY_PERMISSIONS_TARGET_SHARED`, because every session started at the root would read the
file. A per-lead equivalent there needs the lead's launcher to pass
`--settings <agent dir>/.claude/settings.local.json`; that is not built yet.

**Behaviour.**

- **Operator only.** `install` and `uninstall` apply the same refusal as `delegate grant`: any agent
  marker, a Claude Code or Codex ancestor process, or a tmux pane the census binds to an agent.
- **Prints the exact diff** of the settings file, then tells you to **restart the lead**. Permission
  rules and MCP tools load at session start.
- **Idempotent.** A second `install` changes nothing and prints `(no change)`. Every other key and
  every other rule in the file is preserved.
- **`uninstall` removes exactly what `install` added.** The rules it added are recorded in
  `$XDG_STATE_HOME/bytedesk/agent-orchestration/permissions/<repositoryKey>.json`. A rule you had
  before installing, such as your own `Bash(tm *)`, is not in that record and stays.

**Bare commands.** Rules match the command text, so an `AO_AGENT_ID=... ao-topology ...` prefix or
a pipe (`| jq`) makes a rule miss. A lead therefore runs the verbs bare. Without `AO_AGENT_ID`, a
governed verb names its caller from the census binding of the caller's live tmux pane. Add
`--summary` for one line of output instead of JSON. Examples of commands the rules match:

<!-- lead-commands: tests/unit/topology-permissions.test.mjs checks these match an installed rule -->
```bash
ao-topology manage admit --task TM-123 --file /abs/protocol.json --summary
ao-topology manage start-worker --task TM-123 --backend tmux --summary
ao-topology manage report --task TM-123 --file /abs/finish-report.json --summary
ao-topology manage stop-worker --task TM-123 --summary
ao-topology manage integrate --task TM-123 --summary
ao-topology manage record-landing --task TM-123 --landed 1a2b3c4 --reason "merged PR 130 after review" --summary
tm done TM-123
```

## Presence v1

`presence watch` maintains a complete read-only projection every TTL/3; `presence publish` is a
one-shot producer incarnation. The default location is
`$XDG_STATE_HOME/bytedesk/agent-orchestration/presence/<repositoryKey>.json`, honoring
`AGENT_ORCHESTRATION_STATE_HOME` and global `presenceDir`. The frozen fixtures and validator are
under `topology/fixtures/presence-v1`.

Generation/revision are persistent decimal strings. Publication uses fsync and atomic replacement;
a newer producer fences its predecessor. Entries include standing, run and pending sessions with
full six-tuple bindings. Unknown ancestry remains unresolved. Roles come from library records,
never provider names or terminal text. Legacy records without exact binding proof are omitted
until renewed. The projection excludes credentials, prompts, messages and task bodies.

Source tests and a clean installed-copy launch are local evidence. They do not establish remote
publication or gateway rollout. Gateway presentation remains separately gated by its SDK contract.
