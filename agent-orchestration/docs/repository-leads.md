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
The repository supervisor refreshes presence, checks prompt sources and resumes held mail. It does
not create, replace or terminate agents. A live or unknown lock owner is never evicted by age.

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

## Standing mailbox

`mailbox send` takes an explicit source repository (or launcher-owned `AO_CONSUMER`) and source
agent, destination, body, task and optional stable `--id`. Inbox/outbox views do not require a run.
Cross-repository messages wait durably until both registered leads acknowledge readiness. Each
resume rechecks routing and the task-backed delegation; revocation cannot leave a cached grant.
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

`reviewer request --task TM-id --revision <full-sha> --author <agent-id>` queues an independent
review. `reviewer collect` accepts the challenge-bound response from the registered reviewer.
Findings, a changed revision, wrong identity, or an unavailable reviewer block integration.
Restricted reviewer providers must offer an enforced read-only launch; unsupported configurations
fail closed instead of substituting another provider. Review role alone grants no merge authority.

Global `management.auto_merge` defaults to true. Repository policy must also configure
`management.target_branch` and named `management.required_checks` as executable argv arrays.
Integration reruns those checks and verifies revision, claims, reviewer and worker ownership.
Cleanup requires collected results and verified landing ancestry, stops only a proven owned idle
worker, removes the task worktree through `tm`, and safely deletes its local branch. Missing writer
proof or any dirty/uncollected state returns a blocked reason and recovery path. Deployment,
publication and spending retain separate authorization.

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
