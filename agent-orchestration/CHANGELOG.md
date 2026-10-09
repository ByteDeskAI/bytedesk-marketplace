# Changelog

## [Unreleased]

## [0.16.1] — 2026-10-08

Security release. It closes the high-severity holes found in independent post-merge review of the
EP-028 work (PRs #222–#226), plus #221's NATS autostart delivery (TM-400) and the TM-471 test fix.

### Known issues

- **TM-427 is still open: `review submit` and the verdict file trust `AO_AGENT_ID`.** A same-user
  process that sets `AO_AGENT_ID` to the reviewer's id can submit a verdict, or write the verdict file
  directly. Interim mitigation: the autonomy hook (TM-433) never auto-approves `review submit` for a
  worker. Do not treat 0.16.1 review approvals as fully hardened. The fix is planned for 0.16.2.
- **TM-428 is still open.** A NUL byte in a source file's first 8000 bytes still moves that file out
  of the reviewed patch into a hash-only manifest row. Planned for 0.16.2.
- **TM-445 is still open.** The saved effective-base cache is read before the server is asked, so a
  same-user write can narrow a review range. Planned for 0.16.2.
- Keep `management.autonomy` at `pr` until these ship.

- **The reviewer tests pin the file transport themselves (TM-471, EP-028).** Two late-ack tests in
  `topology-reviewer.test.mjs` passed only when the suite preload set `AO_TRANSPORT=file`. Run
  bare, they used NATS, so no probe file was written and both tests failed. The fixture now sets
  `AO_TRANSPORT: 'file'` in its own env. Test-only; no runtime change.
### Security

- **record-landing checks the server, host git ignores caller GIT_* variables, and gh must be root-owned (TM-472, TM-443, EP-028).**
  `manage record-landing`, including under an operator's `--authorized`, now requires the landed
  commit on the pinned repository's target branch on the server (`gh api .../compare`). Before, it
  trusted `origin/<target>` after a fetch from a worker-chosen `origin`, so a forged ref could report a
  landing that never happened. safe-git keeps only the commit-identity `GIT_*` variables, so
  `GIT_DIR`, `GIT_SSH_COMMAND`, `GIT_EXEC_PATH`, `GIT_ASKPASS` and the rest are dropped. It pins
  `GIT_CONFIG_GLOBAL` to `~/.gitconfig`, so a caller-supplied global config (and its filters) is never
  read. Host `gh` calls (`hostGh`, also used by release readiness) run only the root-owned `gh` at a
  pinned system path (`trustedGh`, the root-owned-chain rule the autonomy allowlist applies to tmux),
  never the first `gh` on `PATH`.
- **Review fixes for the gate security work (PR #226; TM-443, TM-441, TM-442, EP-028).**
  - safe-git pins its overrides through `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n`, so a filter or merge
    driver whose name contains `=` (`filter.a=b.smudge`, which `-c` cannot name) is neutralised too.
  - safe-git allows only the https, ssh and file transports, so a worker-set `evil::` remote never runs
    `git-remote-evil`. It refuses outright (exit 128) when repository config sets `url.*.insteadOf`,
    `url.*.pushInsteadOf`, `remote.*.vcs`, `lfs.standalonetransferagent` or `lfs.customtransfer.*`.
    It never smudges LFS objects (`GIT_LFS_SKIP_SMUDGE=1`), including in the TM-444 check worktrees.
  - A merge-in's integration parent must be on the target branch of the pinned repository on the
    server (`gh api .../compare`, ahead or identical), never on a local or remote-tracking ref a
    worker can forge. task-management uses the same rule.
  - Release readiness requires the checkout's commit to be the server's branch tip, not merely equal
    to a worker-chosen `origin`.
- **`manage transfer` takeover needs lead proof and owner absence (TM-459, EP-028).**
  A session could take ownership of a task as soon as the owner held no live claim, but `tm block`
  or `tm park` releases the claim while the owner is still alive. A takeover (the caller is not the
  owner) now requires the caller to pass `requireLeadCaller` (this repository's lead, proven by its
  census-bound pane) and the owner to be proven absent by `ownerPresence`: no live pane the census
  binds to it and no heartbeat from it fresher than `HEARTBEAT_TTL_MS`. A hand-over by the owner is
  unchanged.
- **Autonomy `publish` never grants a production cutover (TM-458, EP-028).**
  `management.autonomy: "publish"` let `manage cutover` deploy to a live production host with no
  human, and a test asserted it. `publish` now grants `manage cut-release` only; `manage cutover`
  always needs `--authorized` from an operator shell (ADR-0001 External class; the standing rule that
  a production deploy asks first). The former CLI test is inverted: a managed session is refused and
  nothing is deployed.
- **`cut-release` waits for the TeamCity build of its own revision (TM-457, EP-028).**
  `waitForBuild` accepted the first finished build of the build type newer than the pre-release
  build, on any branch or revision, so a green develop or pull-request build could pass the release
  gate while the release build was red. It now requires one of the build's VCS revisions to be the
  release revision (the checkout's commit, or the commit the release step left it at) and, when
  `management.release.teamcity.branch` is set, that branch. Builds of anything else are ignored; with
  none matching, the wait times out and pages. The record names the matched build's revision and branch.
- **A worker's check evidence is labelled "claimed" and never satisfies a required check (TM-430, EP-028).**
  The finish report's `checks` were filed into the review packet as plain evidence, and under
  `integrate_via: "pull-request"` the packet was the only required-check gate, so a worker could
  report `exit_code: 0` for a check that never ran. Every automatic review request (report,
  retry-review, review sweep) now files them through one helper, `claimedCheckEvidence`, which
  prefixes the command and log with `[claimed by the worker; not run by the host]`. Integration no
  longer treats the packet's check evidence as a result (those reasons are reported as
  `required_checks.claimed_check_reasons`); both integrate paths run the configured argv on the host
  in a fresh tree (`runRequiredChecks`), and the pull-request path refuses as `checks` before any
  merge. The packet-side comparison of a run's command with the configured argv belongs to
  `reviewer.mjs` (another owner) and is not changed here.
- **A worker can no longer grant itself publish/merge autonomy, rewrite required checks or choose the release argv (TM-442, EP-028).**
  `management.autonomy`, `management.release`, `management.cutover` and `management.required_checks`
  are now honoured only from `.bytedesk/agent-orchestration/config.json` as committed on the server's
  default branch of the pinned repository (read through `gh`, as TM-263 reads `lead_autonomy`). A
  value for them in the global layer, the plugin defaults or the checkout's working copy, all of
  which a same-user worker can write, is ignored with a warning; signing is not implemented, so there
  is no other trusted source. With the server unreadable, autonomy is `pr` and the other three are
  unconfigured. `manage integrate` refuses a task that changes `management` in that committed file.
  `ao-topology config set` refuses in a dispatched worker session (the shared `dispatchedWorker`
  predicate `manage` also uses). Release and cutover `argv[0]` is now an allowlist: a repo-relative
  path, tracked as an executable at the release revision, whose bytes equal the committed blob;
  interpreters, shells, `busybox`, `env`, `npx`, `npm`, `deno`, `bun`, absolute paths, `..` and bare
  `PATH` names are refused. `reviewer.mjs`'s `requiredCheckNames` still reads the local layers for
  the review packet (owned by another session); integrate no longer depends on it.
- **A merge-in is accepted only when its tree is exactly the merge git computes (TM-441, EP-028).**
  `mergeInOf` compared `git patch-id --stable`, which ignores whitespace, so a merge of the
  integration branch into the approved revision could carry an unreviewed behaviour change
  (`rm -rf /tmp/build` became `rm -rf / tmp/build`) and still land. It now requires the head's tree
  to equal `git merge-tree --write-tree <approved revision> <integration parent>`; a conflicted
  merge is never a merge-in. task-management's mirror uses the same rule, and one test runs both.
- **Required checks run in a fresh tree of the finish revision, not in the worker's worktree (TM-444, EP-028).**
  `manage integrate` ran each `management.required_checks` argv with the worker's worktree as its
  working directory. `git status --porcelain` hides ignored files, so a planted
  `node_modules/.bin/<runner>` that exits 0 passed a check that never ran. Checks now run through
  `runRequiredChecks` in a detached worktree of `record.finish.revision`, created and removed
  through safe-git, holding only the committed files; each run is recorded with `runner: "host"`.
- **Host-side git no longer runs config a worker planted in the shared `.git/config` (TM-443, EP-028).**
  A worker runs as the same OS user and can set `core.fsmonitor`, `core.hooksPath`, `diff.external`,
  `core.pager`, a filter or merge driver, a credential helper or a remote `uploadpack` in the
  repository's shared config; the lead's next `git status` (dirty-path check, integration
  eligibility, release readiness) then ran it as the lead. Every git call in `topology/lib` and
  `src/` now goes through one helper, `topology/lib/safe-git.mjs`, which pins every executing key
  on the command line, neutralises repository-scope filter and merge drivers (a merge driver becomes
  a conflict), keeps only the operator's global credential helpers, forces `--upload-pack` /
  `--receive-pack`, adds `--no-ext-diff --no-textconv` to diff-family commands, and runs with
  `GIT_CONFIG_NOSYSTEM=1` and `GIT_TERMINAL_PROMPT=0`. `doctor`'s `git ls-remote` passes `--` before
  the manifest's repository, so a value starting with `-` is never an option. A test plants every
  vector and runs eligibility, integrate and release readiness; a grep test fails on any raw git
  spawn outside the helper. Not yet routed: `topology/lib/reviewer.mjs` (owned by another session;
  allow-listed in the grep test). The global `~/.gitconfig` is trusted by design.
- **`workers.passEnv` is honoured only from the global config, and never for a reserved name
  (TM-448, EP-028).** The repository layer is git-tracked, so a worker whose PR landed could name
  `GITHUB_TOKEN` there and have it copied into every later worker. `passEnvFor` now reads
  `workers.passEnv` from the global (or plugin-defaults) layer only, using `loadConfig`'s per-layer
  provenance; a name set only in the repository layer is ignored with a warning in launch
  warnings and session logs. `TM_*`, `AO_*`, `CLAUDE_*`, `LD_*`, `DYLD_*`, `GIT_*`, `PATH`, `HOME`
  and `NODE_OPTIONS` are refused from every layer. A test also pins that the launcher exports the
  agent's own variables after sourcing the secrets file. Review follow-up: also refused are
  `BASH_ENV`, `ENV`, `ZDOTDIR`, `NODE_PATH`, `PYTHONPATH`, `PYTHONSTARTUP`, `PERL5OPT`, `RUBYOPT`,
  `XDG_CONFIG_HOME`, `TMUX`, `TMUX_PANE` and `SSH_AUTH_SOCK`. With `SSH_AUTH_SOCK` refused, the
  supported way for a worker to push is an HTTPS `origin` remote with `gh auth setup-git`.
- **A durable session started without `AO_CONSUMER` no longer leaves its secrets file behind
  (TM-450, EP-028).** The 0600 `<launcher>.env` was removed only after the readiness wait, which
  runs only with `AO_CONSUMER`. `retirePassEnv` now waits (bounded) for the launcher to consume
  it and then removes it on the other path too.

### Changed

- **Automatic review requests carry the worker's check evidence (TM-418, EP-028).** A finish report
  may list structured runs in `report.checks` (`{name, command, exit_code, revision, log_tail}`).
  `manage report`, `manage retry-review` and the supervisor review sweep all attach those runs to
  the review request through one helper, `finishCheckEvidence`. With a passing run of every
  required check at the finish commit, the reviewer can approve without a lead re-requesting with
  `--checks`. Prose strings in `checks` stay notes and never count; a run at another commit still
  satisfies nothing; a malformed run is refused when the finish is reported.

- **One process-ancestry walk (TM-416, EP-028).** `delegation.mjs` `ancestorProcesses` now names
  the pids from `heartbeat.mjs` `ancestorPids` instead of walking the tree itself. The shared walk
  gained the `ps` fallback delegation had, so the heartbeat and prompt lifecycle also see the full
  chain where `/proc` is absent (macOS).

- **Skill cleanup: fewer, clearer entry points (TM-377, EP-028).** `roadmap-orchestrator` is now
  `roadmap-governance` (it governs `ROADMAP.md`; it never orchestrated agents); its description
  names the old name so `$roadmap-orchestrator` still resolves, and host wiring removes the Kimi link
  an older install left under the old name. `install-orchestration-host` is merged into
  `setup-agent-orchestration` as its "Wire another host" step; the script moved to
  `skills/setup-agent-orchestration/scripts/install-host.mjs`. `orchestration-conduct` is marked
  not user-invokable (it is the conductor's internal protocol). `goal-feedback-loop` now has
  trigger phrases and an argument hint.

- **One doctor for AO, task-management and the services (TM-379, EP-028).** `agent-orchestration
  doctor` now leads its JSON with a `combined` block and exits 1 when any present part is
  unhealthy: `agentOrchestration` (the doctor's own verdict), `services` (process-compose answering
  and every managed process Running, the same predicate as `services wait --until healthy`;
  `ok: null` when services are switched off), `taskManagement` (`tm doctor --json` run through the
  repository's tm launcher, never imported; `ok: null` when tm is absent) and `pluginFreshness`
  (TM-373, informational). It used to exit 0 whatever it found.

- **`ao-topology repos list|add|remove` makes repository registration explicit (TM-378, EP-028).**
  Until now a repository got a supervisor only as a SessionStart side effect. `repos list [--json]`
  shows each entry of the services `repos.json` registry with its supervisor state (running,
  starting, never-started, down, repository-missing and so on). `repos add [<path>]` registers a
  git checkout: a linked worktree registers its main checkout, and a plain directory is refused
  with `TOPOLOGY_REPO_NOT_GIT`. `repos remove [<path>|<key>]` unregisters it by path, worktree path
  or key, and never deletes the repository or its state. When services are enabled, add and remove
  run `services ensure` so the supervisor starts or stops at once. `services ensure --consumer-cwd`
  and `repos add` now share one `registerRepository` in `topology/lib/services-client.mjs`.

- **`/orchestrate` is one entry point across both plugins (TM-376, EP-028).** The new
  `orchestrate` skill maps each intent (dispatch a task, drain the pool, ticket another repo,
  message one lead or `@all-leads`, wait for a reply, launch a team, ask another model, run a goal,
  check status or health, mine for issues) to the one skill or verb that does it, says what still
  works when task-management or agent-orchestration is absent, and separates the three meanings of
  "route", "cap" and "agent". `tests/unit/orchestrate-skill.test.mjs` fails when a verb, sub-verb,
  flag, MCP tool or skill it names does not exist in `topology/cli.mjs`, `src/cli.mjs`, `bin/tm`'s
  VERBS table or either MCP server.

- **A refused review request reaches the lead, with one verb to retry it (TM-244, EP-028).** When a
  finish report's review request is refused, `manage report` still records `review_blocked`. It now
  also sends the owning lead one standing-mail notice per task revision, with the refusal code and
  text and the retry verb. The notice is sent before the task-management comment, so it does not
  depend on task-management. `ao-topology manage retry-review --task TM-id` re-files the request for
  the recorded finish revision and clears `review_blocked`. The `--summary` line of `manage report`
  names the notice status and the retry verb.

- **Review packet, per-repo checklist and revision-bound check evidence (TM-216, EP-028).** Every
  review request now writes a packet directory beside its `.patch`: `files.txt` (name-status and
  stat), `files/<path>` (each changed text file at the revision), `task.md` (the task's acceptance
  criteria and touches, read through the repository's tm launcher when it exists), `checks.json`
  and `checklist.md`. The packet's `packet_sha256` is recorded on the request, and collection
  refuses a packet that changed after the request, as it does a changed patch. `checklist.md`
  lists each `management.required_checks` entry as passed or unsatisfied, followed by the
  repository's own `.bytedesk/agent-orchestration/review-checklist.md`, read from the consumer
  checkout and not from the author's worktree. The lead passes check evidence with
  `ao-topology reviewer request --checks @checks.json`
  (`[{name, command, exit_code, revision, log_tail}]`). While any required check lacks evidence
  recorded at the reviewed revision with exit 0, the reviewer cannot approve: submit and record
  refuse `approve` and the reviewer submits `blocked`. `reviewer eligible` independently refuses a
  required check with no evidence, evidence recorded at another revision, or a nonzero exit. The
  reviewer's launch is unchanged: it still cannot write files or run commands.

- **Landing autonomy: `management.autonomy` is `pr`, `merge` or `publish` (TM-368, EP-028).** It
  comes from the AO layered config (repo, then global, then the shipped default `pr`); an unknown
  value invalidates its layer. The new `ao-topology manage land --task <TM-id>` follows it: `pr`
  stops at the reviewed PR, `merge` runs `manage integrate`, and `publish` also runs `cut-release`
  once every task of the epic has landed, then records the publish and runs
  `tm ticket event <id> published` for a cross-repo ticket's origin (TM-359). At `publish` the
  policy is the External-class grant (ADR-0001) for `cutover` and `cut-release`; each record names
  the grant layer and file in `authorization.granted_by`. `cut-release` now waits for the TeamCity
  build its release started, read through a small REST adapter (`topology/lib/teamcity.mjs`;
  `TEAMCITY_URL` or config, `TEAMCITY_TOKEN` from the environment only), and requires it under
  `publish`. A red or missing build, a failed verify or cutover postflight, a missing reviewer
  approval, a failed step or a release refused after merge stops the run and pages through ntfy
  (`topology/lib/ntfy.mjs`, AO's own notifier, so it works with task-management absent). The
  autonomy hook never approves `manage land`. Documented in the README under "Landing autonomy".

- **`manage cutover` and `manage cut-release` wrap deploy-safe and /release behind guardrails
  (TM-250, EP-028).** Both are External-class verbs (ADR-0001). They run only the repository's own
  argv from `management.cutover` / `management.release` (for example `deploy-safe.sh deploy`,
  `release-gitflow.sh start` then `verify`), without a shell. Each refuses by name, running nothing,
  unless every condition holds: `config` (argv set, and argv[0] is never `systemctl`, `git`, `gh`,
  a shell, `sudo`, `env` or `ssh`), `authority`, `branch` (default `develop`), `dirty`, `sync` (HEAD
  equals `origin/<branch>` after a fetch) and `plan` (every task of `--epic` is done). `cutover`
  proves the running binary switched: `identity_argv` must answer before and answer differently
  after, and a failed postflight stops it. `cut-release` fails unless its verify step passes. Each
  run writes a record, with its authorization, under the management state directory. The
  autonomy hook never approves either verb. `manage release` keeps its existing meaning (release an
  idle assignment), so the release wrapper is named `cut-release`.

- **`manage cleanup` refuses protected branches by name (TM-251, EP-028).** Cleanup removes a
  merged task's worktree and its LOCAL branch only (`git branch -d`). Before it observes or removes
  anything, it refuses a record naming `develop`, `main`, `master`, any `release/*` branch or the
  configured integration branch, with `TOPOLOGY_MANAGEMENT_CLEANUP` and the branch named. Remote
  branch deletion stays out of scope: a test proves the remote copy of a cleaned branch survives.
  `protectedBranch()` in `topology/lib/management.mjs` is the one predicate.

- **`manage transfer` hands a governed admission to another lead (TM-247, EP-028).**
  `manage transfer --task <id> [--to <session>] --reason <text>`:
  - The owner can hand off to `--to`.
  - Any other session can take over for itself once the owner's claim is no longer live.
  - A bound worker that is not stopped refuses the transfer.
  - The transfer is an `ownership-transfer` event plus a task comment. The claim moves through
    `tm claim`.
  - A worker stopped before the transfer still satisfies integration under its original owner.

- **Closing a landed governed task no longer has an order trap (TM-247, EP-028).**
  - `manage close --task <id> [--landed <sha> --reason <text>]` records the landing if none is
    recorded, stops the worker, then cleans up and closes the task, in that order.
  - `stop-worker` and `cleanup` also accept a task whose landing is recorded after `tm done`
    released its claim.
  - `record-landing` checks the target on `origin/<target>` after a fetch, then fast-forwards the
    local branch.
  - Eligibility, integrate, cleanup and governed completion accept a PR head that merged the
    integration branch into the approved revision, when the merge's own change has the approved
    revision's patch-id. Any other head is refused, and the refusal names both revisions.
  - `permissions install` now also writes `Bash(ao-topology manage close *)`.

- **A governed worker that died before its finish report can be retired and replaced (TM-247, EP-028).**
  `manage stop-worker` now retires a bound worker whose pane or process is observed gone (or is an
  idle shell) and that never sent a finish. The dead incarnation moves to `previous_workers` with
  the observation and what it left behind (a `tm block` reason or a blocker report). `tm collect`
  records the dispatch as ended. The worktree and its uncommitted changes are untouched. A live or
  unproven worker is still refused. `manage start-worker` then binds a successor to the same
  admission and base revision. Start-worker and a resumed `manage admit` re-claim a released claim
  for the admission owner through `tm start`. A blocked task waits for `tm unblock`. A claim held by
  another session is still refused. `manage report` accepts a report from the admission owner or
  from the bound worker's own dispatch session. The ownership refusal for a released claim now names
  the recovery: `manage admit`. A refused `tm dispatch` in start-worker is now
  `TOPOLOGY_MANAGEMENT_DISPATCH` carrying tm's message, not a Node stack trace.

- **The standing-mail arrival ring rings only unread mail the inbox would show (TM-419, EP-028).**
  On its first live tick the TM-351 ring sent a lead about 20 pointers for mail it had handled
  weeks earlier, or that `mailbox inbox` could not show: records from before NATS publication
  existed. The ring and the inbox listing now share one predicate (`standingInboxShows` /
  `standingUnread`): under NATS only broker-published records count, and any receipt (accepted,
  deferred, handled, rejected) or reply means the mail is not unread. The first run for a
  repository also writes a watermark under `standing-mailbox/rings/`, so mail delivered before it
  never rings. `dist/` is rebuilt.

- **Run mail delivered over NATS also lands as an inbox file (TM-409, EP-028).** `send` with the
  NATS transport now writes the message into the recipient's inbox directory after the publish
  succeeds, and the delivery names an outbox path. The message tells the recipient it may reply
  on NATS or write its reply to that outbox file. A file-only reviewer therefore receives
  NATS-delivered mail.

- **`wait` accepts a file reply to a NATS-delivered message (TM-410, EP-028).** `pendingReplies`
  and `waitForReplies` treat a NATS-delivered message as answered when its outbox reply file has
  content, as well as when a NATS reply exists. The file reply is returned with its path.

- **`prompt ack` works from a child shell of the agent's pane (TM-411, EP-028).** The ack used to
  bind to the pane named by `$TMUX_PANE`, and was refused with `TOPOLOGY_PROMPT_ACK_INVALID` from
  an agent's Bash tool shell. It now binds to the pane whose process is an ancestor of the caller,
  using the same `/proc` ancestry walk as the TM-222 heartbeat (`ancestorPids`, now exported), and
  still requires the recorded incarnation. Any caller outside that pane's process tree is refused,
  including one that sets `TMUX_PANE` by hand.

- **TM-241 review-patch follow-ups (TM-260, EP-028).** Four fixes to how the reviewed patch is
  built, all in `reviewPatch`, which the review range and the TM-257 legacy check now share:
  - **Size cap.** The over-cap refusal never fired: it matched `ERR_CHILD_PROCESS_STDOUT_MAXBUFFER`,
    but Node reports `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. It now fires and reports bytes, not UTF-16
    units. `AO_REVIEW_PATCH_MAX_BYTES` lowers the 64 MiB cap.
  - **Binary classification.** A file is binary when its own first 8000 bytes hold a NUL (git's
    own test). The range's `.gitattributes` no longer decides, because the author controls it. Text
    files are diffed with `--text`, so `*.mjs binary` cannot hide source in the manifest.
  - **Legacy hash path.** A landed pre-TM-257 request is reproduced with the same builder. A
    binary range in the current format verifies, and an approval in an older format asks for a
    re-review (`TOPOLOGY_REVIEWER_REREVIEW`).
  - **Manifest paths.** Paths are JSON-encoded, so a newline or tab in a filename cannot forge a
    row.

  Binary ranges now hash differently from TM-241, so their approvals need a re-review. Text-only
  ranges hash exactly as before.

- **A network blip no longer flips an approved review (TM-259, EP-028).** Once the server has
  verified a task revision's effective review base, the host records it in
  `<state>/management/<repo>/<task>.bases.json` and reuses it for that exact (task, revision). So
  supervision and eligibility sweeps make no GitHub call for a recorded revision, and a rate
  limit or outage can no longer fall back to the admitted base and report an approved task as
  "review does not cover the complete admitted task range". A fallback is never recorded, so a
  first derivation with the server down still fails closed to the admitted base. A recorded base
  that is not between the admitted base and the revision is ignored. The GitHub repository itself
  was already pinned by TM-263.

### Security

- **Run `send` checks a named sender (TM-462 part A, EP-028).** `ao-topology send --run` took
  `--from` and `--from-project` verbatim, so `--from ao-supervisor --from-project /other` reached
  `sendStandingMessage` as that sender. A named `--from` or `--from-project` now goes through the
  same `sessionIdentity()` as `mailbox send`; a value that differs from this session's identity is
  refused with `TOPOLOGY_SENDER_MISMATCH`, and a session with no identity gets
  `TOPOLOGY_SOURCE_IDENTITY_REQUIRED`. Unnamed, the launcher defaults are unchanged. A grep-audit
  test checks that every standing-mail entry point (CLI `send` and `mailbox`, the MCP mailbox and
  run-mail tools) resolves its actor through that one check. Reserved system senders and env trust
  (part B) are TM-427's.
- **`session handoff` is restricted (TM-463, EP-028).** Any session could type a file pointer into
  any agent's live pane. The CLI verb now accepts only the target agent itself or this repository's
  lead proven by `requireLeadCaller` (pane binding plus process ancestry; a session without
  `AO_AGENT_ID` is named from its census binding first, as `manage` does). Anyone else gets
  `TOPOLOGY_HANDOFF_UNAUTHORIZED` and nothing is typed. `orchestration_session_handoff` runs the
  verb, so it shares the check.
- **`mailbox wait` answers only the sender (TM-465, EP-028).** `orchestration_mailbox_wait` and CLI
  `mailbox wait` returned any message's reply to anyone who knew or guessed its id.
  `waitForStandingReply` now requires the caller's session identity and refuses, with
  `TOPOLOGY_SENDER_MISMATCH` and no status or body, unless the caller is the envelope's `from` in
  its `sourceRepoId`.
- **CLI mailbox verbs act only as the session (TM-464, EP-028).** `mailbox inbox`, `outbox`,
  `receipts`, `dispose` and `reply` took `--agent` (or `AO_AGENT_ID`) as given. They now resolve the
  agent with `sessionIdentity()`, as the MCP tools do: `--agent` and `--consumer` may only repeat
  it, and without `--consumer` the mailbox is the session's own repository. MCP
  `orchestration_mailbox_list` is bound the same way.
- **Mailbox readers fail closed; the workflow console is operator-only (TM-464 F1, EP-028).**
  `console show` returned every agent's receipt bodies because `listMailboxReceipts` and
  `listMailboxPublications` read a missing `agent` as "all agents". Both now require a bound
  `agent`, or an explicit `allAgents: true`, which only the workflow console and the publication
  resume loop pass. The console (`workflowDetail`) admits only a bare operator shell (no agent
  identity and a pane the census binds to no agent) or the repository lead proven by
  `requireLeadCaller`; a dispatched worker, a minted session, a non-lead agent, and an agent that
  unset `AO_AGENT_ID` in its bound pane are refused with `TOPOLOGY_OPERATOR_ONLY` before any lookup. MCP
  `mailbox_list` passes named fields only, so a tool input cannot carry `allAgents`. The audit test
  now checks every reader (including `readStandingMessage`, allowed only in its internal readers)
  and actor call site in `topology/lib`, `cli.mjs` and `topology-api.mjs`. `standing-mail-ring.test.mjs`
  is hermetic too: it passes and exits without the suite preload and under any host identity.
- **Handoff "self" must be proven (TM-463 F2, EP-028).** `AO_AGENT_ID=<target>` alone passed as the
  target. `requireHandoffCaller` (now in `respawn.mjs`) requires `requireGranteeCaller` for self:
  the caller's pane is census-bound to the target and is the caller's ancestor process.
- **`mailbox wait` cannot probe ids (TM-465 F4, EP-028).** An unknown id and another sender's id
  now give the same `TOPOLOGY_SENDER_MISMATCH`.
- **MCP run-mail arguments cannot become flags (TM-464, EP-028).** The adapter passed `subject` and
  `task` as separate argv entries, so a subject of `--from-project=/x` parsed as a flag. Every value
  now goes to `ao-topology` as one `--key=value` token.

### Fixed

- **MCP mailbox tools use the SessionStart-minted identity (TM-466, EP-028).** The MCP server never
  sees `CLAUDE_ENV_FILE` exports, so a non-launcher session's `orchestration_mailbox_send` failed
  with `source_identity_required`. The adapter now reads the record SessionStart wrote for its
  `CLAUDE_CODE_SESSION_ID` (`<state>/sessions/<id>.json`, checked against that session id) on each
  call and supplies `AO_SESSION_AGENT_ID`/`AO_SESSION_CONSUMER`. A launcher identity still wins.

### Tests

- **Hermetic mailbox and MCP parity suites (TM-464, EP-028).** `topology-mailbox-send.test.mjs`
  and `mcp-parity.test.mjs` clear inherited `AO_AGENT_ID`, `AO_CONSUMER`, `AO_SESSION_*` and
  `CLAUDE_CODE_SESSION_ID`, use the file transport with `AO_NATS_AUTOSTART=0`, and close live
  transports, so they pass and exit inside an agent session and without the preload. The
  `register-file-transport.mjs` preload also scrubs `AO_SESSION_AGENT_ID`, `AO_SESSION_CONSUMER`
  and `CLAUDE_CODE_SESSION_ID`.
### Removed

- **The project-scope commit guard is gone (TM-392).** `~/.agents/AGENTS.md` lets a repository
  declare `agent-orchestration` and `task-management` under its own `.claude/settings.json`
  `enabledPlugins`, so this plugin no longer treats that as an error. Removed: the
  `PreToolUse(Bash)` hook (`scripts/guard-project-install.mjs`), which blocked any Bash call whose
  text matched "git" then "commit", heredoc bodies and quoted text included; the standalone
  `scripts/check-no-project-plugin-installs.mjs`; and the SessionStart warning from
  `src/services/project-scope.mjs`. `ao-topology git-hook install` now refuses with
  `TOPOLOGY_GIT_HOOK_RETIRED`; `status` and `uninstall` still find and remove a hook installed
  earlier. Such a hook resolves the deleted check script at commit time and exits 0 when it is
  missing, so it stops blocking once the plugin updates. This plugin edits no repository's
  settings file. The "Commit guard" and `git-hook` entries below are history.

### Added

- **Held standing mail rings an alive lead, and `task:<TM-id>` reaches its bound worker (TM-384,
  ADR-0041).** Mail held `leads_not_ready` for a destination lead whose record is alive is now,
  once it has survived one recovery backoff, rung into the lead pane through the safe bell probes
  use (`wakeForProbe`) with a pointer naming the message id and the `mailbox inbox` command. At
  most one ring per message per backoff window; the outcome (`rang`, `at`, or the refusal
  `reason`) is kept on the record as `lead_ring`. The ring never delivers: admission still waits
  for proven readiness. The address `task:<TM-id>` resolves to the worker the management record
  binds to that task (`record.worker`, written by `manage bind`), so a non-roster Codex worker
  receives task mail instead of `unknown_recipient`. Same-repo senders reach it directly;
  cross-repo senders reach it only when `delegationAllows` covers that task for that worker, and
  otherwise go to the lead as before. With no live bound worker, same-repo mail is held
  `task_worker_unbound` (retryable).

### Fixed

- **A late `manage admit` no longer hides the worker commits from review (TM-349).** Admission
  recorded `base_revision` as the task HEAD, so a task admitted after its worker had committed used
  that commit as the base: the review range left it out, and once the task merged its integration
  branch, `reviewer request` refused with `TOPOLOGY_REVIEWER_RANGE`. The base is now
  merge-base(HEAD, integration branch), using the branch TM-325 freezes into the admission record,
  else `management.target_branch`, else the repository default branch. A worker can rewrite any
  local ref, so the base comes from the server first: the tip of that branch on the pinned
  repository (`gh api repos/<repo>/branches/<branch>`, fetched from origin if absent), then
  merge-base(HEAD, tip), `base_source: server-tip`. This works while the task commits are still
  unpushed. Next is the TM-325 compare helper (`server`). Only when the server cannot answer does
  admission use local refs, taking the OLDEST merge-base across every resolvable candidate (`origin/<name>` and
  `<name>`; the task PR base counts only when it equals the recorded or target branch). The record
  and the start event carry `base_source`. A `local-fallback` base is only a floor: once the
  server can answer, the review range widens to the server merge-base when it is older, and never
  narrows. Candidates with unrelated histories are refused by name. A fresh worktree is unchanged,
  because there the merge-base is HEAD. Admission is refused with `TOPOLOGY_MANAGEMENT_BASE` only
  when nothing resolves; it never falls back to HEAD. A resumed
  admission recomputes the base and widens a record written by the old code (event
  `base-widened`); it never narrows one.

- **A governed task returns to work after an independent review requests changes (TM-347).** A
  finish report set the management record and the governed task to `ready-for-review`, and nothing
  set them back, so `tm dispatch` and `manage start-worker` refused every new worker with
  `TM_GOVERNED_ADMISSION_REQUIRED` and the task deadlocked. The new `manage rework --task TM-id`
  returns the task to `working` only when the latest review is `changes_requested` for the exact
  current finish revision and the finished worker is stopped. It records a `rework` event binding
  the findings to the reviewed revision, clears the finish and keeps owner, worktree, branch and
  base, then runs the new `tm rework`, which resets the governed state and archives the finished
  dispatch so the next worker can be dispatched. The next finish must name a new revision; the
  reviewed one is refused. Integration already keys reviews on the exact revision, and a new test
  proves an earlier verdict, even a later-dated approval of the old revision, never satisfies it.

- **`manage admit` no longer dead-ends on a task whose worktree is recorded but whose claim was
  released (TM-348).** Admission provisioned only when no worktree was recorded, so a task left with
  a worktree by an earlier `tm worktree new`, or parked or blocked since, skipped provisioning and
  was refused with `TOPOLOGY_MANAGEMENT_OWNERSHIP`. Admission, and a resumed admission, now run
  `tm worktree new` whenever no claim is held. That verb claims first and reuses the checkout, so the
  task is re-claimed by the admitting session. A claim held by another session is still refused, and
  an in-progress task with no admission record still returns `ownership-review-required`. The
  ownership refusal now names the session holding the claim (or `none`) and the expected owner.
  A released claim never lets another session take over a task that was already admitted: that
  returns `ownership-review-required`. A done or landed task is refused with
  `TOPOLOGY_MANAGEMENT_LANDED` instead of having its worktree and claim recreated.

## [0.16.0] — 2026-10-05

### Changed

- **Every standing agent keeps work moving without a person stepping in.** `prompts/common.md`
  gains a "Keep work moving: no stalled agents" section. Agents talk to each other through the
  mailbox within and across repositories, and terminal typing or a human relay is a filed defect.
  A problem in another component goes to its owner as a ticket plus a mailbox notice, followed by
  `plugin-rsync` once the fix lands. No agent ends a turn waiting on a person when a recommended
  option or a standing operator rule answers the question. Agents clear the stalls they find:
  stale tasks, dirty trees, paused pools, unadmitted ready tasks and silent workers. Rules stay
  general, and task-specific detail stays on the task. `roles/worker.md` now lets a worker
  message other agents through the mailbox about its own task, instead of forbidding all
  messages.

### Added

- **Workers inherit secrets named in config (TM-375, EP-028).** `workers.passEnv` in the AO config
  (repo or global layer) lists environment variable NAMES. When `launch` starts a run agent, when
  `failover` restarts one, and when `session open` starts a durable session, ao copies each named
  variable from the launching environment into a 0600 file beside the launcher. The launcher
  sources and deletes that file. Values never reach the launcher, `run.json`, the journal, events,
  prompts, tmux's environment or any argv. A name the launching environment lacks is warned about
  by name, and the launch continues. A session restored later from its record, or a failover run
  from a process without the variable, starts without it. This replaces running
  `tmux set-environment -g TYPESAFE_API_KEY` by hand.

- **`services wait` replaces sleep-polling around `services status` (TM-374, EP-028).**
  `agent-orchestration services wait --until healthy|<process> [running] [--timeout <s>]` re-reads
  status at a bounded interval and prints one JSON line: exit 0 when the condition holds, 2 on
  timeout (naming what is not running yet), 1 on a bad argument. `healthy` means process-compose
  answers and every managed process is Running and not "Not Ready". The common prompt and the
  setup skill now name `services wait` and `mailbox wait` and tell agents never to `sleep N`,
  which the harness blocks. The autonomy hook allows `services wait`, as it does `services status`.
- **The supervisor sweeps for unreviewed work (TM-361, EP-028).** When the repository has a tm
  launcher, each supervisor reconcile (at most every ten minutes, `AO_REVIEW_SWEEP_MS`) runs
  `tm review-sweep --apply --json`. Each fresh finding is delivered once: a governed task with a
  finish revision gets `requestReview`; anything else, or a refused request, becomes one standing
  notice to the lead, with an id derived from the finding so a retry never mails twice. The tick
  report carries `review_sweep`. With tm absent the tick skips it.

- **`manage assignment` reports a live bound worker (TM-360, EP-028).** Besides the idle-dispatch
  assignee, the result now carries `worker` (kind, backend, run) and `owner` while a worker this
  lead started or adopted is bound and not stopped. task-management's one duplicate-dispatch
  guard reads it through the CLI, so the pool no longer starts a second worker for a task a lead
  adopted with `manage bind --pane`. `manage start-worker` already runs `tm dispatch`, which now
  refuses a task the pool holds.
- **MCP parity for run mail, lead status and session handoff (TM-355, EP-028).** New tools
  `orchestration_run_mail_send`, `orchestration_run_mail_reply` and `orchestration_run_mail_wait`
  run `ao-topology send|reply|wait`, `orchestration_lead_status` reads the lead (`cached: true`
  answers from proof on disk and mints no probe), and `orchestration_session_handoff` runs
  `session handoff`. Send and reply act as the server's session identity (`AO_AGENT_ID`); a `from`
  or `agent` field may only repeat it. The provider-run tools are renamed
  `orchestration_run_followup` and `orchestration_run_wait`; `orchestration_send` and
  `orchestration_wait` remain as documented aliases. The closure-contract handoff of TM-311 is not
  on main and has no tool yet.

- **Agent identity is visible (TM-371, EP-028).** Sessions that ao creates now put the agent's
  icon, name and role on the tmux status line (`status-left`, session-scoped) ahead of the
  session name, matching the existing terminal title. Mailbox mail and replies published on NATS
  carry an `Orch-Repo-Slug` header naming the repository; subjects stay `orch.<key>.…`, so
  deployed peers are unaffected. `ao-topology doctor` prints `Repository: <slug> · NATS
  orch.<key>.>`, and `orchestration_doctor` reports `repositorySlug` and `natsSubjects` under
  `consumerAdmission`.

- **Doctor reports plugin freshness against origin/main (TM-373, EP-028).**
  `orchestration_doctor` now includes `diagnostics.pluginFreshness`: the installed SHA (the
  `plugins/cache/<marketplace>/<plugin>/<sha>` entry from `installed_plugins.json`, or `HEAD` for a
  checkout), `origin/main` from `git ls-remote` with a 5-second deadline, and `status`
  `current`, `stale` or `unknown`. A stale cache adds a setup problem naming
  `claude plugin update <plugin>@<marketplace>`. Offline or timed out reports `unknown` and never
  fails doctor.
- **Reviewer verdicts travel as JSON and are never read off the pane (TM-365, EP-028).**
  `TOPOLOGY_REVIEWER_RESPONSE` ("Expected a nonce-bound review response", "Review response must
  be JSON") was the most common gateway error. The reviewer now submits its verdict with a
  `review_submit` MCP tool, served by the new `topology/review-mcp.mjs`, or from a shell with
  `ao-topology review submit <request-nonce> --verdict approve|changes_requested|blocked
  --findings @file.json`. Both run `submitReviewVerdict`. It checks the caller is the request's
  reviewer at the request's incarnation, and applies the findings schema at once, so a refusal
  says what to fix and the reviewer can submit again. Resubmitting before collection replaces the
  verdict. It writes `<inbox>/verdicts/<task>-<revision>.json` and mirrors it to the NATS
  `ORCH_REVIEWS` object store and the verdict subject when NATS is live. `reviewer collect` and
  the supervisor's queue read only that record, and report `TOPOLOGY_REVIEWER_NO_VERDICT` while
  none exists. The pane parser (`parseReviewResponse`, `reviewResponsesOnScreen`, the incomplete
  verdict ageing and `AO_REVIEW_INCOMPLETE_*_MS`) is removed. A submitted verdict survives a
  reviewer restart: `agent restart` no longer waits on it, and collection records it against the
  incarnation that submitted it. Approval still needs the current incarnation, as before.
  The reviewer now launches with `--restricted --setting-sources ''` in place of
  `--restricted --safe-mode`, because safe mode also disables every MCP server. We measured both
  on claude 2.1.289: the tool lists are the same (no Bash, Write or Edit) except for
  `review_submit`, and no settings, plugins or hooks load. The reviewer prompts now name the tool.
  `dist/` is rebuilt.

### Fixed

- **The reviewer reviews the worker's worktree, not the main checkout (TM-366, EP-028).** The
  review range, the patch, the binary manifest and the files a finding may name now resolve from
  the task worktree in the admission record. The request records that `worktree`, and the reviewer
  prompt and request ring tell the reviewer to read files there; the main checkout may have another
  branch checked out. A worktree that has been removed falls back to the consumer, which shares the
  object store. A worktree of another repository is refused with `TOPOLOGY_REVIEWER_RANGE`.
- **A reviewer finding may name a CHANGELOG.md the change did not touch (TM-367, EP-028).** A
  missing changelog entry is a finding about a file outside the diff, and refusing it with
  `TOPOLOGY_REVIEWER_FINDINGS` failed the whole review (gateway TM-490). A `CHANGELOG.md` at any
  depth is now accepted; any other file outside the diff is still refused. Every finding still
  carries one severity (`blocker`, `major`, `minor`, `nit` or `note`), and an approval with only
  minor, nit or note findings is recorded as approved; a new test covers both. The reviewer prompt
  says so.
- **`reviewer ensure` honours the requested provider and reuses the reviewer it has (TM-364,
  EP-028).** In agent-browser on 2026-10-05 a Codex reviewer was requested and three Claude
  reviewers were created. `ao-topology reviewer ensure --provider codex` (and
  `role ensure reviewer --provider codex`) now reuses the registered Codex reviewer. A request for
  another provider than the registered one is refused with `TOPOLOGY_REVIEWER_PROVIDER` and names
  the `--provider` that keeps it; nothing is minted. With no registration, ensure first looks at
  the repository's reviewer agents. It reattaches a live one on the requested provider, relaunches
  a stopped one as the same identity, and refuses with `TOPOLOGY_REVIEWER_LIVE` while a reviewer on
  another provider is live. A new reviewer is minted only when none exists on that provider. The
  requested provider must still be in `management.reviewer_providers`.

- **Lead and worker autonomy ships with the plugin (TM-369, EP-028).** A new `PreToolUse(Bash)`
  hook, `scripts/autonomy-allow.mjs`, returns `permissionDecision: "allow"` for routine
  orchestration commands. These are `ao-topology` verbs, `agent-orchestration`
  doctor/status/session-open/services status, `tm`, and read-only `tmux`
  (`capture-pane`, `list-panes`, `display-message -p` and similar). Leads can therefore spawn
  workers, file tasks and read panes with no prompt, no classifier round and no global rule edits.
  A plugin cannot ship permission allow rules, so this hook is the mechanism. We verified it live
  on Claude Code 2.1.289 in `default` and `auto` modes. It approves only a single simple command.
  It never approves `manage integrate|record-landing|cleanup`, `delegate grant|revoke`,
  `permissions`, or any `git`, `gh`, deploy or secrets command. It never blocks, and the user's
  `deny` and `ask` rules still apply. The README section "Lead and worker autonomy" documents it.

- **`mailbox wait` blocks on a standing message's reply (TM-352, EP-028).**
  `ao-topology mailbox wait <id> [--timeout 20m] [--poll 2s]` prints the reply as JSON and exits 0.
  A timeout prints `ok: false` with code `TOPOLOGY_MAILBOX_WAIT_TIMEOUT`, names the message and
  exits 2; a permanently held message returns at once as `TOPOLOGY_MESSAGE_UNDELIVERABLE`; an
  unknown id is the error `TOPOLOGY_MESSAGE_NOT_FOUND` (exit 1), never `ok: true`. The new MCP tool
  `orchestration_mailbox_wait` does the same within 55 seconds and reports a timeout as a tool
  error. It polls; a KV watch is TM-311. `dist/` is rebuilt so the shipped MCP lists the tool.
- **Standing mail rings its recipient on arrival (TM-351, EP-028).** Each supervisor tick rings
  the pane of every agent whose standing mail was delivered, through `ringMessage`, so an idle
  agent no longer has to poll `mailbox inbox`. The ring is a pointer naming the message id and the
  exact `ao-topology mailbox inbox --consumer <repo> --agent <id>` command, never the body. An
  unsafe composer, a missing pane or an adapter with no measured composer holds the ring, and the
  next tick retries it; nothing is ever typed into a non-empty composer. A marker under
  `standing-mailbox/rings/` makes the ring once per message across ticks and restarts, mail the
  agent already read or answered is never rung, and each agent gets at most one ring per tick. The
  tick report lists the outcomes under `mail_rings`.
- **Address a repository's lead by path or slug (TM-271, EP-028).** `mailbox send --to-repo
  <path|slug>` and `--to lead@<path|slug>` resolve the repository against the registered
  repositories (`services/repos.json` and every lead registration) and send to its registered
  lead. `send` accepts the same forms and hands them to `mailbox send`, so both entries share one
  resolver (`resolveStandingTargets` in `addressing.mjs`) and no run is needed. An unknown or
  ambiguous name and a repository with no lead are refused (`TOPOLOGY_REPO_UNKNOWN`,
  `TOPOLOGY_REPO_AMBIGUOUS`, `TOPOLOGY_REPO_NO_LEAD`), exit 1, nothing written.
- **`@all-leads` broadcast for standing mail (TM-372, EP-028).** `mailbox send --to @all-leads`
  (and `send --to @all-leads`) sends one ordinary standing message to every registered
  repository's lead, each admitted on its own. It honours the broadcast rules in `addressing.mjs`:
  the sender is never its own recipient, an audience that reaches nobody is refused, and more than
  24 recipients (`--max-recipients`) is refused, never truncated. A given `--id` becomes one id per
  repository, so a retried broadcast dedupes per recipient.
- **Every session gets an AO identity (TM-353, EP-028).** A plugin SessionStart hook
  (`topology/session-hook.mjs`) mints an 8-character id for any session a launcher did not start,
  records it under `<state>/sessions/`, and exports `AO_SESSION_AGENT_ID` / `AO_SESSION_CONSUMER`
  through `CLAUDE_ENV_FILE`. A bare `ao-topology mailbox send` now uses it as the sender instead of
  holding the mail as `source_identity_required`. It never sets `AO_AGENT_ID`, so a lead named by
  its census binding keeps its name. `callerIdentity()` in `topology/lib/session-identity.mjs` is
  the one shared answer to "who is sending".
- **Recipients outside the agent library resolve through presence (TM-353, EP-028).** Standing
  mail to a name the library does not know, from the same repository, now resolves to a live
  presence entry (a Codex pane, by agent id or session name) or to a minted session identity
  before it is held as `unknown_recipient`. The library still wins.
- **`lead status --cached`: a non-blocking lead read (TM-209, EP-028).** It answers from proof
  already on disk, mints no probe, rings nothing and returns in under a second. Every `lead status`
  result now carries `verdict_source` (`cached`, `late`, `probe`, or `none`) and `proof_age_ms`.
  Plain `lead status` still rings the lead and waits up to `--ack-timeout` (default 30s) when no
  proof is stored; the CLI help says so.
- **A lead mid-turn reads as responsive and busy, not unresponsive (TM-222, EP-021, EP-028).** The
  plugin's `UserPromptSubmit`, `PostToolUse` and `Stop` hooks write a heartbeat for their tmux pane
  (`topology/lib/heartbeat.mjs`), with no model turn involved. A heartbeat from the lead's exact
  binding (socket, server pid, pane id, and the pane pid among the hook's ancestors) that is younger
  than `AO_LEAD_HEARTBEAT_TTL_MS` (default 5 minutes) proves the lead alive. `leadState` then
  reports `responsive` with `verdict_source: "heartbeat"` and `busy`, and the pane is not rung. A
  dead pane, a respawned pane, another pane's heartbeat or a stale one still reads as before, and
  the nonce probe remains the proof when no heartbeat exists. Outside tmux the hook writes nothing.
- **Held `no_lead` mail launches the destination's lead (TM-354, EP-028).** A `leads_not_ready`
  hold already asked each side's own supervisor to recover its lead (TM-167). A `no_lead` hold now
  does the same for the destination only, so the supervisor creates the missing lead through
  `recoverLead` / `ensureLead`, under the registration lock. Tests cover the whole path: two held
  messages, six racing supervisor ticks, one lead launched, and both messages delivered to that
  lead once it is proven ready.

- **Prompt and configuration settings verbs (TM-296).** `config get|set|validate` read and write
  one configuration layer's raw document with a sha256 revision; `set` validates before writing,
  refuses a stale `--if-revision` and writes atomically. `prompt preview` takes `--agent` or
  `--role` and returns the composed text and its sources. A global-only `prompts.prefix` composes
  before everything and joins the revision. Every prompt entry may be `{ file|text, mode }`, where
  `replace` drops the same slot from wider layers; plain-string configs compose byte-identically.
  `agent set-instructions <id> (--file|--text) [--mode append|replace]` sets an agent's own
  instructions; `--file` is stored relative to the agent directory and refused outside the
  repository. A `replace` keeps role protocol — the lead/reviewer template and the bundled
  `common_by_role` variant — and reports the kept layer in `warnings`.

### Fixed

- **NATS outage follow-ups: recovery no longer overclaims, and state writes are locked and visible
  (TM-309, EP-028).**
  - An outage now records which processes fell back from it (`holders`, by pid). An open that
    reaches the configured server again marks it `reachable_at`, but the outage closes, and the lead
    gets its one recovery message, only when no live holder remains. A holder's heartbeat re-dials
    once another process has proven the server back.
  - Recovery is recorded only after `jetstreamManager()` succeeds. A server that takes the
    connection but has no JetStream no longer closes an outage.
  - The supervisor's re-dial probe is a real NATS connection plus a JetStream call on a short-lived
    connection of its own. A port that only accepts TCP no longer force-closes the supervisor's
    live connections, presence included.
  - Every read-modify-write of `transport.json` runs under one lock (`withLock`). A failed write is
    no longer swallowed: it is carried as `state_write_error` on the selection, logged by the
    supervisor start line, and fails the outage tick with its reason.
  - The supervisor start log reports the connection it just opened, not the host-wide file.
  - Text `agent-orchestration services status` prints the transport and any open outage.
  - Tests prove that no credential from a single, list or malformed `AO_NATS_URL` reaches
    `transport.json`, doctor, services status, the start log or the lead's inbox.

- **The commit guard allows the plugin declaration that AGENTS.md requires (TM-370, EP-028).**
  `guard-project-install`, the `git-hook` pre-commit hook and the SessionStart warning blocked
  every commit in a repository whose `.claude/settings.json` enabled `task-management@bytedesk`,
  even when it followed the `~/.agents/AGENTS.md` rule to register the marketplace by relative
  path and declare `enabledPlugins`. That form now passes. Still blocked, as per-project
  installs: an enabled plugin whose `bytedesk` marketplace the repository does not register
  (what `claude plugin install --scope project` writes), a `bytedesk` marketplace registered by
  absolute or `~` path, and a plugin cache committed under `.claude/plugins/`. Each refusal names
  the problem, the exact fix and the AGENTS.md rule.
- **System notices are sent as the supervisor and reach the inbox (TM-314, EP-028).** Slot-grant
  notices, quota incident and failover notices, and failed-review escalations were sent with no
  sender, so every one was held permanently as `source_identity_required`. They are now sent as
  `ao-supervisor` from the repository itself, like the NATS outage notice, under `v2` message ids
  so the old held records do not raise `TOPOLOGY_MESSAGE_ID_CONFLICT`. `notifyGrants` reports a
  held grant with its reason. Every `sendStandingMessage` caller was audited for a sender.
- **`mailbox send --dry-run` previews instead of sending (TM-278, EP-028).** The flag was ignored
  and a real envelope was queued. A dry run now validates, resolves and routes, and prints the
  would-be envelope, the destination repository and its lead, and `would: deliver` with the
  recipient or `would: hold` with the reason. It writes, publishes, rings and recovers nothing.
  Every other send verb (`mailbox forward|reply|dispose|…`, `send`, `reply`) refuses the flag with
  `TOPOLOGY_DRY_RUN_UNSUPPORTED` instead of ignoring it.
- **The standing-mail sender is the session's identity, not a claim (TM-356, EP-028).**
  `mailbox send`, `mailbox forward` and the MCP `orchestration_mailbox_send` took `from` from
  `--from`, `AO_AGENT_ID` or the tool's `from` field, so any caller could send as any agent. The
  sender is now the launcher's `AO_AGENT_ID` and `AO_CONSUMER`, the proof standing replies already
  require (`sessionIdentity` in `standing-mailbox.mjs`). An explicit `--from`, `--from-project`,
  `from` or `consumerCwd` that differs is refused with `TOPOLOGY_SENDER_MISMATCH`. MCP
  `orchestration_mailbox_receive` and `orchestration_mailbox_dispose` act only for that identity,
  and their `agent` field (like `from`) is now optional. A session with no identity is refused
  with `TOPOLOGY_SOURCE_IDENTITY_REQUIRED`, naming what is missing, before anything is written.
  The `dist/` bundles are rebuilt.

- **A task branch that merges its integration branch is reviewed and scoped over its own files
  (TM-325).** The effective review base asked the server for the merge-base with the default
  branch only, so a branch that merged its PR base (for example `fix/ao-local-nats-autostart`)
  kept the admission base: the review range carried every other task merged there, and
  `manage eligible` refused with "implementation changed files outside the approved task scope".
  The base is now resolved against the task's integration branch, for both the review range and
  the scope check. `manage` admission freezes tm's `integrationBranch` into the producer-owned
  admission record (`integration_branch`), and the range reads it from there, never from the
  mutable task file, so a later task-file edit cannot move the range. When the server names the
  task PR's base, it must agree with the recorded branch or the range is refused. With none
  recorded (or `HEAD`), the default branch is used as before. The merge-base must still lie
  between the admitted base and the revision; an integration branch that is not a plain branch
  name keeps the wider admitted range with a note. Once a landed task's integration branch has
  been merged and deleted, the range falls back to the effective base recorded on the review
  request (still checked to lie between admission and revision), not to the admitted base, so
  re-checking a landed task is not refused for scope.
- **An operator shell carrying `CODEX_BIN` is no longer an agent session (TM-304).** The
  managed-session test matched every `CODEX_*` name, so `CODEX_BIN=codex` — exported by the
  remote gateway's `cli run-gateway` and inherited into tmux's global environment by the server it
  starts — refused `record-landing --authorized` and `delegate grant` from every plain pane with
  `TOPOLOGY_MANAGEMENT_SELF_ASSERT`. Prefixed names ending `_BIN`, `_HOME` or `_PATH` now count as
  configuration; session ids (`CODEX_THREAD_ID`, `CLAUDE_CODE_SESSION_ID`, …), the explicit markers
  and the agent-ancestor check still refuse.
- **`agent restart` applies a staged prompt to the reviewer (TM-302).** It refused every reviewer
  with `TOPOLOGY_REVIEWER_READ_ONLY`, and `reviewer ensure` leaves a live reviewer alone, so a
  reviewer's staged prompt could never be applied and `agent list` showed it `restart_required`
  forever. A reviewer restart now refuses `TOPOLOGY_AGENT_BUSY` (naming each pending nonce) while a
  review request to its current incarnation is in flight — not collected, not failed, and with no
  terminal collection outcome (a verdict still printing, `TOPOLOGY_REVIEWER_RESPONSE_INCOMPLETE`,
  still blocks; a request withdrawn as `TOPOLOGY_REVIEWER_RANGE`, or bound to an
  earlier incarnation, does not block) — waits out its turn, marks the reviewer record `restarting`
  (so `reviewer request` is refused `TOPOLOGY_REVIEWER_RESTARTING` until the relaunch clears it), ends
  the exact managed pane and relaunches the same identity through the existing read-only launch on the current prompt.
  `--mode resume` and `--mode handoff` are both a fresh read-only launch for a reviewer — it keeps no
  state and cannot write a handoff — and the result says so (`fallback: "fresh"`). The read-only
  launch itself is unchanged.
- **A task worktree can no longer capture the services pointer (TM-305).** `services ensure` from a
  linked git worktree (under `.bytedesk/worktrees`, `.claude/worktrees`, or any checkout whose `.git`
  file names `…/worktrees/<name>`) keeps the current root even for an identical or newer build, and
  refuses with `AO_SERVICES_WORKTREE_ROOT` when there is none; a pointer already naming a worktree
  moves back at the next ensure from the installed plugin or source checkout. `services ensure`,
  `restart` and `stop` refuse inside a dispatched worker (`TM_DISPATCH_WORKER`); the SessionStart
  `ensure --detach` is a silent no-op there.

- **Self-heal refreshes a host copy on an older build at the same version (TM-299).** The host-copy
  sync compared versions only, so a Grok or Codex copy at the services' version but on an older build
  was reported "same version, different build" and never refreshed. It now compares the build
  fingerprint `services ensure` uses and refreshes that copy, unless the copy is the newer build, so
  a newer build is never downgraded. A fingerprint has no order, so each refresh writes
  `.ao-build.json` (`{fingerprint, ordinal, source}`) into the copy, the ordinal being the source's
  commit time read at sync time (the newest mtime under `dist/` outside git); same-version copies are
  ordered by it. A copy without the file, or whose file names another build, falls back to bundle
  mtime, which refreshed copies preserve; an equal ordinal is left alone. `dist/` carries no ordinal,
  so builds stay byte-identical for the same source.

- **Tests can no longer reach the managed services, and a run fails if it leaves tmux or processes
  behind (TM-298).** The contract suite never set `AGENT_ORCHESTRATION_SERVICES=0`, so `launch` in
  an enrolled temp repository registered it with process-compose, which re-ran `supervise` with a
  scrubbed environment: no `TMUX_TMPDIR`, so the operator's default tmux server, and no provider-shim
  `PATH`, so a real provider lead. The shared test preflight now forces the opt-out for both suites,
  and `topology-tmux` and `topology-activation-tmux` pin it in their own child environments, because
  CI runs the contract files without the preflight. A new suite-end check
  (`tests/helpers/suite-leaks.mjs`) makes the run exit non-zero when it leaves a process carrying the
  run's environment, or a new temp-directory session on an operator tmux server, and names each
  leaked process and session. It found lead tmux servers left by `topology-repo-enrollment`,
  `topology-supervision`, `topology-activation-tmux` and `topology-lead-recovery-tmux`: their
  teardowns reaped the supervisor but not the server its lead ran on, or found that server by a
  discovery that returned nothing on failure. They now use one helper, `killEnvServer`, which also
  reaps a server orphaned when two supervisors start the first session on a fresh socket at once.
  `topology-tmux` asserts that its delivery runs' supervisors resolve only the test's own socket.

- **Review verdict decoding and outage retirement tighten three edges (TM-295).** A pane captured
  just after `AO_REVIEW <nonce> b64:` was printed (an empty or sub-4-character payload) now waits as
  `RESPONSE_INCOMPLETE` instead of failing the request. A complete `b64:` verdict no longer absorbs a
  following indented row made of base64 characters (a one-word line printed after it). Every process
  holding a NATS fallback, not only a repository supervisor, refreshes its outage's
  `last_fallback_at` from a transport heartbeat, so a long-lived MCP server on the fallback does not
  see its outage retired and then mint a second outage mail.

### Changed

- **A re-spawn also waits out typed, unsent input (TM-297).** The turn-end wait treats a composer
  that is not empty as busy, for any adapter that declares `composer.empty_pattern`, so neither
  `agent restart` nor a `launch`/`session open` re-spawn types over text someone is writing.
  A `resume` restart that falls back to handoff passes the collected handoff to the successor;
  a resumed restart with `--pass-handoff` reports `handoff: null` rather than failing. `agent list
  --json` asks tmux once for the whole roster, not twice per agent.

- **The NATS transport names itself, and an unreachable configured NATS is reported to the lead
  (TM-276, ADR-0031).** A dead ambient `NATS_URL` or stale gateway `orch.sock` still falls back to
  the managed local server, but the selection, its source (`AO_NATS_URL`, `NATS_URL`, `orch.sock`,
  `managed-local`) and any outage are recorded in `<state>/transport.json`. `supervise` logs a
  `transport-selected` or `transport-fallback` event at start and on every change; `services status`
  and `doctor` show `transport`, and `doctor` raises `NATS_CONFIGURED_UNREACHABLE`. Each repository
  supervisor mails its lead one durable standing message per outage and one on recovery. An explicit
  `AO_NATS_URL` is still never replaced. Only an open that dialled the outage's own source and url without
  falling back closes it, so another process's env cannot fake a recovery; the selection is recorded
  under the caller's `home`; and a configured server that accepts TCP but refuses NATS is re-dialled
  with a per-outage backoff (30 s doubling to 15 min) instead of on every reconcile. Every fallback
  records `last_fallback_at`; once nothing on the host has fallen back from that source and url for
  an hour (`AO_NATS_OUTAGE_RETIRE_MS`), the outage is retired (`retired: true` and a note, never
  claimed reachable), so removing the dead `NATS_URL` clears `doctor`, stops the re-dials, and the
  lead gets one `NATS retired` message in place of the recovery message.

### Added

- **`agent restart --mode handoff|resume` applies a changed prompt to a running agent (TM-297,
  EP-003 C4).** One verb, for standing roles and library agents, that the gateway settings UI calls.
  Both modes reuse the TM-280 re-spawn: the turn is waited out, the old session ends once, and the
  successor starts under the same name on the promoted prompt. `handoff` passes the predecessor's
  handoff to it; `resume` relaunches with the adapter's new `resume_args` (Claude:
  `--resume <session-id>`, from the newest transcript in the agent's own directory) and, where that
  is not possible, falls back to `handoff` with `"fallback": "handoff"` and the reason. The result
  names the old and new session, incarnation, prompt revision and mode used. `agent list --json` now
  reports `applied_revision`, `desired_revision`, `prompt_status` and `restart_required` per agent.

- Durable NATS mailbox obligations, sender publication recovery and explicit recipient dispositions. Broker acknowledgment follows local durable acceptance; console inspection does not consume messages.
- A bounded, persistent original-goal feedback controller with PM, build, independent QA/review, governed integration, approved test deployment, dogfood and assessment phases. Task Management owns proof; limits and human decisions survive restart.
- Public mailbox and goal-loop CLI/MCP contracts and a third workflow-index runtime for Gateway, including revision-bound operator controls and retained message receipt diagnostics.

## [0.15.4] — 2026-10-02

### Fixed

- **A `NATS_URL` outage left by an older ao no longer shows up (TM-308 follow-up, ADR-0032).**
  `transport.json` is shared by every ao process on the host, and the last writer wins. A
  long-lived process still running pre-0.15.3 code with `NATS_URL` in its env kept writing a
  `NATS_URL` fallback and outage, so `doctor` went on reporting `NATS_CONFIGURED_UNREACHABLE` after
  the upgrade. `readTransportState` now drops any selection, fallback or outage whose source is not
  an ao source (`AO_NATS_URL`, `orch.sock`, `managed-local`). That covers `describeTransport`,
  `doctor`, the setup doctor, `services status` and `natsOutageTick`. The next transport open, or the
  next supervisor tick, rewrites the file without the entry, and readers ignore it if an old writer
  puts it back.

### Tests

- `tests/unit/nats-port.test.mjs` seeds the exact record found live. `doctor` reports no `NATS_*`
  problem, `services status` shows no outage, the tick sends nothing, and a managed open rewrites
  the file without `NATS_URL`. Turning the filter off fails the test.

## [0.15.3] — 2026-10-02

### Changed

- **Managed NATS runs on a fixed port from the user config (TM-308, ADR-0032).** The port is
  `nats.port` in `$XDG_CONFIG_HOME/agent-orchestration/config.json`, validated as an integer from
  1024 to 65535. The first managed start adopts the port `nats/state.json` already records when it is
  free (or is ao's own server), else picks the first free port in 45200–45999, and writes it. Every
  later start uses exactly that port, through `ensureLocalNats` and through the process-compose
  project (`prepareLocalNats` writes it into `nats-server.conf`), so restarts and reboots keep it.
  Credentials stay in `state.json` (0600).
- **A taken port is refused, not moved.** If another process holds `nats.port`, the start fails with
  `TOPOLOGY_NATS_PORT_CONFLICT`, naming the port and, on Linux, the holder (`/proc/net/tcp` → socket
  inode → pid and command). The conflict is recorded through the ADR-0031 outage path, so `doctor`
  reports `NATS_PORT_CONFLICT`, the setup doctor lists it, the repository lead gets one
  `NATS port conflict` mail (no re-dial), and the next successful managed start closes it.
  `services status --json` now shows `nats.port`, `nats.url` and a live `nats.conflict`;
  `services ensure` reports `natsError` instead of silently leaving NATS out.
- **The generic `NATS_URL` is not an ao source.** Sources are `AO_NATS_URL`, then the gateway
  `orch.sock`, then managed NATS on `nats.port`. `NATS_URL`, `NATS_USER` and `NATS_PASSWORD` are
  ignored, and the supervisor logs one `nats-env-ignored` event at start. A down port-forward behind
  `NATS_URL` no longer causes a fallback warning or an outage report. An unreachable `AO_NATS_URL`
  now falls back to managed NATS and is reported to the lead, as ADR-0031 decided (it used to fail
  outright); `AO_NATS_AUTOSTART=0` still makes it fail.

### Fixed

- **NATS outage and recovery notices now reach the lead (TM-309 C1).** `natsOutageTick` sent them
  with no `from`/`fromProject`, so the standing mailbox held every one permanently as
  `source_identity_required`; every such record on the authoring machine was held, never delivered.
  They now come from `ao-supervisor` in the same repository, which admission routes to the lead. A
  record counts as sent only when its status is `delivered`: a held one is reported on the
  supervisor tick (`nats_outage.status` and `reason`) and retried by the mailbox, and a recovery is
  sent only after its outage was delivered. Message ids moved to a `v2` derivation so an old held
  record under the same id cannot refuse the new envelope.
- **`redactUrl` fails closed (TM-309 A1).** A comma-separated server list or a URL `new URL()`
  rejects used to come back raw, leaking `user:secret` into `transport.json`, logs, doctor, `services
  status` and the lead's mail. Each server in a list is now redacted, and anything still holding an
  `@` loses its userinfo to `[redacted]`.

### Tests

- `tests/unit/nats-outage.test.mjs` gives the test repository a real library lead and reads that
  lead's inbox over the real transport: exactly one outage and one recovery arrive, each `delivered`.
  Removing the sender again fails three tests with `source_identity_required`. New `redactUrl`
  cases cover lists and malformed forms; the old raw-return behaviour fails them.
- `tests/unit/nats-port.test.mjs`: the first start writes `nats.port` in 45200–45999 and a second
  start and two process-compose re-renders reuse it; a port held by a test listener is refused with
  the holder's pid, starts nothing, shows in `doctor` and `services status`, and mails the lead
  through `natsOutageTick` with an injected deliver; an unreachable `NATS_URL` gives managed NATS
  with no fallback and no outage; migration adopts a free `state.json` port and skips a held or
  sub-1024 one; validation rejects 80, 70000 and `"abc"`. `nats-outage.test.mjs` now drives the
  ADR-0031 path with `AO_NATS_URL`.

## [0.15.2] — 2026-10-02

### Fixed

- **A process killed mid-acquire can no longer wedge a lock (TM-307).** Outage 2026-10-02
  16:12–21:40: a `kill -9` of process-compose took every supervisor down between `withLock`'s
  `mkdir(lockPath)` and its `owner.json` write, leaving `presence/.publish.lock` as an empty
  directory. Unknown ownership fails closed, so nobody reclaimed it and each repository supervisor
  hit `TOPOLOGY_LOCK_TIMEOUT` and was restarted about 606 times. Admission now writes the owner
  record into a private `<lock>.pending-*` sibling and renames it onto the lock path, so a lock only
  ever appears already owned. A legacy empty lock directory is replaced by that rename (POSIX); on
  win32, which cannot rename onto an existing directory, an empty lock is removed with `rmdir`,
  which refuses a populated one. Stale `.pending-*` and `.retired-*` siblings are swept on
  contention.
- **A remover killed mid-release can no longer wedge a lock (TM-307).** The `.remove` gate inside a
  generation was a bare `mkdir`; a SIGKILL after it blocked every later reclaim of that generation.
  Gates are now admitted the same way as locks, and a gate whose holder is dead is never deleted:
  the next remover takes the gate named after the dead holder's token. A holder whose release meets
  a reclaimer's transient gate retries instead of leaking its lock for the life of the process.

### Tests

- Step hooks (`hooks.step`) stop an acquirer at every admission step; real child processes are
  SIGKILLed at each step and at random points of a tight acquire loop; four processes contend for
  one lock across 300 critical sections with an exclusive-create overlap detector.

## [0.15.1] — 2026-10-02

### Fixed

- **process-compose no longer restarts a supervisor that stopped on purpose (TM-289).** Every `supervise-<repo>` process ran under `restart: always`, so a supervisor that retired because its repository was removed, or that lost the per-repo lock to another supervisor, was restarted every 3 seconds forever. Supervisors now run under `restart: on_failure` (backoff 3 s, unlimited retries), and `ao-topology supervise` exits with a code that says what happened, named in `SUPERVISE_EXIT` (`topology/lib/supervision.mjs`):
  - **0, retired:** the repository is gone. The process is not restarted, the repository is removed from `<state root>/services/repos.json` (new `removeServiceRepo`, beside `addServiceRepo`), and under process-compose the supervisor runs `services ensure` so the project reloads without it.
  - **75, try later (`EX_TEMPFAIL`):** another supervisor holds the lock. process-compose retries it with backoff, and the retry takes over once the holder ends. It was 0 before, which under `on_failure` would have left the repository unsupervised after the winner died.
  - **Any other non-zero code:** a crash, retried as before.
  The session host and NATS stay on `restart: always`.

### Tests

- `tests/unit/topology-supervise-exit.test.mjs` runs the real `ao-topology supervise` as a child process: removing the repository makes it exit 0 within seconds and deregisters it (this is also the CLI-level test TM-186 lacked: retirement stops the watcher, so the process really exits); holding the lock makes a second supervisor exit 75, and a start after the lock is released takes over; an unexpected error exits with another non-zero code. `tests/unit/services.test.mjs` checks the rendered restart policies, and runs the pinned process-compose binary to show that a child exiting 0 is not restarted and a child exiting 75 is.

## [0.15.0] — 2026-10-02

### Added

- **`services restart <name>` and `services stop <name>` (TM-286).** They act on exactly one managed process through the process-compose API, by its process-compose name; an unknown name is refused before any request is sent, and `restart` reports the old and new pid. `services status --json` rows are now `{ name, pid, state, restarts, ready, exitCode }` (`status` is renamed `state`). README and the setup skill tell agents to use these verbs and never `pkill`/`pgrep` a managed process: dev machines run unrelated `nats-server` processes (microk8s), and a pattern match killed the wrong one by luck only.
- **Every host runs the same ao build (TM-284).** `services ensure` and `install-orchestration-host` find this plugin's Codex copy, Grok install and the root Kimi's `mcp.json` names, and replace any OLDER copy with the services' plugin root; an equal or newer copy is left alone. The new copy is built beside the old one and swapped in by rename, keeping the copy's `node_modules`, so a failure leaves the old copy whole. It is refused when the source has uncommitted changes, when the copy lies inside a git checkout, and when the copy's `node_modules` does not satisfy the new `package.json`. Node's `cp`, not rsync, so native Windows works too. With everything current it is an identity compare only.
- **Setup cleans up after earlier installs and reports stale sessions (TM-285).** `services ensure` stops leaked `agent-orchestration-session-*.scope` units whose state root is gone, hands the managed state root over from a pre-services session host (its 24-hour scope, or a hand-run host verified through `/proc`), and never touches a scope whose state root exists and is not the managed one. It lists ao MCP servers still running an older build (lower version, a replaced bundle, or a deleted plugin root) by host and pid with the advice to restart that session, and never signals them. The result is printed, kept in `<state root>/services/self-heal.json` and shown by `services status --json`; `orchestration_doctor` reports stale servers and a `TMUX_TMPDIR` whose tmux socket path exceeds the unix-socket limit under `diagnostics.setup`. The SessionStart hook warns, with the exact fix, when the repository enables `agent-orchestration` or `task-management` at project scope — the commit guard's own predicate, now shared from `src/services/project-scope.mjs`.

### Changed

- `services status --json` process rows are `{name, pid, state, restarts, ready, exitCode}`; the per-process field formerly named `status` is now `state` (TM-286).

## [0.14.0] — 2026-10-02

### Added

- **Team personas are unique across nodes, through NATS KV (TM-279, ADR-0030 part 3).** `natsPersonaRegistry` implements the persona registry interface (`allocate` / `release` / `holder`) on one JetStream KV bucket, `ORCH_PERSONAS`, keyed `<scope>.<persona>` (for example `team_core.ada`). Each value is `{ holder, sessionId, node, repo, presence, allocatedAt }`. Allocation is an atomic KV `create` over the same candidate order as the local registry: first name, then `first-last`, then the holder's id. A persona the holder already holds is returned as is. `release` deletes only at the revision it read, so it never frees a persona that someone else reclaimed in between.
- **A dead holder is reclaimed; a live one never is.** A taken persona is reclaimed only when its holder is past the two-minute grace period AND is not live in presence. Not live means that the allocating repository's presence entry is missing, older than its `staleAfterMs` plus clock skew, or does not list the holder (the agent, or a member of the holder's run). Reclaim is a revision-checked `update`, so when two nodes reclaim the same persona, exactly one wins. A record that has no presence key cannot be judged, so it is kept.
- **Registry selection, `personaRegistryFor(scope)`.** `planSession` and `releaseRunPersona` use it when no registry is passed in. A repo scope always uses the local file-lock registry. A team scope uses the NATS registry. If NATS is unreachable, a team allocation fails with `TOPOLOGY_PERSONA_REGISTRY_UNAVAILABLE`, and the message names the team. It never falls back to the local registry, because two nodes could then take the same persona. `AO_TRANSPORT=file`, the explicit single-host double, keeps the local registry for teams.
- **Leaf nodes: `AO_NATS_JS_DOMAIN`, or `nats.domain` in the ao user config.** The value is validated as 1–64 letters, digits, hyphens or underscores. It sets the JetStream domain for the transport's whole js context. The hub hosts `ORCH_PERSONAS`. A leaf whose own server runs JetStream names the hub's domain to reach that bucket. A leaf with no JetStream of its own, and a single server, need no domain.
- **Re-spawning a live agent collects a handoff and replaces the session (TM-280, ADR-0030 part 4).** Spawning (`launch`) or opening (`session open`) a library agent that is already live in another session no longer fails with `TOPOLOGY_AGENT_ALREADY_LIVE`. Instead, ao takes these steps, implemented in the new `topology/lib/respawn.mjs`:
  1. It waits, bounded, for the agent's current turn to end and never types into it mid-turn. The default bound is 10m (`--turn-timeout`, `AO_RESPAWN_TURN_TIMEOUT_MS`). A turn that does not end is refused with `TOPOLOGY_AGENT_BUSY`, and the session is left untouched.
  2. It asks the agent to write a handoff (goal, state, open questions, files) to `<state root>/handoffs/<agent>/<ULID>.md`. The default bound is 5m (`--handoff-timeout`, `AO_RESPAWN_HANDOFF_TIMEOUT_MS`).
  3. If no handoff arrives in time, it falls back to a summary built from the tail of the agent's transcript, titled `TRANSCRIPT-DERIVED FALLBACK`.
  4. It ends the old session exactly once: the provider's `exit_command` first, then `kill-session` on that exact name.
  5. It starts the fresh session under the same name with a new ULID and records the predecessor's ULID (`@ao-predecessor`, `identity.predecessor`, and `predecessor` in `run.json`).
  6. It returns the handoff to the caller under `respawned`. The new session receives it only when the lead passes it, with `--pass-handoff` or the new `session handoff <agent> --file <path>`.
- A per-agent lock is held until the replacement exists. If two re-spawns of one agent run at once, exactly one replaces the agent; the other fails with `TOPOLOGY_RESPAWN_JOINED`, which carries the winner's result. `--no-respawn` keeps `TOPOLOGY_AGENT_ALREADY_LIVE` for scripts. An agent that is one pane of a team session is refused with `TOPOLOGY_RESPAWN_SHARED_SESSION` rather than ending its teammates.
- The Claude provider declares `exit_command: "/exit"`.

### Tests

- `tests/unit/topology-persona-registry.test.mjs` adds the following. Each NATS case uses a throwaway nats-server (killed by PID only) and skips when no binary is found:
  - one conformance table run against both registries;
  - two allocator processes racing 24 allocations in one team, which asserts that their allocation windows overlap;
  - release;
  - stale-versus-live reclaim, including the grace period;
  - a forced two-reclaimer race over 10 rounds;
  - the unreachable-NATS refusal, with repo scope still working;
  - a hub plus a leaf with its own JetStream domain, racing 20 allocations. This case also shows that a leaf with no domain set uses a separate bucket.
- Mutation checks: replacing the atomic `create` with a plain `put` fails the race, leaf and conformance tests. Replacing the reclaim `update` with a `put` fails the reclaim race.

### Docs

- **Presence session-names addendum for the gateway (TM-274, ADR-0030).** `topology/PRESENCE-SESSION-NAMES-ADDENDUM.md` supersedes the name shapes in presence contract §4.3–§4.4, without editing the frozen contract: the `[team--]node--repo--role--persona` shapes per `session.kind`, the legacy `ao-<id>` and `<id>-<7 hex>` shapes until those sessions end, the slug and length rules, and the `@ao-*` options as labels rather than proof. The presence shape is unchanged (`schemaVersion` stays `2`; `session.kind` keeps its vocabulary), and a run of one agent under a new name is published as `kind: "run"`. `topology/SESSION-NAMES-COUNTERSIGNATURE-REQUEST.md` asks the gateway lead to countersign. Fixtures and `check.py` are in `topology/fixtures/presence-session-names/`, hashes in `SESSION-NAMES-HASHES.txt`, and `tests/unit/topology-presence-session-names.test.mjs` checks the real producer output, the fixtures and every hash, and proves the hash check fails when one byte changes.

## [0.13.2] — 2026-10-02

### Fixed

- **`services ensure` no longer flaps between copies of the same build or lets an older session downgrade the managed services (TM-283).** Every session's SessionStart runs `ensure` with its own plugin root — the installed cache, the directory-marketplace source tree, or an older cache in a long-lived session — and the pointer took whichever ran last. Two copies of one build looked different (a cache was identified by its folder name, a checkout by its build fingerprint), so alternating sessions restarted every managed process each time, and a session still on an older plugin re-pointed the services at older code. The pointer now records the build fingerprint and package version: an `ensure` of the same build keeps the existing pointer and restarts nothing; an older version never replaces a newer one while that one's folder still exists; a newer version moves the pointer and restarts each process once.

## [0.13.1] — 2026-10-02

### Tests

- **No test can reach the operator's tmux server (TM-281).** The real-tmux cases in `topology-launch.test.mjs` set only `TMUX=''`, so a plain `TMUX= npm run test:unit` created and killed sessions on the default server, where live agent sessions run — the hazard behind INCIDENT-2026-09-09. Every real-tmux test now goes through one helper, `tests/helpers/isolated-tmux.mjs`. It gives each test a blank `TMUX`, a private `TMUX_TMPDIR` under `/tmp/aot-*`, a socket inside it, and a teardown that runs `kill-server` only with `-S` on that socket. It refuses, by resolved path, the default socket `/tmp/tmux-<uid>/default` and the server the suite was started from.
- Every test script (`test:unit`, `test:topology`, `test:contract`, `test:topology:tmux`, `run-tests.sh`, `tests/stability.mjs`) now loads `tests/helpers/tmux-preflight.mjs` with `--import`. Library calls that are given no server or env resolve tmux from `process.env`, so the preflight blanks `TMUX` and sets a private `TMUX_TMPDIR` when none is set or it is `/tmp`. It fails at load if a bare `tmux` would still reach an operator socket. `tests/unit/tmux-isolation.test.mjs` proves the preflight ran, that the helper refuses the default socket and the operator's live socket, and that a refused kill never runs tmux.

## [0.13.0] — 2026-10-02

### Changed

- **tmux session names are `[team--]node--repo--role--persona` (TM-274, ADR-0030).** For example `core--agents1--bytedesk-marketplace--lead--ada`, or `agents1--bytedesk-marketplace--reviewer--linus` without a team. Segments are slugged to `[a-z0-9-]` with no `--` inside and capped (team 16, node 24, repo 32, role 48, persona 24). `node` is `AO_NODE_NAME`, else the new `node.name` key in the ao user config, else the short hostname. `repo` is the `origin` remote's repository name (the main checkout's folder when there is no remote; worktrees resolve to the same repo). `team` comes from `--team` on `launch` or a spec's new `team` field. A session that holds a team run is `[team--]node--repo--<workflow>--<persona>` (for example `agents1--bytedesk-marketplace--parallel-review--ada`): the workflow is the role segment and the run holds a persona from the registry, so concurrent runs of one workflow coexist under distinct names. Applies to role-sessions (lead, reviewer, observer, `session open`, role holders), one-agent spawns, workflow runs, retries and child runs.
- **No collision suffix.** An agent holds one live session: spawning or opening an agent that is already live elsewhere is refused with `TOPOLOGY_AGENT_ALREADY_LIVE`, naming the holding session. Personas come from a registry interface (`allocate` / `release` / `holder`, in `persona-registry.mjs`): first name, then `first-last` once the first name is taken in the scope (the team, else the repo segment), then the agent id. A team run draws from the first-name pool and gives its persona back on `stop`, on a dry run and on a launch that left no session; a run whose session vanished without a stop is reclaimed after a two-minute grace. This release ships the local registry, a file under the topology state root guarded by `withLock`; the NATS KV team registry is TM-279.
- **The name is a label, not a key.** Every session gets a ULID and records `@ao-id`, `@ao-agent`, `@ao-role`, `@ao-repo`, `@ao-repo-origin`, `@ao-node`, `@ao-team`, `@ao-run`, `@ao-workflow` and `@ao-kind` as tmux session options (team panes also carry their agent), mirrored into `session.json` (`identity`) and `run.json` (`session_identity`). `session list`, presence, the observer's lead lookup, role status and detach, lead and reviewer assignment and prompt ack resolve identity from metadata or the recorded session. `listServerPanes` returns the options as `identity`; `listSessionIdentities` and `setIdentity` are new.
- A spec's `session` template no longer names the tmux session; `{{session}}` renders the name ao chose. The `TOPOLOGY_SESSION_EXISTS` refusal is gone: a second concurrent run of a workflow gets its own name. `TOPOLOGY_AGENT_ALREADY_LIVE` still refuses a second session for a library agent.

### Removed

- `identity.mjs` `sessionName` / `parseSessionName`, and `launch.mjs` `roleSessionName` / `uniqueSessionName`. Use `session-names.mjs` (`composeSessionName`, `sessionIdentity`) and `launch.mjs` `planSession` / `roleSessionFor` / `recordedRoleSession` / `liveSessionOf`.

### Migration

- Live sessions named before this release — `ao-<id>` role-sessions (for example `ao-fd2b831f`) and `<id>-<7 hex>` spawns — are still recognised and reattached until they end. A role-session whose legacy session has ended reopens under the new name.

## [0.12.1] — 2026-10-01

### Fixed

- **A repository supervisor survives a NATS restart (TM-277).** Killing the managed `nats-server` used to end `ao-topology supervise` with exit 1. The presence heartbeat writes to the `ORCH_PRESENCE` bucket; its JetStream request timed out (`NatsError` `TIMEOUT`), the heartbeat treated that as fatal, and the error escaped the CLI's top-level `await`. A NATS outage (`TIMEOUT`, `408`, `503`, a closed, refused or dropped connection, or `TOPOLOGY_NATS_UNAVAILABLE`) now skips one heartbeat beat or degrades one tick (`degraded: "transport-unavailable"`), and the quiet tick backs off on the existing 2s/5s/15s ladder. The cached connection is closed without a drain, so the next tick dials again. The tick record counts the outages in `transport_failures` and keeps the latest in `transport_error`. Any other error still ends the supervisor, and a one-shot `supervise --once` still fails with the outage. The classifier and the discard live in one helper in `orch-transport.mjs` (`isTransportFailure`, `absorbTransportFailure`).
- A process started by the service manager no longer starts a detached `nats-server` when the managed one is down. It used to do this after 5 seconds: a second server on the same JetStream store, with `state.json` rewritten away from the managed port. It now reports `TOPOLOGY_NATS_UNAVAILABLE` and retries on its next tick.
- **Runs can start on macOS (TM-273).** Every non-Windows host was given the `linux-native` backend, which launches workers through `systemd-run` and `prlimit`; neither exists on macOS. darwin now selects `darwin-native`: a detached Node watchdog starts each worker as the leader of its own process group, enforces the same limits as the Linux scopes (8 hours per worker, 30 seconds per provider probe; SIGTERM, then SIGKILL after 3 seconds), and caps core dumps and file size with `ulimit`. Liveness is the recorded pid plus its start identity, and cancel signals the whole group. macOS has no per-group memory or task-count limit, so none is applied. Logs and run state use the same layout as Linux.
- On macOS, process start identity comes from `ps -o lstart=` in the C locale instead of `/proc`, and the session host is not started through a systemd scope.

### Changed

- **Provider isolation is unavailable on macOS, and runs are refused rather than run unsandboxed.** Bubblewrap is Linux-only. On darwin, `doctor` reports the sandbox as `unavailable` with the reason, and `spawn` refuses with `AO_SANDBOX_UNAVAILABLE` before any provider discovery. The provider-sandbox launcher also refuses on any platform other than Linux and Windows. A macOS sandbox is follow-up work.
- Verified on Linux only: the darwin selection is tested by injected platform, and the process-group backend (launch, liveness, cancel of the whole group, runtime-limit escalation, ulimit caps) is exercised for real on Linux, where it uses the same POSIX calls. It has not run on a Mac.

## [0.12.0] — 2026-10-01

### Added

- **Managed services (TM-272).** process-compose v1.122.0 (Apache-2.0, pinned with a SHA-256 per archive in `services/process-compose.lock.json`; a mismatched download is refused) now runs the session host, the local NATS server and one repository supervisor per registered repository, and restarts any that die. The OS keeps process-compose itself alive and starts it at login: a systemd user unit on Linux, a LaunchAgent on macOS, a scheduled task on Windows, or a detached process on Linux/WSL without a systemd user manager. No linger. New CLI: `agent-orchestration services install|ensure|status|probe|uninstall`. `ensure` is idempotent: a second run with nothing changed writes no file, reloads no service manager and restarts nothing. Processes run the plugin through `<data home>/bytedesk/agent-orchestration/launcher.cjs` and `current.json`, so a plugin update restarts processes instead of rewriting config.
- A SessionStart hook runs `services ensure --detach`. It returns at once, logs to `<state root>/services/logs/ensure.log`, and never fails the session.
- `NOTICE` attributes process-compose.
- **`ao-topology git-hook install|uninstall|status`** installs a real git `pre-commit` hook, so commits made from a terminal or IDE are checked as well as commits made inside a Claude session. It runs the same project-install guard. It resolves the plugin from `~/.claude/plugins/installed_plugins.json` at commit time, so it survives plugin updates, and it fails open if the plugin is not found. It honours `core.hooksPath` and linked worktrees, refuses to overwrite a pre-commit hook it did not write, and removes only its own on uninstall. It does not chain onto an existing hook.
- **Commit guard.** A `PreToolUse(Bash)` hook blocks `git commit` in a repository whose `.claude/settings.json` enables `agent-orchestration` or `task-management` at project scope, because both are user-scope installs and a project entry creates a per-project install record. It fails open on any internal error. The same check runs standalone as `scripts/check-no-project-plugin-installs.mjs` (repo mode, or `--installs` for `installed_plugins.json`; `--plugin <name>` adds plugins). Per-repo task-management data under `.bytedesk/task-management/` is not settings and is never checked. Not verified in a live Claude Code session: the hook's matching and its block message are covered by `scripts/guard-project-install.test.sh`, not by a real commit attempt.
- **NATS starts itself when it is not reachable.** `openNatsTransport` (every caller: supervisor, mailbox, presence, reviewer) now falls back to a per-user JetStream `nats-server` when there is no `AO_NATS_URL`, no gateway `orch.sock`, or the ambient `NATS_URL` refuses the connection. The server is detached, loopback-only, and set up under `~/.bytedesk/agent-orchestration/nats` (`AO_NATS_HOME`): a generated password in a `0600` file, one account with no system account, and permissions limited to `orch.>` plus the JetStream and KV API. A second caller reuses the running server. An explicit `AO_NATS_URL` is never replaced; `AO_NATS_AUTOSTART=0` turns the fallback off. The binary comes from `AO_NATS_SERVER`, `~/.cache/ao-orch/nats-server`, or `PATH`; the snap shim does not count.
- The repository supervisor monitor no longer exits 1 with `TOPOLOGY_NATS_UNAVAILABLE` on a machine with no NATS server running.

### Changed

- The `ao-supervise` monitor runs `services ensure --consumer-cwd .` and exits, instead of being the supervisor. It registers the session's Git repository, so that repository keeps its supervisor, enrolled or not.
- `ensureSessionHost`, `startRepositorySupervision` and `ensureLocalNats` go through `services ensure`. Their previous launchers (the 24-hour `systemd-run` scope, the in-process host, the detached supervisor and the detached NATS server) remain behind `AGENT_ORCHESTRATION_SERVICES=0`, and are used with a message when the services cannot be installed.
- The session host runs the interrupted-run recovery sweep (`autoRecover: true`), so a lost worker is found even when no MCP server is running. Concurrent sweepers were already safe: each run is recovered under its own cross-process lock and re-read inside it.
- A hand-run `agent-orchestration session-host` exits 0 without starting a second host when a healthy one owns the state root.
- `AO_SESSION_HOST_NOT_DURABLE` now tells you to run `agent-orchestration services ensure`.
- **Every Git repository is enrolled by default; enrollment is opt-out.** Put `{ "enabled": false }` in `.bytedesk/agent-orchestration/config.json` to opt a repository out. A message to a repository whose lead is down now recovers that lead without the repository having been switched on first. Paths that are not Git repositories are still not enrolled by default. Tests that relied on "unenrolled by omission" now opt out explicitly.

### Fixed

- **Main is green again after 0.11.0 (TM-264).** The tracked `dist/cli.cjs` and `dist/mcp.cjs` are rebuilt. They inline the nats client, because an installed plugin ships no `node_modules`; the client is still evaluated only when the NATS transport opens.
- The unbundled `ao-topology` in a plugin tree without `node_modules` now reports `TOPOLOGY_NATS_UNAVAILABLE` naming the missing nats package, instead of a raw `ERR_MODULE_NOT_FOUND` stack, when NATS is selected.
- The activation, lead-convergence, and role-icon tmux contracts set `AO_TRANSPORT=file`. They test tmux supervision, not NATS, and failed with `TOPOLOGY_NATS_UNAVAILABLE` on a machine without a NATS server.
- The `bind` unit test's implicit-server case clears `TMUX`, so it no longer fails when the suite runs inside the operator's tmux.
- The clean-install contract test stops the session-host scope it starts, instead of leaving one running for 24 hours after every run (TM-272).

## [0.11.0] — 2026-09-27

### Added

- feat(agent-orchestration): **Agents talk over NATS by default (TM-231, TM-232).** Mail, claims, presence, probes, and reviewer verdicts go through one transport. The live path publishes `orch.<repo>.mail.<agent>` on `ORCH_MAIL`, claims with compare-and-set on `ORCH_CLAIMS`, presence on `ORCH_PRESENCE`, probes as request/reply, and verdicts on `orch.<repo>.review.<nonce>`. A message accepted before a listener gap is still delivered after reconnect. `AO_TRANSPORT=file` keeps the previous file double for the existing suite.

### Changed

- Close drains the NATS client, drops acked mail, and reuses JetStream consumers so a send does not hold the process or grow an unbounded queue.

### Fixed

- Load the NATS client only when the NATS transport opens, so a copied plugin tree that still uses the file double does not fail on a missing `nats` package.
- Refresh the roadmap source hash for `src/mcp.mjs` after the 0.11.0 version string change.
- `ao-topology mailbox inbox` reads NATS mail for the agent. The reviewer listens for probes and publishes verdicts on the orch subject; collection reads that subject.
- `ao-topology review listen` keeps the probe subscription open until the process is signalled. `review probe` asks that subject, and `review await` prints the verdict body from `orch.<repo>.review.<nonce>`.
- `ao-topology wait` reads replies from `orch.<repo>.mail.<agent>.reply`. Mailbox inbox stays on the exact mail subject, so reading the inbox cannot ack the reply. A reply sitting behind another reply on that subject is still returned.

## [0.10.0] — 2026-09-22

### Added

- Publish a versioned index for explicit ACP and topology workflows, with durable native history across linked worktree cleanup.
- Add producer-owned workflow controls with exact tmux incarnation checks, retained partial failures, idempotent requests, and retry lineage.
- Report consumer admission, loaded build fingerprints, state roots, role readiness, supervisor heartbeat, and session-host health separately.

### Fixed

- Admit unrelated consumer marketplaces, including Gateway, while rejecting orchestration source, payloads, and aliases.
- Pin the owning user namespace when attaching Linux sandbox networking, so Bubblewrap's later namespace change cannot race startup. Retain sandbox restrictions and reject a changed network identity.
- Require a current first heartbeat before reporting a repository supervisor ready; distinguish lifetime contention from nested lock failures and stop only its own watcher.
- Require current prompt and role acknowledgements before reporting a lead or reviewer ready. Diagnostics inspect existing proof without waking agents or changing their acknowledgement files.
- Collect restricted reviewer acknowledgements and verdicts without shell access. Bind review requests and evidence to an exact revision, nonce, and reviewer incarnation.
- Keep governed task completion behind independent review and an explicit integration receipt. Preserve worker scope and hold unsupported fallback candidates before takeover.

## [Unreleased]

### Tests

- **The topology-tmux contract test no longer starts real leads (TM-294).** Its enrolled delivery
  runs name a lead provider that does not exist, so `test:contract` passes with no TM-290 guard hits.
- **No test can start a real provider CLI (TM-290).** A temp `git init` repository is enrolled by
  default, so tests that reached supervise, launch or startup were starting a real `claude` lead.
  The test preflight now puts a recording shim for every catalog provider (`claude`, `codex`,
  `grok`, `kimi`, `gemini`, `copilot`) first on PATH. A shim refuses with 127, and the test file
  that ran it fails, named. `tests/helpers/temp-repo.mjs` creates temp repositories opted out of
  enrollment by default, or enrolled with a lead provider that does not exist. The guard found
  six spawns, in `topology-repo-enrollment`, `topology-respawn`, `topology-session-names` and
  `topology-supervision`. Those four files and the `topology-activation-tmux` contract are fixed.

### Added

- **The repository lead records landings without a grant, and a server-side lead-autonomy policy
  stands in for per-plan grants on integrate (TM-263, ADR-0027).** `manage record-landing` from
  the repository's own lead, proven by pane ancestry (TM-234), needs no grant and no
  `--authorized`. It still needs the landed commit on the server's default branch (`gh api
  compare`) and an approving review at the finish revision; the record names
  `channel: "repository-lead"` and `adr: "ADR-0027"`. `manage integrate` accepts the lead without
  a grant when `management.lead_autonomy` on the SERVER default branch (read through `gh api
  contents`, never the local file) names that lead and the `integrate` scope; every other
  guardrail and the exact `gh` argv are unchanged, and the record names
  `channel: "lead-autonomy-policy"` with the policy's ADR and `authorized_by`. An unavailable
  server fails closed to grant-required. Workers and non-lead agents stay refused. Revoke the
  integrate policy by removing it from the default branch. This no longer protects against a
  compromised lead merging any reviewed, green PR; see `docs/repository-leads.md`.
  After review, the GitHub repository is pinned in host state
  (`<stateRoot>/repositories/<repoKey>.github.json`) on first resolution. A later `gh repo view`
  that disagrees (a repointed remote or gh default) drops lead autonomy to grant-required, refuses
  integrate with the named condition `repository`, and fails the TM-257/TM-263 server compare.
  Every later `gh` call passes `--repo <pinned>` or names it in the `gh api` path. Record-landing
  by the lead is also refused when the server's `lead_autonomy` policy names a different lead.

- **`manage integrate` merges the task's pull request itself, behind its own guardrails
  (TM-249, ADR-0022).** With `management.integrate_via: "pull-request"`, integrate runs
  `gh pr merge <n> --merge --match-head-commit <approved sha>` only when the task is in the
  caller's plan grant, the PR base is the integration branch, the PR head equals both the approved
  review's revision and the finish revision, CI is green, the review verdict is approve and the PR
  is mergeable. Each unmet condition is refused by name. It then records the landing and closes the
  task through the store's gates with the grant's actor, `delegated_by` and `delegation_id`. It
  never accepts acceptance criteria on the task's behalf: if the store refuses `tm done`, the
  landing stands and integrate returns `TOPOLOGY_INTEGRATE_UNCLOSED` naming each unaccepted
  criterion, and a rerun after they are accepted closes the task. The close-retry runs the same
  `caller` and `plan` gate as the merge (one shared helper), and both integrate paths build the
  authorization record with one function, so an operator-shell `auto_merge` integrate without
  `--authorized` or a grant records `authorized: false`. An already-merged PR at the approved head
  is recorded, never merged twice. Leads never run raw `gh pr merge`; TM-243's `manage integrate`
  rule already covers the verb.
- **An operator installs allow rules so the lead runs its governed verbs without a per-command
  prompt (TM-243).** `ao-topology permissions install [--mcp <mcp__server>] [--dry-run]` writes
  `Bash(ao-topology manage record-landing|integrate|start-worker|stop-worker|admit|report *)` and
  `Bash(tm *)`, plus each opted-in MCP name, to `<lead agent dir>/.claude/settings.local.json`.
  Only that lead reads the file. Install prints the exact diff, is idempotent and says to restart
  the lead; `uninstall` removes only the rules install recorded as its own. Both refuse inside
  any agent session (the TM-234 operator gate, now shared). Install also refuses when the lead
  launches outside its own agent directory (TM-242), because the file would then be shared. The
  rules grant no authority: `record-landing` and `integrate` still need a proven TM-234
  delegation.
- Governed `manage` verbs run as bare commands: with no `AO_AGENT_ID`, the caller is named from
  the census binding of its live pane. `--summary` prints one line instead of JSON, so a lead
  never pipes to `jq`. A dispatched worker (`TM_DISPATCH_WORKER`) is refused every `manage` verb
  except `report`, `status`, `eligible` and `assignment`.

### Changed

- **An approved plan is a checkable grant, and managed sessions cannot self-assert authority
  (TM-248, ADR-0022).** `delegate grant` now requires a plan (`--epic EP-nnn` and/or
  `--tasks TM-nnn,...`) and `--expires` of at most 14 days, and the operator retypes the plan in the
  confirmation. `manage integrate` and `manage record-landing` accept a grant only when its plan
  covers the task; otherwise they refuse with `TOPOLOGY_DELEGATION_PLAN`. An epic plan is frozen at
  grant time: `--epic` resolves to the epic's task ids in the store, recorded as `plan.tasks` with
  `plan.sha256`, and listed in the confirmation. Coverage is membership in that list only, so a task
  moved into or created under the epic later needs a new grant. A `plan.sha256` that does not match
  `plan.tasks` is refused with `TOPOLOGY_DELEGATION_INTEGRITY`. A grant without a plan, or an epic
  grant without a frozen list, covers nothing. The merge record's
  `authorization` carries `actor` (the grantee), `delegated_by`, `delegation_id` and `plan`.
  Inside a managed agent session (an agent marker such as `AO_AGENT_ID`, `TM_SESSION_ID`,
  `TM_DISPATCH_WORKER`, `CLAUDECODE`, `CLAUDE_CODE_*` or `CODEX_*`, a Claude Code or Codex
  ancestor, or a tmux pane a census binds to an agent; one helper, shared with TM-243's
  `permissions install` gate)
  `--actor` and `--authorized` are refused with `TOPOLOGY_MANAGEMENT_SELF_ASSERT`; an operator
  shell keeps both. A managed session always needs a covering grant on both verbs, whatever
  `management.auto_merge` says, including a bare verb named by its pane binding (TM-243);
  `auto_merge` applies only to an operator shell. `--expires` accepts
  days (`7d`).

### Fixed

- **Presence no longer publishes `kind: "spawn"` under a new-style session name (TM-287).** A
  run.json agent with a seven-hex `spawn` token whose pane carries matching `@ao-agent` metadata was
  published as `spawn` whatever its session was called, which the Presence v2 validator rejects.
  Such a session is now published as `kind: "run"` with `spawn: null`, as session-names addendum §3.3
  specifies; `spawn` stays reserved for a legacy `<agentId>-<7 hex>` name. `topology-presence` tests
  now run every snapshot they publish through the v2 validator.
- **Reviewer verdicts carry their findings intact on every transport (TM-195, TM-220).** The
  write-free reviewer now emits `AO_REVIEW <nonce> b64:<base64 of the JSON>`: base64 has no quote
  to leave unescaped and no space a pane wrap can lose, so a verdict quoting shell code survives.
  Bare JSON is still read, so a reviewer running the old instruction keeps working until it is
  relaunched. Its pane is its one channel on both transports: under NATS, collection used to wait
  for a verdict the reviewer had no shell to publish. Pane and `review publish` share one decoder,
  and a response that does not decode to `{verdict, findings: [...]}` is refused, including one with
  no findings array, which used to record as an approval. `review publish` needs `--response` with
  the whole response; it no longer publishes `findings: []` or defaults to approve. A failed
  request is refused on collect without escalating again (`TOPOLOGY_REVIEWER_REQUEST_FAILED`), and
  the approve refusal names minor, nit and note.
- **A task branch that merges the default branch is reviewed over its own changes only (TM-257).**
  The review range was pinned to the admission commit, so a branch that merged `main` to clear a
  conflict carried every task already landed there, and the reviewer judged them as part of this
  task (PR 128, TM-241). One helper, `effectiveBase` (via `reviewRangeBase`), now derives the base
  for the review request, review record, `collectReview`, `reviewEligibility`,
  `independentReviewStatus` and the `integrationEligibility` file-scope check.
  **The trust anchor is the GitHub default branch, never a local ref.** Worktrees share refs, so a
  worker could otherwise move `origin/main` to a commit of its own and shrink both the reviewed patch
  and the scope check to its last commit. The base is the `merge_base_commit` of GitHub's
  `compare/<default>...<revision>` (via `gh`, owner/repo and default branch from `gh repo view`),
  used only when it verifies locally: the commit exists, the admitted base is a strict ancestor of
  it, and it is an ancestor of the revision; otherwise `TOPOLOGY_REVIEWER_RANGE`. A caller cannot
  supply it. When the server cannot answer (no `gh`, auth or network failure, revision not pushed,
  malformed answer) the range fails closed to the admitted base, wider and never narrower, and the
  request's `range_note` says why. After landing, the effective base recorded on the host-written
  request stands while it is a strict descendant of the admitted base, an ancestor of the revision,
  and on the server's default branch (`compare/<base>...<default>` is `ahead` or `identical`). A
  request queued before this change has no recorded base: the stored review's base is used only if
  it reproduces the reviewed patch hash, and otherwise the gate reports that a re-review is required.
  Requests and records carry `admitted_base` and `effective_base` (`base_revision` is the effective
  base the patch was computed from). Workers cannot push to the default branch (the PreToolUse guard
  plus branch protection). **Security note:** a process running as the same user could still
  replace the `gh` binary or the remote configuration — the documented same-uid limit.

### Changed

- **Tasks in a repository with a standing reviewer are admitted before dispatch (TM-240).**
  task-management now refuses to dispatch an unadmitted task when this plugin has registered a
  reviewer for the repository, unless `dispatch.governed` is explicitly `false`. Before, an unset
  value skipped `manage admit`, and `reviewer request` then refused the finished work with
  `TOPOLOGY_REVIEWER_RANGE` because no admission record held its base revision — design-system
  TM-136 (PR 121) and marketplace TM-235 (PR 125). No code in this plugin changed. New tests run the
  real `tm` CLI through refusal, `manage admit`, dispatch and finish to an accepted review request,
  and run `reviewer request` from a copy of `topology/` with task-management absent.

- **A lead starts, adopts and stops task workers through `manage`, with ownership recorded
  (TM-218).** `manage start-worker --task TM-id [--backend tmux|topology]` launches the worker for an
  admitted task through `tm dispatch` and binds its observed pane, so `manage eligible` no longer
  reports "Task dispatch must name the claim owner and worker run." `manage bind --task TM-id
  --pane <id> [--server <socket>]` or `--pid <pid>` adopts a worker the lead already started, after
  verifying it is live, alone in its session and in the task worktree; unknown, shared, reused or
  already-bound identities fail closed. `manage stop-worker --task TM-id` closes the bound pane only
  when this session owns it, its finish report is collected, and it is idle (a shell with no running
  harness); otherwise it refuses with a recovery path. `manage cleanup` now uses the same closer by
  default, and no longer throws when it has to close a worker without an injected state probe.
  After a stop, `start-worker` starts the next round's worker and keeps the stopped binding in
  `previous_workers`. Adoption refuses a session created before the task was admitted and a login
  shell, so an operator's terminal is never closed. Idle detection is Linux-only.
- **`manage integrate` is usable in a repository whose tools write into the main checkout
  (TM-224).** The clean-checkout check ignores the tool store paths `.bytedesk/task-management/`,
  `.bytedesk/agent-orchestration/agents/` and `.bytedesk/knowledge/.km/`, still refuses any other
  dirty path and names it, and refuses a landing that would change a store path. A task that cannot
  fast-forward the target branch is refused with that reason before any store-path comparison.
  `docs/repository-leads.md` documents the `management.target_branch` and
  `management.required_checks` shape, with this repository's policy as a worked example.
- **`manage record-landing` records a landing that already happened (TM-224).** It never merges.
  It requires the reviewed finish revision to be an ancestor of `--landed`, `--landed` to be on the
  target branch, an eligible independent review, integration authority (`--authorized` or
  `management.auto_merge`), and a non-empty `--actor` and `--reason`. It runs no checks: the merge
  record carries `checks_skipped: true`, and `--reason` should cite the checks run at landing. It writes
  the same merge record as integration plus a `recorded-landing` event, so governed tasks landed by
  hand can close.
- **A reviewer verdict stuck INCOMPLETE ages out instead of retrying forever (TM-217).**
  `collectReview` used to throw `TOPOLOGY_REVIEWER_RESPONSE_INCOMPLETE` for an unclosed verdict and
  leave the request pending no matter how long it stayed unclosed. It now records the first time a
  request is seen incomplete and fails it — once, with the lead notified exactly like a refusal —
  once that has been true for `AO_REVIEW_INCOMPLETE_BOUND_MS` (default 120s), or once the pane
  capture has not changed at all for `AO_REVIEW_INCOMPLETE_STALL_MS` (default 30s, at least two
  supervision polls). An empty composer is deliberately not read as idle: Claude Code draws its empty
  input box below a verdict it is still printing. A fresh `requestReview` mints a new nonce as usual.
  A verdict that closes before either condition is met still records normally.
- **Reviewer findings are structured (TM-215).** Each finding is `{severity, file, line, claim,
  evidence, fix}` with severity `blocker`, `major`, `minor`, `nit` or `note`. A note needs no
  action and may omit `evidence` and `fix`. Malformed findings, and findings about a file outside
  the reviewed diff, are refused. An approval may carry minor, nit and note findings; a blocker or major finding still blocks it, and `changes_requested` needs at least one
  blocker or major finding. The reviewer gets its own common prompt (`prompts.common_by_role.reviewer`) without the
  reply-file and command steps it cannot perform, and is told to cite evidence in the request rather
  than claim checks it cannot run.
- **Agents launch without permission prompts by default (TM-214).** A spec, template or stored agent
  with no `auto_approve` key now gets its provider's `auto_approve_args` (claude:
  `--dangerously-skip-permissions`); `auto_approve: false` still opts an agent out. The TM-090
  consent gate is removed: `ao-topology launch` no longer refuses without `--allow-auto-approve`,
  which is accepted as a no-op, and the launch warning naming auto-approved agents stays. The
  repository reviewer stays read-only (`--restricted --safe-mode`, never
  `--dangerously-skip-permissions`): its `agent.json` always stores `auto_approve: false`, including
  after `reviewer assign`, and `ao-topology session open` refuses the reviewer role
  (`TOPOLOGY_REVIEWER_READ_ONLY`) because it would not use the reviewer's read-only argv. For the
  same reason a spec may not reference the stored reviewer with `{ "agent": "<reviewer>" }`.

### Fixed

- **A review range over 8 MiB produces a review request (TM-241).** The reviewer patch no longer
  embeds binary bytes. Each binary file appears as git's "Binary files ... differ" line plus a
  manifest at the end of the patch listing its path, old and new blob sha256 and size, covered by
  `patch_sha256`. Text diffs, and the hash of a text-only range, are unchanged. Blob hashes are
  streamed, so no file size is capped. When the diff cannot be produced, `TOPOLOGY_REVIEWER_RANGE`
  names the cause: a revision that is not a commit, the size cap (64 MiB of text diff) with the
  bytes read, git's exit code and stderr, or the binary file that could not be read, with its size.
  A range that contains binary files hashes differently from before, so an outstanding request or
  approval for such a range must be requested again. The reviewer prompt explains the manifest.
- **Rendered reviewer verdicts parse again (TM-233).** Claude Code shows the reviewer's reply as
  Markdown, which turns `\"` into a bare `"`, and it hard-wraps long lines however wide the pane is.
  Every verdict that quoted text was refused as "Review response must be JSON". Collection now
  re-escapes a quote that JSON does not continue after, keeps a backslash that starts no valid
  escape, reads `\u{2014}` as the character, and joins wrapped rows with nothing outside strings and
  inside `verdict`, `severity` and `file`. Only prose can differ, by one space at a break. An
  unclosed verdict still waits as incomplete; a closed malformed one is still refused.

- Collect a reviewer verdict that Claude Code hard-wrapped across indented pane lines, one repeated
  on screen, or one followed by more output; the capture now reaches 5,000 lines back. Copies that
  disagree are still refused. A verdict whose braces have not closed yet is still being printed, so
  it is collected on a later tick rather than refused (TM-215).
- Report `changes_requested` as its own review state instead of `blocked` (TM-215).
- Keep every review record under `history/` so a re-review no longer overwrites the earlier one;
  `<revision>.json` stays the current record (TM-215).
- Mark a review request `failed` after five undelivered wakes, or when collection refuses the
  reviewer's response (not JSON, copies that disagree, or findings the schema refuses). Tell the
  repository lead once through its standing mailbox, and let a new request with a fresh nonce
  replace it, instead of retrying the same nonce forever (TM-215).

- Preserve nested workflow participants when saving and reloading composed specifications; process-only approval defaults no longer create an invalid participant field.
- Derive census role icons from the original display role, matching presence for observers, custom roles and missing roles while preserving repository-lead authority.

### Added

- **The operator can grant a lead standing integration authority instead of running `--authorized`
  by hand (TM-234, EP-021).** `ao-topology delegate grant --to <agent-id> --repo <consumer> --scope
  integrate,record-landing [--expires <duration>] [--reason <text>]` writes an append-only grant
  under the state home; `delegate list` and `delegate revoke <id>` read and end it. `grant` needs an
  interactive terminal and a typed confirmation of the grantee and scopes. Grant and revoke refuse a
  shell carrying any agent marker (`AO_AGENT_ID`, `TM_SESSION_ID`, `CLAUDECODE`, `CLAUDE_CODE_*`,
  `CODEX_*`), a Claude Code or Codex ancestor process, or a tmux pane the census binds to an agent,
  and a grantee cannot grant to itself. The grant records the checks as `channel` evidence, labelled
  `interactive-same-user` and `agent_proof: false`: an agent running as the same OS user can still
  get around them. `integrate`/`record-landing` refuse a delegations file holding a grant without
  that evidence. Scope is a fixed allowlist of `integrate` and `record-landing`
  only — deploy, publish, push and spend keep their own separate authorization. `manage integrate`
  and `manage record-landing` now accept a live, unexpired, unrevoked grant naming the caller's own
  `AO_AGENT_ID`, this repository and the scope in use, in place of an explicit `--authorized`; the
  merge record then sets `authorization.actor` to the grantee that exercised it, with
  `authorization.delegated_by` and `authorization.delegation_id` alongside; an `--actor` naming
  anyone else is refused (`TOPOLOGY_DELEGATION_ACTOR`), and `record-landing` no longer needs
  `--actor` under a delegation. This removes the self-approval a lead would otherwise be attesting
  when it authorizes integration of its own work.
  Review fixes: `AO_AGENT_ID` alone no longer proves the caller is the grantee, since any same-user
  process can set it. A matching grant now counts only when the caller's `TMUX`/`TMUX_PANE` resolve
  to a live pane incarnation (the tmux six-tuple slots already check) that this repository's census
  binds to the grantee; otherwise `integrate` and `record-landing` refuse with
  `TOPOLOGY_DELEGATION_ACTOR`. The check lives in the one lookup both verbs and eligibility share.
  Second review fix: those env vars only NAME a pane, so a worker on the same tmux server could set
  `TMUX_PANE` to the lead's pane and pass. The lookup now also requires the lead's pane process to be
  an ancestor of the calling process (`callerRunsInPane` in `topology/lib/slots.mjs`, walking
  `/proc/<pid>/stat`), and refuses when the live pane's `pane_pid` differs from the census binding.
  PID equality is compared, not start times (nothing records one); it is sound because the pane is
  seen live first and every ancestor predates the caller. Where `/proc` cannot be read, including
  macOS, it fails closed. Remaining same-uid limit: ptrace or code injection into the lead's process
  tree, or a process started by typing into the lead's own pane. Setting env vars is no longer enough.
  `manage eligible` and status no longer throw on a corrupt delegations file or an unproven
  grantee: they report `eligible: false` with the error code as a reason. `delegate grant` refuses a
  `--to` that names no agent registered in the repository.

- **Cleanup joins the controls a capability holder can drive (gateway TM-305, EP-023).**
  `POST /api/runs/{runId}/cleanup` on the session host removes a terminal run's worktree, the same
  work `orchestration_cleanup` does over MCP. Until now the seam carried cancel, follow-up and
  decision only, so a gateway driving a capability could stop a run but never reclaim what it left
  behind, and its cleanup button had to be offered and then refused. The capability is already
  minted for one run and exchanged once, so it proves the caller may act on that run; the
  consumer-path ownership check stays on the MCP route, where the caller names the run itself.
  The action list is now exported as `SESSION_CONTROL_ACTIONS`, so the route and the control map
  cannot drift apart unnoticed.

- **A control seam a gateway can drive (gateway TM-304, EP-023).**
  - `agent-orchestration session-open --run-id <id> [--no-browser] [--json]` returns the run's
    loopback capability URL. `--no-browser` skips `xdg-open`, which on a remote host opens a window
    nobody is in front of; `--json` prints the whole session record instead of the bare URL.
    Nothing about the session widens: 127.0.0.1, a 32-byte capability, ten minutes, one exchange.
  - The verb refuses before minting rather than after: `AO_RUN_NOT_FOUND` / `AO_INVALID_RUN_ID` for a
    run that does not exist, and a new `AO_SESSION_HOST_NOT_DURABLE` when the only session host is the
    in-process one, whose URL would stop answering the moment the command exits. Start a durable host
    with `agent-orchestration session-host`.
  - `POST /api/runs/{runId}/decision` accepts an `actor` label, recorded as the approval's `by`
    (trimmed to one line, capped at 120 characters, defaulting to `operator`). A gateway forwarding
    an operator's approval can now name that operator. `by_attested` still describes the channel,
    which is the only part this process can verify.
- **Every run records where it came from (gateway TM-304, EP-023).**
  - The snapshot gains `launcher`: `kind` (`gateway-tab`, `tmux` or `agent`), the gateway tab id and
    session, the tmux pane and server socket, and the conductor — `ao-topology` agent id, role,
    session and topology run. It is `null` when nothing identifies a launcher, so "started from
    somewhere we cannot name" never reads as a binding we failed to record.
  - `parentRunId` is now filled in for a run spawned from inside a worker, from
    `AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID`, so the run tree reflects the real delegation.
  - Both are read from the launching process's environment, never from tool input: `spawn` arrives
    from the very agent being recorded, so an input field would be that agent's claim about itself.
  - A reader can open the exact terminal a run was launched from instead of matching working
    directories and calling the result a "likely launcher".

## [0.9.1] — 2026-09-13

### Fixed

- **A probe now outlives the wait for it, so the late-ack path can actually fire (TM-187, EP-019).**
  The lead and the reviewer each computed the probe's `expires_at` and their own wait deadline from
  the same expression — `Date.now() + ackTimeoutMs` in `lead.mjs`, and a loop running
  `while (Date.now() <= probe.expires_at)` in `reviewer.mjs`. The probe was therefore already expired
  at the instant the wait gave up, and the next statement deleted it: `sweepExpired` in the lead, and
  in the reviewer an `expired` test that was true by construction on every timeout. TM-161 taught
  both halves to accept an answer that arrived after the wait returned, and neither could ever do so:
  the window was zero-width. Observed live — `lead ack <nonce>` returned `{"ok":true}` against a probe
  that vanished a second later with `<agent>.answered.json` untouched, so a lead that answered
  correctly and promptly was recorded `unresponsive`. A single `LATE_ACK_GRACE_MS` in `delivery.mjs`
  (env `AO_LEAD_ACK_GRACE_MS`, default 120s) is now the gap between how long the probe lives and how
  long the host waits, shared by both halves so the value cannot be fixed in one and missed in its
  sibling. `expires_at` remains the one line both ack verbs enforce, so accepting a LATE answer still
  never becomes accepting a STALE one.
- **An ack that cannot be counted is discarded out loud (TM-187).** `lateAck` names the nonce it
  dropped and says whether the probe had expired or was already swept; a silent discard was
  indistinguishable from a lead that never answered. `sweepExpired` now removes a probe's `.ack.json`
  along with the probe, so no orphan is left for a later pass to drop, and it reports what it swept.

### Changed

- `lead.mjs` records `waited_until` beside `expires_at` on each probe, so the two numbers are legible
  on disk rather than inferred; the duplicated `rememberAck` on the success path is removed.

## [0.9.0] — 2026-09-11

### Added

- **One role-icon registry for every orchestration agent (TM-168, EP-019).**
  - `topology/lib/identity.mjs` now exports `roleIcon` and `roleVisual`, a single display-only
    mapping from a role to a Unicode icon and short readable text:

    | Role | Icon |
    |---|---|
    | lead | 👑 |
    | orchestrator | 🎼 |
    | reviewer | 🔍 |
    | observer | 👁️ |
    | worker | 🔧 |
    | implementer | 🛠️ |
    | designer | 🎨 |
    | image-gen | 🖼️ |
    | researcher | 🔬 |
    | judge | ⚖️ |
    | nested team | 👥 |
    | unknown or custom role | 🤖 |

  - Which role counts: a nested team first, then a repository lead, then the run role, then the
    library role.
  - Icons are computed, never stored in `agent.json`, and never used to decide a role or authority.
- **Presence and census show the role icon (TM-168).**
  - Presence agent entries and census rows carry two additive fields, `roleIcon` and `roleLabel`.
    They are computed after run membership is settled.
  - An unknown or hostile role gets the fallback icon and label.
  - `formatCensus` prints the icon and label beside the agent's name; the state glyph stays in
    the first column.
  - The fields are specified in `topology/PRESENCE-ROLE-ICON-ADDENDUM.md`, with generated fixtures
    under `topology/fixtures/presence-role-icon/`. `schemaVersion` stays 2, and the frozen v1
    contract and the signed header addendum are unchanged.
  - The gateway request is `topology/ROLE-ICON-COUNTERSIGNATURE-REQUEST.md`.
- **Role icons on terminal title bars, `run.json` and command output (TM-168).**
  - **Terminal title bar.** Sessions agent orchestration creates now show the role icon, readable
    name and role label. They are set through the pane options `@ao_role_icon`, `@ao_agent`,
    `@ao_role` and `@ao_role_label`, and a session-scoped `set-titles-string`.
  - **`run.json` and JSON output.** `run.json` entries, and JSON from `launch`, `status`, `agent`,
    `session` and `role`, carry additive `roleIcon` and `roleLabel` fields.
  - **Human output.** Rows show the icon before the name.
  - **Unchanged:** pane titles, session names, window names and ids.
- **Terminal title text is sanitised (TM-168).** Every value written into a tmux option or terminal
  title has control characters stripped and is capped at 80 characters. `#` and a trailing `;` are
  replaced, so they cannot inject tmux formats, split a batched command, or send escape sequences to
  an attached terminal.
- **Receiver-owned lead recovery (TM-167, EP-019).** In an enrolled repository, the repository
  supervisor now looks after that repository's own lead:
  - **What it does.** It creates a missing lead. It restarts a dead managed lead only after
    re-checking, under the registration lock, that the recorded pane is really gone. It never touches
    a lead that is alive but unresponsive, and never replaces a lead owned from outside; for that
    case it raises an alert naming the `lead assign` command.
  - **Retries.** Failed recovery is retried after 10 s, 30 s, 2 min, then every 10 min, and the
    delay resets once the lead responds. `lead status` shows the recovery action, attempts, last
    error and next retry time, and `doctor` reports `LEAD_DEAD_EXTERNAL` and `LEAD_RECOVERY_FAILING`.
  - **The supervisor's promise changes.** It used to "launch nothing". It now launches exactly one
    kind of agent: its own repository's lead, and only when the repository is enrolled.
- **Held cross-repository mail recovers and is delivered exactly once (TM-167).**
  - **Recovery.** A message held because a lead isn't ready asks that repository's own supervisor to
    recover its lead, and starts the supervisor if needed. Checking readiness never rings a lead.
  - **Visibility.** Each held message records `attempts`, `last_error` and `next_retry_at`.
    `mailbox resume --force` retries a message before its retry time.
  - **Clear hold reasons.** A side that isn't enrolled holds as `destination_not_enrolled` or
    `source_not_enrolled`. Holds that can never succeed, such as `hop_limit` or `loop`, are marked
    `permanent`.
  - **Exactly once.** A resumed message is delivered once, even with concurrent resumers.

### Changed

- **One enrollment resolver, and supervisors start only for enrolled repositories (TM-167, EP-019).**
  - `topology/lib/repo-enrollment.mjs` decides enrollment in this order:
    1. The repo config's `enabled`. `enabled: false` wins over everything, and an unreadable or
       non-boolean value counts as disabled.
    2. Project plugin enablement (`agent-orchestration@<marketplace>`).
    3. An existing lead registration.
  - Every linked worktree answers from the main checkout.
  - Every command that starts the repository supervisor, and session start, now goes through
    `activateRepository`. It starts a supervisor only for an enrolled repository. `enrollment ack`
    no longer fails the command when that start fails.
  - The supervisor still runs read-only in every repository, and its watcher labels only its own
    repository's panes.
- **No ordinary command lists panes on an unnamed tmux server (TM-167).** `listServerPanes` refuses
  with `TOPOLOGY_TMUX_SERVER_REQUIRED` unless it is given a server or a session. Callers pass their
  binding's server, their own pane's server, or `--server`.

### Fixed

- **Census recomputes each row's role icon (TM-168).** It no longer copies a stored icon. Every row
  and carried-forward tombstone derives `roleIcon` and `roleLabel` from its own `repoRole`, `runRole`
  and `roleName`, with the same precedence as presence. Rows now carry `roleName` so tombstones can
  do the same. A hand-edited census document can no longer put a different icon, or escape bytes,
  on a terminal, and no topology code reads an icon back.
- **A repository lead shows 👑 on its run pane too (TM-168, TM-185).** When the registered lead is
  launched into a run as `orchestrator`, its run pane, its `run.json` entry, launch output and
  `status` rows now show the lead icon. Presence already did. `agent list`, `session list` and `role list` show it as well; a non-lead orchestrator keeps 🎼.
- **Two topology tests no longer race a supervisor daemon (EP-019).** The `send` guard and the
  supervision tests now stop their daemon before removing its directories, and the guard asserts
  from recorded tmux calls.

## [0.8.0] — 2026-09-11

### Added

- **`ao-topology observer start` attaches only after proof (TM-164, EP-019).** New
  `topology/lib/observer-session.mjs` prepares the managed observer session, restarting it once
  if its prompt is stale. It then waits until that observer acknowledges its current prompt from
  the pane its tmux binding names (see the limit under TM-163). `--ack-timeout` controls the wait, with `AO_OBSERVER_ACK_TIMEOUT_MS` as
  the environment fallback and 30 s as the default. Only then does `startObserver` re-check the
  conductor's incarnation and commit attachment `version: 2`, carrying `observation_allowed: true`,
  `observer_binding` and `prompt_revision`. `observer open` is now an alias for the same flow.
  Version 1 attachments can still be inspected, but cannot `watch` or `report` until started again.
- **Prompt acknowledgement is bound to one exact process (TM-163, EP-019).** New
  `topology/lib/incarnation.mjs` identifies a process by six tmux fields: `serverKey`,
  `serverPid`, `sessionId`, `sessionCreated`, `paneId` and `panePid`.
  - `prompt ack` must match the agent, session, canonical repository, nonce, revision and
    incarnation. A refusal now names the failed check in `details.reason`.
  - **Limit:** the caller's incarnation is resolved from its `TMUX_PANE`. This stops a stale or
    replaced process from acknowledging by mistake. It does not stop another process of the same
    user that sets `TMUX_PANE` deliberately; TM-172 tracks stronger proof.
  - A replacement process invalidates earlier prompt-current proof, even when the revision is
    unchanged.
  - `ao-topology session --restart` performs a controlled restart. It promotes the pending prompt
    and requires acknowledgement from the new process.
- **A real-tmux contract test for the observer gate (TM-164, EP-019).**
  - `tests/contract/topology-tmux.test.mjs` now proves on an isolated tmux server that
    `observer start` commits no attachment before the observer's own pane acknowledges its prompt.
    The committed attachment is version 2, bound to that live pane, and carries the prompt
    revision composed now.
  - The launch tests in the same file now stop the supervisor that `launch` starts. They kill
    their tmux server by socket, and only after checking that the socket is inside the test's
    `TMUX_TMPDIR`.

- **Provider quota failover, mid-run (TM-135, EP-018).** `topology/lib/quota.mjs`, called from the
  supervise tick, closes a gap that cost two agents a working day: `failureOnScreen` was consulted
  only during the ~30 s of startup readiness, so once an agent was working nobody looked at its
  screen again — and the incident this closes happened hours in, with
  `403 You have reached your 5-hour usage limit` on a pane, recovered only because a human
  authorised a Codex takeover by hand.
  - **No provider JSON changed.** The signature is already in `failure_patterns` (`"usage limit"`
    is the first entry of `GENERIC_ADAPTER.failure_patterns`, and it survives `withoutPaths`).
    `attention_patterns` is the wrong home and the ordering proves it: attention is checked first
    because it means "a human must press a key here", and quota exhaustion is not answerable at the
    keyboard. Distinct from TM-131's `state: "quota-blocked"` census entry, which is the
    *observation* path (scheduling); this is the *failover* path.
  - **Only the quota-shaped subset acts.** `QUOTA_SIGNATURE` filters `failure_patterns` down to the
    quota entries. The full list is a STARTUP list — `command not found` and
    `no such file or directory` are ordinary output from a working agent's shell, and a supervisor
    watching for hours would propose a provider takeover for a failed `ls`.
  - **The server pushes.** One tmux control-mode client per agent session, `tmuxFailureTrigger`
    compiled into the subscribed format, so a quiet pane costs zero tmux calls and a capture is
    taken only when the trigger fires. Capped by `AO_QUOTA_MAX_CLIENTS` (default 8); panes past the
    cap are reported `unwatched`, never silently polled instead.
  - **Detection writes an incident and RESTARTS NOTHING.** The supervisor's "reconciles derived
    state only" rule is intact; applying a failover is a separate `ao-topology failover` call.
  - **`failover.consent` ∈ `ask` (default) | `auto` | `never`**, through the existing config
    layers. `ask` rings the lead with the approval command and is the one unavoidable human turn.
    `auto` applies AND ANNOUNCES — the rule forbids *silent* substitution, not substitution, and
    someone who sets `auto` consented in advance, in writing, in config; the reasoning is written
    into `config.defaults.json` itself so nobody re-litigates it. `never` refuses every takeover.
  - **Three false-positive defences, all required**, because an agent working on this feature will
    put the signature on its own screen: the match must still be present on a second capture ≥2 s
    later; the pane must be dead or the agent must not be making progress; and `ask` is the default
    so a false positive costs one message, not one provider.
  - **`failoverAgent` gains `{incidentId, approvedBy}`** and asserts the incident is open and names
    this agent and this provider before anything is respawned. TM-132's slot re-stamp is unchanged
    and still runs. New `ao-topology quota status|resolve`, and `docs/quota-failover.md` documents
    the three things that survive a failover separately — the work does, the conversation does NOT
    (which is why unanswered messages are re-delivered), and the claim does via tm's dispatch
    heartbeat with the named ceiling that `claimTtlMinutes` defaults to 240 against a five-hour
    quota window.

- **Idle-dispatch arbitration (TM-135, EP-018).** `management.mjs` gains `assignTaskToAgent`,
  `assignmentResult` and `releaseAssignment`, and the management record grows an `assignee`;
  `ao-topology manage assign|assignment|release` exposes them. The idle read and the assignment
  write happen inside ONE critical section under a repo-wide `assignment.lock` — the census is a
  hint, the record is the authority, and checking idle in the scheduler while writing the binding
  here is precisely how one pane ends up interleaving two tasks.

- **Broadcast addressing (TM-133, EP-018).** `topology/lib/addressing.mjs` adds four complete
  audiences to `--to`, unioned by the comma it already means: `@run` (this run's roster minus the
  sender minus the orchestrator), `@repo` (the enrolled standing agents of the destination
  repository), `@role:<role>` (both scopes), and `@idle` (whatever the census calls dispatchable).
  An `@`-prefixed token is the only new syntax — every existing form (agent id, collective fan-out
  id, `"Full Name"`) still goes through the unchanged `expandFanout` and produces byte-identical
  output. There is deliberately no intersection grammar.
  - **One expansion point.** `sendMessage` calls `expandAddresses` before the per-recipient loop,
    and `forwardMessageToWorkflow` routes back through `sendMessage`, so a forwarding agent cannot
    bypass admission by control flow rather than by convention. The CLI never expands.
  - **Admission is repeated, not widened.** Expansion yields concrete ids before the
    external/standing branch, so a broadcast is N ordinary sends each individually admitted.
    One new invariant closes the interesting attack: any `@` token with `external === true` is
    refused (`TOPOLOGY_BROADCAST_EXTERNAL`). An outsider still reaches the lead exactly as before.
    Cross-repo broadcast is therefore never held on a remote lead's readiness.
  - **The trap.** A standing lead or reviewer is normally *not* in `run.agents`, so `expandAddresses`
    returns `{id, delivery}` and the per-recipient branch is `external || delivery === 'standing'` —
    the envelope path is chosen per recipient. Without it `@repo` throws `TOPOLOGY_UNKNOWN_AGENT`
    for exactly the agents the feature exists to reach.
  - **Bounded by refusal.** `MAX_BROADCAST = 24` is separate from `MAX_FANOUT = 8` because it prices
    one inbox file plus one pointer, not a tmux session. Past it the send is refused naming the
    resolved count and the limit — never truncated; `--max-recipients` raises it.
  - `@repo` reads `collectPresenceAgents` **in-process** as a directory, not authority (every
    candidate is still validated by `routeMessage` and `known.has`), so the frozen Presence v1
    fixtures are untouched. `@idle` **refuses** when the census is missing or stale rather than
    degrading to "everyone". The reply barrier needs no new state: `pendingReplies`/`waitForReplies`
    resolve through the same function, so `wait --from @run` works (expanding live) and
    `wait --message <id>` barriers over exactly `run.message_deliveries[id]`.
- **Presence v1 header extension: contract, fixtures, countersignature (TM-136, EP-018).** The
  gateway terminal header needs slot queue, unread mailbox depth, agent state and current task per
  pane, and frozen Presence v1 carries none of them. `topology/PRESENCE-HEADER-ADDENDUM.md` specifies
  five optional agent keys — `activity`, `mailboxDepth`, `task`, `roleName`, `slots` — and one
  optional envelope key, `slotQueues`, **all additive: `schemaVersion` stays `1` and
  `PRESENCE-CONTRACT.md` is not edited.**
  - `lifecycle` keeps its frozen five values and its frozen meaning as a *session* lifecycle. The
    richer work state rides on the new `activity` key, whose vocabulary is the **seven** census
    states, `unknown` included.
  - Three §5 narrowings, each a documented judgement rather than a mechanical consequence:
    `mailboxDepth` drops `queueDepth`'s `messages` (the ids embed a stage slug close enough to a
    subject); `activity` is a state label and never the census `reason`/`evidence` derived from
    captured terminal text; `slots`/`slotQueues` omit the operator-prose `reason`. `task` is an id
    gated by `^[A-Z]+-[0-9]+$`, **omitted rather than coerced**.
  - New fixtures at `topology/fixtures/presence-v1-header/`. The frozen directory is untouched, and
    the acceptance test is that the **frozen `validate_presence.py`, unmodified, passes every
    extended fixture** — with `n01-repo-role-designer.json` proving it still goes red for a
    `repoRole` outside the frozen set, which is the evidence that opening a closed vocabulary is
    `schemaVersion: 2` and not additive. Wired into the suite as
    `tests/unit/topology-presence-header.test.mjs`, not asserted in prose.
  - `topology/HEADER-EXTENSION-COUNTERSIGNATURE-REQUEST.md` is the request to the gateway
    coordinator. No producer code emitting the new keys merges before it is countersigned.

- **Liveness census (TM-131, EP-018).** `topology/lib/census.mjs` and the repo-scoped
  `ao-topology census [--json] [--watch]` answer what every agent in a repository is *doing*:
  `dead > quota-blocked > attention > working > needs-input > idle > unknown`, in that precedence.
  Presence v1 is untouched — its `LIFE` set is a session lifecycle, not a work state, and the
  census writes its own document at `<stateRoot>/census/<repoKey>.json`.
  - Busy detection is the Unicode Braille Patterns **range** U+2800–U+28FF in the pane title or the
    captured tail, plus a short measured marker list — not a per-CLI spinner table.
  - `needs-input` is **edge-triggered exactly once**, when a post-busy idle streak first reaches two
    polls; it then falls back to `idle` with `needsInputAt` retained. A pane never observed working
    never produces it.
  - `unknown` is never silently `idle`: a failed capture, an exhausted capture budget and a failed
    `list-panes` are all reported as unknown.
  - `--json` serves a human and a scheduler from one document; the scheduler reads `binding` and the
    derived `dispatchable`, and a **stale census makes nothing dispatchable**.
  - Cost: reuses the supervisor's single `list-panes -a`, decides most panes from the pane title
    alone, captures only inconclusive panes with `-S -20`, caps captures at
    `AO_CENSUS_CAPTURE_BUDGET` (default 8) per tick oldest-observation-first, and memoizes by
    `(paneId, panePid)` so a respawn invalidates.
- **The census rides the supervisor's L3 tick (TM-131).** `superviseRepository` takes one census
  per tick — **including the cheap ticks**, since putting it inside the `AO_RECONCILE_MIN_MS`-gated
  body would peg it to the 10 s floor and the 2 s rung would buy nothing. On a reconciling tick it
  reuses the `list-panes -a` that `collectPresenceAgents` just took (by wrapping its injectable
  `listPanesFn`); on a cheap tick it takes one of its own against exactly the servers the roster's
  bindings name. Each tick's report gains a `census` block (`at`, `tick_ms`, `captures`, per-state
  counts, `dispatchable`) so `supervisionStatus` and `doctor` see it for free.
  - **The census cannot pin the sleep ladder.** `census.activity` means the world *moved*, never
    that we looked: a pane still `working` is the steady state and contributes nothing, and neither
    does a transition into or out of `unknown`, which past the capture budget is the budget
    rotating rather than news. A quiet repository still walks 2 s → 5 s → 15 s and stays there.
  - The loop **tells** the census its cadence rather than the census owning one: `intervalMs` is
    recorded in the document as a hint, and `staleAfterMs` is bound to the **slowest** rung (45 s)
    so a document never reads stale merely because the loop backed off. A one-shot with no loop
    behind it falls back to the slowest rung, not the fastest.
- `listServerPanes` carries `pane_title` — one extra tab-separated column on a call the supervisor
  already makes, which decides "is this agent working" for every pane on the server at zero extra
  tmux calls.
- **Delivery is a state machine, not a fire-and-forget bell** (TM-130). New `topology/lib/delivery.mjs`
  observes each transition instead of assuming it: `held` / `not-typed` / `typed-unsubmitted` /
  `submitted` / `engaged` / `submitted-inert` / `escalated`. Classification (`classifyLanding`,
  `nextDeliveryRung`, `decideBell`, `decideResubmit`) is pure and the I/O is separate, so the whole
  ladder is testable with a stub client and no tmux server. The retry ladder is cheapest-rung-first and idempotent: a stuck
  draft is recovered by sending the submit key **alone** (never re-typed — re-typing appends a second
  copy to the draft), a never-typed pointer goes back through `deliverPointer`, and nothing re-sends
  the message of record. Each rung is gated for what that rung actually does: typing requires an
  empty composer, pressing the submit key requires everything except that — `typed-unsubmitted` IS a
  non-empty composer, so a shared gate would have made the only rung that can fix a stuck draft
  unreachable. Ring bookkeeping lives in `run.json` under `ring_state[messageId][agentId]`,
  written through the existing `.mailbox-sequence.lock`.
- **`providers/*.json` gain a measured `composer` block** (`empty_tmux_pattern`, `empty_pattern`,
  required `note`), validated by the newly extracted `assertTmuxPattern` in
  `topology/lib/providers.mjs`. Absent means absent: an adapter with no measured composer is
  `ring_capability: "unsupported"`, holds its mail and reports — it never rings blind, and it never
  defaults to `ready.tmux_pattern`. Shipped for claude, codex and kimi; grok, gemini, copilot and
  generic are deliberately left without one.
- Engagement without a model turn: `pipe-pane -o` is already attached at pane creation, so
  `observeEngagement` reads `agents/<id>/pane.log` growth past the offset recorded at submit. No
  growth in `AO_ENGAGE_MS` is `submitted-inert` — TM-122 caught for the price of a `stat()`. A
  missing or late-attached log reports **unknown**, never inert.
- **The doorbell is wired into `send`** (TM-130). `ringMessage` now drives every local recipient,
  the child-workflow branch rings the child conductor in the CHILD session, and `delivered[]` stays
  additive — `rang` is still the boolean discriminator and everything new lives under `delivery`.
  `notification` widens to `submitted`, `no-safe-bell`, `ring-skipped`, `stuck-in-composer`,
  `ring-failed`, `stale-binding` and `submitted-inert`; **`durable-pending` keeps its meaning
  exactly** — the file is in the mailbox and no bell was rung, which is what an adapter with no
  measured composer still reports.
- **`--no-ring` is implemented.** It had sat in `USAGE`, in `tests/live/two-projects.sh` and in
  `tests/contract/topology-tmux.test.mjs` since `send` was written, and the body never read it.
- **`ack --run --agent --message [--note]`** — an optional receipt in the journal. Nothing in the
  protocol requires it and no state depends on it: engagement is a `pane.log` byte offset.
- **Escalation is never silent.** `send` journals `message.undelivered` and exits **3** — only when
  the pane was judged safe and the pointer still did not land, never for `held`, an unsupported
  adapter, `--no-ring`, or a degraded supervisor. `status` gains an `undelivered` field and an
  `! UNDELIVERED` banner modelled on `! STALLED`.
- **Named serial slots with a mechanical queue (TM-132, EP-018).** `topology/lib/slots.mjs` and
  `ao-topology slot request|release|status|grant` replace the conductor's hand-rolled
  SERIAL SLOT REQUEST / GRANTED / RELEASED heredocs. Records live at
  `<stateRoot>/slots/<repoKey>/<name>.json`, keyed by the git common directory, so every linked
  worktree shares one `cutover` slot. `integration`, `cutover` and `deploy-safe` are names, not code.
  - `withLock` is the wrong holder and the right mutex: it serialises every mutation, and **the
    record is the holder**. Slot lifetime and lock lifetime are unrelated.
  - Fairness is a monotonic decimal-string **ticket** allocated under the lock — FIFO by ticket,
    never by timestamp, because clocks tie and skew. A repeated request by the same agent is
    idempotent (same ticket, same position, and no write at all).
  - **The grant is mechanical.** `reconcile()` is pure and idempotent, runs from `slot request`,
    `slot status` and the supervise tick, and grants the head of the queue unconditionally when the
    holder is null. `slot release` only clears the holder. A handover costs **zero model turns on
    both sides**. `slot grant --to` is a lead-only override that records the tickets it jumped, and
    its help says so.
  - Liveness is the **tmux six-tuple**, not a pid, so reclamation works identically on macOS, and
    the same test applies to queue entries as to the holder — otherwise a dead ticket starves the
    queue forever while `status` reports success. A grant records the binding it was checked
    against. `failoverAgent` re-stamps that binding after a respawn, or every quota failover would
    silently forfeit the agent's slot.
  - **Age never reclaims.** `status` reports `held_for_ms` and flags a hold past its declared
    `--expect`; the remedy for a long hold is a human. **Reclamation requires proof of absence** —
    an unreadable `list-panes` reconciles nothing, because a tmux hiccup must never hand one
    cutover slot to two agents.
  - Release requires proof the holder is asking, with two accepted proofs because `AO_AGENT_TOKEN`
    is minted per agent *per run* and a standing lead has none: a run agent proves its token digest
    with `timingSafeEqual` as `recordReply` does; a standing agent proves `AO_AGENT_ID` +
    `AO_CONSUMER` + the exact pane as `acknowledgeEnrollment` does. Neither →
    `TOPOLOGY_SLOT_NOT_HOLDER` with the record byte-identical.
  - The supervise tick reuses the pane listing the census already took, so a mechanical grant costs
    zero extra tmux calls, and rings the new holder through the existing standing mailbox with a
    grant-derived id so a retried tick delivers nothing twice.

### Changed

- **The lifetime-lock owner is the authoritative repository supervisor (TM-162, EP-019).**
  - Only the process that holds the supervision lock writes `<key>.process.json`. The record holds
    the pid, process identity, lock token, canonical consumer, source entrypoint and fingerprint,
    and restart count.
  - A supervisor that lost the lock can no longer overwrite or retire the winner's record.
  - `startRepositorySupervision` normalises the consumer to its repository root and waits for the
    spawned child to take the lock. The wait is bounded: `AO_SUPERVISION_START_TIMEOUT_MS`,
    10 s by default.
  - **`supervisionStatus` reports new states.** It reports `running`, `ownership-record-mismatch`
    or `running-without-lock` in place of `running-or-ownership-unknown`. Any consumer matching on
    the old state name must be updated.
  - `doctor` raises `SUPERVISOR_OWNERSHIP_MISMATCH` and `SUPERVISOR_UNFENCED`.

- **The supervise daemon stops narrating itself to every console hosting the monitor.** It ticks
  every 2–15s forever and streamed each report to stdout as a multi-line JSON blob, so a monitor
  host printed one every couple of seconds. The daemon is now quiet unless `--json` is passed;
  `supervise --once` still answers in full, because a one-shot invocation is a human asking a
  question. Two reports still speak unconditionally, because nothing else records them:
  `stopped: consumer-gone` (the deliberate retirement from TM-139) and `presence_beats_degraded`
  (a heartbeat that could not observe tmux, otherwise invisible while presence quietly ages out).
  Per-tick detail was already redundant: every publish writes `generatedAt`, `revision` and
  `staleAfterMs` into the presence document, `readCensus` re-derives staleness from it at read
  time, and `presence watch` delivers a callback per publish for anything wanting a push.
- **The `ao-supervise` monitor description is one line instead of a paragraph.** It was 738
  characters and the host echoes it as the headline of every event, so the description itself was
  most of the noise. Trimmed to the three facts that matter operationally — read-only, launches
  nothing, a second supervisor for the same repository exits. The reasoning it carried is still in
  the code comments at `topology/cli.mjs` and `topology/lib/supervision.mjs`.
- **An out-of-quota Kimi is now an actionable *attention*, not a bare failure — this changes launch
  behaviour, not only the census.** `attention_patterns` entries gain an optional `state`
  (`attention` by default, or `quota-blocked`), and `providers/kimi.json` declares one anchored on
  the fragment `reached your \d+-hour usage limit` — observed live as
  `Error: [provider.auth_error] 403 You've reached your 5-hour usage limit.` and deliberately
  anchored on the fragment, because `[provider.auth_error]`'s brackets and colon would be dropped
  by `tmuxFailureTrigger` and the pattern would then never fire on the subscription path at all.
  `attentionOnScreen` is checked **before** `failureOnScreen` in both `evaluateScreen` and the
  subscription path, and the generic `failure_patterns` list already contains `usage limit`, so
  until now an out-of-quota Kimi was a plain failure that triggered failover. It is now an
  attention with an operator message. That is the right ordering — "wait for the window" is not
  "this provider is down" — but a run that relied on failover to move off an exhausted Kimi will
  hold instead.

### Fixed

- **Two topology unit tests raced a supervisor daemon (EP-019).**
  - **The `send` guard.** TM-162 makes `send` wait for its self-started `ao-topology supervise`
    child to take the lock, and that child lists tmux panes at once, so the old "tmux never ran"
    check lost the race.
    - It now runs the child with `TMUX=''` and its own `TMUX_TMPDIR`.
    - It stops the child before deleting the run directory.
    - From recorded calls, it asserts that only the supervisor runs tmux and that nothing sends
      keys, pastes or loads a buffer.
    - Before this change the test inherited the caller's `TMUX` and could reach the operator's
      tmux server once its fake `tmux` was deleted.
  - **The supervision tests.** They now stop their daemon before removing its state directory.
    Removing it first caused an intermittent `ENOTEMPTY` teardown failure (3 in 32 runs). The
    same cleanup order remains in other topology tests; TM-171 tracks it.
- **Session hosts and worker runs no longer get killed by their own memory cap.** Both scopes
  launched with `MemoryMax=8G`; hitting it OOM-killed a process and `OOMPolicy=stop` then ended the
  whole scope. They now launch with `MemoryHigh=12G` (reclaim and throttle, never kill) and
  `ManagedOOMPreference=avoid`, so systemd-oomd picks other cgroups first. `TasksMax`, `prlimit` and
  the 30 s provider probe's `MemoryMax=2G` are unchanged.
- **The late-ack fix was unreachable from its two real callers** (TM-161, EP-018). TM-161 made the
  probe outlive its wait — and on a live pane the lead still read `unresponsive` three asks in a row,
  because neither caller ever used the default it raised.
  - `cli.mjs` passed `Number(flags['ack-timeout'] || 5000)` on **every** `lead` call, so
    `DEFAULT_ACK_TIMEOUT_MS` — raised to 30s and made env-configurable precisely because a probe has
    to fit a model turn — was never consulted, and the documented `AO_LEAD_ACK_TIMEOUT_MS` did
    nothing. The probe's `expires_at` was five seconds away, so a busy lead's next-boundary ack was
    refused as STALE rather than accepted as LATE. Measured: the probe file appeared and vanished
    within ~5s against a nominal 150s window. The flag is now passed only when given.
  - `startup.mjs` passed a hardcoded `1000`. That path is a fast readiness SCREEN on a SessionStart
    hook for every Claude session on the machine, so it cannot wait for a model turn — but a
    one-second probe is worse than none: nobody can answer inside it, it burns a ring, and its expiry
    then defeats the late-ack path from a caller that never intended to wait. `ackTimeoutMs: 0` now
    means **cached proof only, mint nothing**; a screen asks, it does not interrogate, and "not
    proven" is an honest answer for it to give.
  - **Verified live, which is the only place this was ever visible:** three consecutive
    `unresponsive` before, `responsive` on the first ask after, and a delivered message reporting
    `submitted` with the reply in the outbox. The unit suite passed throughout both states, because
    it exercises the library directly and never goes through either caller's argument construction.
- **A late acknowledgement is no longer thrown away** (TM-161, EP-018). `defaultResponsive` deleted
  the probe when its wait gave up, so an agent that was mid-turn when the ring landed — the NORMAL
  case for a working agent, and the one the file-only design existed to serve — read the probe at its
  next boundary, ran `ao-topology lead ack` correctly and promptly, and met
  `TOPOLOGY_LEAD_PROBE_UNKNOWN`. Responsiveness was provable only by an agent that happened to be
  idle at the instant of the ring.
  - The probe now outlives the wait, up to its own `expires_at`, and the next readiness check
    accepts an ack it finds there rather than minting a new nonce. **`expires_at` is still the line**
    — accepting a LATE ack never becomes accepting a STALE one — and an expired probe is swept.
  - Found by executing the committed EP-018 demo runbook, which is what that runbook is for. The
    lead diagnosed it on its own pane: *"they expired inside a single tool call … This message is
    the proof of liveness the probes were asking for."* It was right.
  - The reviewer's half carries the same rule and the same line.
- **A delivered message no longer reports `stuck-in-composer`** (TM-160, EP-018). TM-151's styled
  composer check reached the safe-to-ring path (`checkBellSafe`, `whenSafe`) and not the landing
  verdict, which still used the plain-text pattern. So a message that was genuinely submitted, onto a
  pane that then rendered a dim suggestion, classified as `typed-unsubmitted`, exhausted the resubmit
  rung and escalated. Observed live: the scribe and the checker were both reported stuck while their
  replies sat in their outboxes. Wrong in the safe direction — it never claimed a delivery it did not
  have — but it fires `undeliveredMessages` and the `! UNDELIVERED` banner for messages that landed,
  and a signal that cries wolf stops being one. Both paths now ask the same question.
- **Three first-run conditions an operator used to meet as a stalled pane** (TM-155, EP-018). All
  found by running the demo four times, and all knowable before anything is launched.
  - **`doctor` reports `CLAUDE_FOLDER_UNTRUSTED`.** Claude Code asks "Is this a project you created
    or one you trust?" the first time it opens a directory, and the highlighted answer is
    `❯ No, exit`. The layer handles that correctly — TM-111's guard means nothing types at an
    attention screen — so the failure is silent by design: `lead ensure` reports "Provider is not
    accepting startup instructions; session preserved" and the pane waits for a human. Reported with
    the one-line remedy, and stating that the question is asked **per repository, not per agent
    directory**: a trusted repo's agent subdirectories inherit it, which is the correction to this
    task's original framing.
  - **A `TMUX_TMPDIR` too long for a unix socket is named before tmux answers.** `sun_path` is 104-108
    bytes and tmux builds `$TMUX_TMPDIR/tmux-<uid>/<name>`, so a per-session scratch directory
    exceeds it. tmux says "File name too long", which reads like a filename problem and is not.
  - **A prompt refusal names the key that is wrong.** `composePrompt` always returned `errors` with
    the layer, path and note; several refusals discarded them and said only "Invalid lead prompt;
    refusing restart." Both shapes that actually occur now say so — a template override that copied
    the default `./prompts/lead.md` (relative to the layer that declares it, so in a repo config it
    points at `<repo>/prompts/lead.md`), and a partial override, since a template is replaced rather
    than merged.
- **A readiness probe nothing woke anybody up for** (TM-157, EP-018). `reviewerProbeReady` wrote a
  nonce file and waited **one second** for the agent to notice it "at a safe boundary". That is the
  right answer for an agent mid-turn and no answer at all for an IDLE one: it sits at an empty
  composer with nothing to do, never polls again, never sees the probe, and reads `unresponsive`
  forever — so `reviewer.available` (registered AND alive AND responsive) is false and every
  governed launch refuses with `TOPOLOGY_STARTUP_NOT_READY`. Both `lead.mjs` and `reviewer.mjs`
  carried comments claiming the probe "rings the pane". Neither did.
  - The probe now **wakes** the pane through `wakeForProbe`, under the bell's own rules — alive,
    six-tuple unchanged, composer provably empty, no attention or failure screen — and the ring text
    carries the exact line to reply with, so it does not depend on any prompt file having mentioned
    the protocol.
  - **The file-only path is unchanged and still the fallback.** A pane that is busy, moved, dead or
    showing a modal gets nothing typed into it, and the probe degrades to precisely the old
    behaviour. TM-111 is the reason: a composer-shaped match on the folder-trust modal is what makes
    a keystroke dangerous rather than safe.
  - `AO_PROBE_TIMEOUT_MS` (default 20s) replaces the 1s window, and `AO_PROBE_POLL_MS` (default
    500ms) replaces a 25ms spin that would have cost ~800 captures of one pane per probe.
  - **The independence guarantee is untouched.** The reviewer still runs `--restricted --safe-mode`
    with no shell; its READY signal was always a printed line, which is why this needed no new
    permission. Anyone tempted to "fix" this by handing the reviewer a shell should read TM-157: it
    would satisfy neither cause and would remove the only thing making the reviewer read-only.

- **A re-assignment could collect the previous round's reply (TM-135).** The assignment envelope id
  was a pure function of (repo, task, agent), so releasing a task and handing it back to the same
  agent recomputed the same id, the standing mailbox deduped to the already-delivered envelope, and
  the old reply was read as the new round's completion signal. The id now carries the round.
- **The census could name an agent that had already gone (TM-135).** A census is up to 45 s old at
  its staleness bound, so the six-tuple is now re-proved under the assignment lock before the write.
- **A refusal mid-way through a multi-recipient send could partially deliver** (TM-143, EP-018).
  TM-142 fixed the *broadcast* refusals by resolving addresses before allocating a sequence number.
  The refusals raised inside the per-recipient loop — `TOPOLOGY_ROUTE_BLOCKED`,
  `TOPOLOGY_ROUTE_NO_LEAD`, `TOPOLOGY_ROUTE_LOOP`, `TOPOLOGY_UNKNOWN_AGENT`,
  `TOPOLOGY_COORDINATOR_NOT_A_WORKER` — still threw with the envelope already persisted, and once
  several recipients were addressed at once they threw *after* the recipients ahead of the refused
  one already had an inbox file. The sender saw an error, some agents had the message, and
  `run.json` said a message existed.
  - **Every local recipient is now admitted before anything is written.** `sendMessage` runs one
    resolution pass above `nextSequence`: the router is consulted once per recipient and the five
    refusals are raised there, where a refusal consumes no sequence number, writes no envelope and
    writes no inbox file. The write pass reuses the admitted decision rather than re-calling the
    router, so a policy that changes in between cannot admit one pass and refuse the other.
  - **Prevention, not rollback, and for the reason TM-142 already gave.** A sequence number cannot
    be handed back. Unwinding inbox files has the same shape of problem one level down: the unlink
    races the pointer delivery that may already have woken the recipient, and a message an agent has
    begun reading cannot be made not to have been read.
  - **The five refusals live in one `assertRoutable` helper**, called by the admission pass and
    re-asserted against the roster `nextSequence` returned, so the two passes cannot drift about
    what a refusal is.
  - **One residual is named rather than hidden.** The standing/external branch is not pre-flighted,
    because its delivery *is* its admission — `sendStandingMessage` runs canonical routing itself
    and reports a refusal as a hold, not a throw. The single reachable case where a refusal can
    still follow a delivery is an assignment that the standing router redirected onto a local
    `coordinates_only` agent; a standing delivery cannot be unwound, so it throws with the delivery
    recorded rather than pretending it did not happen. Documented at the branch.

- **A run agent with an unrecognised role vanished from presence entirely** (TM-136). Inside the
  run-agent loop only, `collectPresenceAgents` did `if (!ROLES.has(agent.role)) continue`, so
  `add()` never ran and an `image-gen` run agent — or a `lead`, which a run spec never carries
  because a repo lead appears in its own run as `orchestrator` — had **no entry in the snapshot at
  all**, not merely a wrong label. A *standing* `image-gen` role-session was unaffected. An unknown
  library role now maps to the nearest legal token (`runRole: "worker"`; `repoRole` already
  defaulted to `member`) with the truth carried in the additive `roleName`, so nothing is dropped
  and nothing is misdeclared in a field a consumer validates. `topology/lib/spec.mjs`'s identical
  list is left alone: there it only feeds an advisory message, `ID_PATTERN` is the real gate, and
  `image-gen` passes it.

- **Sandbox teardown no longer fails on a provider's Go module cache.** An agent that ran
  `go build` or `go test` left `go/pkg/mod` inside its sandbox HOME with directories at mode
  `0555`. Unlink needs write on the *parent* directory, so cleanup died with
  `EACCES: permission denied, unlink '/dev/shm/.../provider-home/<provider>/go/pkg/mod/.../LICENSE'`
  — `fs.rm({ force: true })` does not help, because `force` only swallows `ENOENT`. Every broker
  and turn-scratch removal now goes through `removeTree`, which restores write on its own
  directories and retries once. Symlinked directories are not followed, so it cannot chmod outside
  the tree it owns.
- **`providers/codex.json`'s ready pattern never matched.** Re-measured 2026-09-09 against tmux 3.4
  on a live idle codex pane: the shipped `^\s*[›>❯][^a-zA-Z0-9]*$` answered **0**, while
  `^\s*›\s*Ask Codex to do anything` answered 16. An empty codex composer renders that placeholder
  and the old pattern forbade letters after the glyph, so every codex agent burned its full 30s
  `timeout_ms` and was then reported as a slow agent. Both the JS and the tmux form are corrected.
- **`ControlClient` and `waitForChannel` ignored the tmux server prefix** (TM-130). Both spawned a
  bare `tmux`, with none of the `-L`/`-S` every call through `tmux()` gets. On a run started with
  `--server <socket>` the control client attached to the DEFAULT server, found no such session, and
  every agent fell back to polling — correctly, quietly, and for entirely the wrong reason. Both now
  take an optional `tmuxServer` and apply the shared `serverArgs()` prefix, and
  `clearAndWaitForShell` passes it to the waiter and to the command it types into the pane so the
  two name the same server. **No caller passes one yet**, so behaviour today is unchanged — this is
  the seam, and it is untested on a non-default socket.
- **Mail wording, applied from the `BEGIN_CLAUSE` lesson** (TM-122). `bootstrapText` and
  `prompts.mjs` now say: do the work in the same turn you read the message, do not stop to confirm
  receipt and wait to be told to continue, and if you are blocked still write a reply saying what is
  missing.
## [0.7.1] — 2026-09-09

TM-139. A supervisor died on startup whenever its working directory had been removed, and said
`state: "starting"` while doing it. Found by the logging added in 0.7.0, which is the first time
this failure left any trace at all.

### Fixed

- **`absolutize()` consulted the cwd for paths that were already absolute.** `base` was a default
  parameter (`base = process.cwd()`), and a default parameter is evaluated on every call where the
  argument is undefined — including the absolute-path branch that never reads it. `process.cwd()`
  throws `ENOENT … uv_cwd` inside a process whose working directory has been unlinked, so
  `ao-topology supervise --consumer /abs/path` died resolving a path it had already been given in
  absolute form. `tm` removes a task-owned worktree after a verified merge, so this is a routine
  case, not a test artifact. `base` is now resolved lazily, on the relative branch only. All 19
  call sites were checked: none depended on the eager evaluation, and a `null` base — previously a
  `TypeError` — now falls back to the cwd like an omitted one.
- **A supervisor that lost its repository ran forever.** Fixing the crash above turned a
  self-clearing failure into an immortal daemon spinning against a deleted path. The tick now
  checks that its consumer still exists, retires with `state: "consumer-gone"` and `stopped_at`,
  and exits.
- **Two unit tests wrote into the developer's real `~/.local/state`.** `send` self-starts a
  supervisor as of 0.7.0, so `tests/unit/topology-mailbox.test.mjs` — which shells `cli.mjs send`
  without pinning `AGENT_ORCHESTRATION_STATE_HOME` — spawned a real background daemon per run and
  orphaned its record when the temp dir went away. That is where all ten stale records came from.
  The state home is now pinned, and tests that start a real daemon reap it before removing the
  directory it writes to.

### Changed

- **The process record advances past `starting`.** The first completed tick promotes it to
  `state: "running"` with `first_tick_at`, so a startup crash is now mechanically distinguishable
  from a supervisor that has only just been spawned.
- **`supervisionStatus` names the failure instead of calling everything `down`**: `never-started`,
  `running-or-ownership-unknown`, `died-before-first-tick`, `retired-consumer-gone`, `orphaned`,
  `down` — plus `consumer_exists`, `record_state`, `record_path` and `stopped_at`.
- **`doctor` gains `SUPERVISOR_NEVER_TICKED`** (died during startup; read the log) and
  **`SUPERVISOR_ORPHANED`** (a record naming a directory that no longer exists, which no restart can
  reclaim — debris, with the exact file to delete). A clean `retired-consumer-gone` is not a fault
  and raises nothing.

## [0.7.0] — 2026-09-09

TM-127 / EP-018. The supervisor is now started and kept honest, and its tick stops behaving like a
busy loop.

### Added

- **`monitors/monitors.json` — the supervisor runs as a plugin monitor (`"when": "always"`).**
  `startRepositorySupervision` was reachable only from `enrollment ack`, `lead ensure` and
  `lead assign`: three one-time setup paths. Reboot the machine or let the detached process die and
  nothing brought it back, so the Presence v1 heartbeat stopped and every consumer read the
  repository as permanently stale. One entry, not two, because `ao-topology supervise` already runs
  `superviseRepository` and the host-scoped `watchServer` concurrently.
- **Self-start from `launch`, `session open` and `send`.** Codex, Grok and Kimi hosts have no
  monitor concept; monitor primary on Claude hosts, first-command-wins elsewhere, both converging
  on the same per-repo lock. Never fatal — a repo with no supervisor is degraded, not a failed
  command.
- **`doctor` reports the supervisor**: state, pid, restart count and the age of the last reconcile
  tick, with `SUPERVISOR_DOWN` / `SUPERVISOR_STALLED` problems. This is the check that would have
  caught the defect above; a repository that never started one is reported, not faulted.
- **`topology/PRESENCE-CONTRACT.md`** — contract revision 3, sha256 `3748e32d26f6f7b3…`, committed at
  the path `topology/fixtures/presence-v1/README.md` had always cited but that never existed —
  the fixtures were an acceptance artifact for a document that had not landed with them.
- `supervisionStatus()` and the exported `nextRung` / `SLEEP_LADDER_MS` seams, with adversarial
  tests in `tests/unit/topology-supervision.test.mjs`.

### Changed

- **The reconcile loop is no longer a 1-second filesystem-and-git busy loop.** Its body is
  `collectPresenceAgents` + `git worktree list` + a `readdir` of every run dir in every linked
  worktree + `refreshPrompt` per agent + `resumeStandingMessages`, and it ran every second. The
  tick sleep is now adaptive (2s / 5s / 15s, driven by an `activity` boolean; any activity snaps
  back to 2s) and the expensive body is rate-limited behind `AO_RECONCILE_MIN_MS` (default 10s).
- **The presence heartbeat is explicitly NOT that cadence.** `createPresenceProducer` now asserts at
  construction that its publish interval never exceeds the frozen contract's `staleAfterMs / 3`, so
  the two numbers cannot be conflated by a later edit. A quiet repository publishes presence more
  often than it reconciles: presence staleness is a contract, reconcile staleness is a hint.
- **Losing the supervision lock is no longer an error.** Linked worktrees share one canonical
  repository id, so a machine with eight worktrees open starts eight supervisors and seven must
  lose. They now exit **0** with `another-supervisor-owns-this-repository` inside the 100ms lock
  timeout, rather than throwing `TOPOLOGY_LOCK_TIMEOUT` — which a monitor host would read as a
  crash and restart in a loop. Measured 8-way: 1 supervisor alive, 7 clean exits.

### Fixed

- **A supervisor that died left no trace.** It was spawned with `stdio: 'ignore'`. Both streams now
  append to `<stateRoot>/supervision/<repoKey>.log` with a start banner, and the process record
  carries `started_at` and a `restarts` counter — a supervisor on its fortieth restart is a crash
  loop, and nothing could tell you that before.

## [0.6.0] — 2026-09-09

### Added

- Repository lead and reviewer registries, configurable templates and one prompt resolver.
- Startup hook/watcher detection, exact session bindings, durable standing messages and holds.
- Presence v1 producer and frozen contract fixtures, task-store-backed review/integration gates.

### Fixed

- Lock ownership races, unsafe prompt fallback, hook sibling deletion and watcher lease fencing.
- Linked worktree identity and cross-repository routing admission.

## [0.5.0] — 2026-09-06

### Added — the run tree (EP-016)

- **Nesting is recorded.** An agent has a shell and `ao-topology` on its PATH, so a conductor that
  wanted a sub-team could already start one — and nothing knew it had. A run now carries `parent`
  (`{run_dir, run_id, agent_id, depth, chain}`, null at the root) and `depth` in its `run.json`, the
  parent journals `run.spawned`, and `children.json` beside the parent is the index `stop` walks.
  The lineage travels two ways because each covers the other's blind spot: the file is the durable
  record that survives the process, and `AO_PARENT_RUN_DIR` / `AO_PARENT_RUN_ID` /
  `AO_PARENT_AGENT_ID` / `AO_RUN_DEPTH` / `AO_RUN_CHAIN` in **every** agent's environment is what
  lets a child nobody planned still record where it came from.
- **A workflow can be a participant in another workflow.** An `agents[]` entry with
  `{ id, workflow, inputs }` joins the run as a team rather than a pane: the conductor addresses it
  by id, sends to it and waits on it exactly as it would an agent, and never learns it is four
  agents in another tmux session. `ao-topology validate` refuses a participant that also names a
  `cli` — it is a team, not a process — and refuses a workflow that names itself, which is decidable
  without launching anything.

  Almost all of it is plumbing over what was already there. `sendMessage` and `recordReply` already
  took a run directory, so a message crossing between runs needed no bridge; the delivery loop
  already skipped an agent with no pane, so that `continue` became "forward into the child instead
  of ringing"; and `agents[].agent` was already the precedent for an entry whose meaning is resolved
  at launch rather than at validation.
- **`reply --token`** is wired. It was named in `recordReply`'s own refusal text and never
  implemented, so an agent following that advice got the same refusal again. It is load-bearing now:
  a child conductor already holds `AO_AGENT_TOKEN` for its own run, so answering upward as a
  participant in its parent needs the other token passed explicitly. The child is handed it as
  `AO_REPLY_TOKEN`, with `AO_REPLY_TO_RUN_DIR` and `AO_REPLY_AS_AGENT` — deliberately not the
  `AO_PARENT_*` names, which point the other way, at the run this agent would itself be the parent
  of. Sharing them would have made one of the two directions silently wrong.
- **`for_each` fans one participant out into a team per item.** An array, or one comma-separated
  string so an input can supply it — `{{item}}` and `{{item.<key>}}` reach each child. Children are
  named after their item (`per-file.src-a-js`), not their position, because the id is what a
  conductor types and nobody can hold `per-file.1` in their head across a run; a slug collision is
  resolved rather than allowed to silently drop a child. The group is addressed collectively by the
  id that produced it — `send --to per-file` reaches every member and `wait --from per-file` barriers
  over all of them — so the conductor never has to track how wide the fan actually was. Capped at
  eight (`--max-fanout`): ten *panes* was measured flat at 9.6s, but ten *children* is ten tmux
  sessions and ten mailboxes, so width costs far more here than depth.
- **`stop` cascades**, depth-first, journalling `run.child_exited` on the parent as it goes.
  Depth-first because stopping top-down orphans every level below the one that fails. `--no-cascade`
  opts out.
- **A workflow cannot enter its own ancestry** (`TOPOLOGY_WORKFLOW_CYCLE`) and nesting stops at
  three levels (`TOPOLOGY_DEPTH_EXCEEDED`, `--max-depth` to raise it). Both refusals name the chain,
  because "this loops" without saying where is not something an operator can act on.
- **A participant answers every pane question as a team.** `capture`, `nudge` and `failover` all ask
  something about a process — what is on its screen, type this at it, restart it on the next
  provider — and a participant has none of those. Each used to fail differently and none of them said
  why: `capture` returned silence, `nudge` leaked tmux's `can't find pane: null`, and `failover`
  reported "no provider left after none. Chain: .". One refusal (`TOPOLOGY_AGENT_IS_A_WORKFLOW`) now
  covers all three and names the child run where the question does have an answer. `status` renders a
  participant as a nested block — the child's state, session liveness, agent count and what is
  awaiting reply there — instead of `on NO PROVIDER [chain: ] pane null`, which read as a broken
  agent when the team was perfectly healthy.
- **A ready pattern tmux can never match is refused at load** (TM-112). tmux searches rendered lines
  one at a time, so a `ready.tmux_pattern` spanning a newline matches nothing, and tmux trims
  trailing whitespace off a line, so one ending in a space class cannot match a prompt sitting at the
  end of its line. Both used to cost the adapter's whole timeout and then report themselves as "ready
  pattern not seen" — a slow agent, not a broken pattern. Measured on tmux 3.4 against a pane showing
  `ready` then `> `: `#{C/r:ready\n>}` answers 0 where `#{C/r:ready}` answers 1, and
  `#{C/r:>[[:space:]]}` answers 0 where `#{C/r:>$}` answers 2. The shipped `claude` and `codex`
  patterns were already written to survive both and stay legal, which the test asserts.
- **The tmux contract test now exercises the path real adapters take.** The fake adapter declared
  only `ready.pattern`, so it took the polling fallback and left `waitReadySubscribed` — the
  subscription path every shipped adapter uses — uncovered. It now declares a single-line
  `tmux_pattern` as well, verified by making the polling pattern unmatchable and watching the run
  still come up ready. Its ready timeout went from 10s to 30s: `node --test` runs the contract files
  concurrently, and under the clean-install contract's load a local node process needed longer than
  10s to draw a prompt.
- **The design-system packaging contract skips instead of failing when the private client is
  absent.** It shells out to `design-client sync --check`, a devDependency from `npm.bytedesk.ai`; on
  a machine that installed without the registry token it failed with `Cannot find module`, which
  reads as a broken packed plugin rather than a missing credential.
- **A benign startup banner no longer kills an agent** (TM-110). Every failure pattern now needs
  failure context rather than a bare noun. `authentication` matched Claude Code's ordinary
  `⚠ 2 MCP servers need authentication · run /mcp` — printed on any machine with an unauthenticated
  MCP server, which is most of them — so a healthy agent was declared a failed candidate in five
  seconds, and on a single-candidate spec never came up at all. `quota`, `capacity` and `billing`
  were the same mistake waiting to happen. `no such file or directory` is deliberately left broad:
  narrowing it to the `: no such file` shell shape would buy precision on the polling path by
  disabling it on the subscription path, because `tmuxFailureTrigger` drops any pattern tmux's format
  parser cannot read. Verified live rather than in a fixture — a real `claude:haiku` agent came up
  ready with that banner on its screen and no repo-local override in play.
- **A CLI waiting on a person says so, in five seconds, in a sentence** (TM-111). Adapters gained
  `attention_patterns` — `{ pattern, message }` entries checked before the generic failure list,
  because these screens are specific where that list is generic, and because the operator's action is
  completely different from a provider outage. Claude's folder-trust modal and its login screen are
  the first two. The launch still walks to the next candidate, since a different CLI may have no such
  prompt, but the outcome now reads "Answer it once in a normal terminal (cd into the agent's cwd and
  run `claude`, choose 'Yes, I trust this folder'), then launch again" instead of
  `ready pattern not seen within 30000ms`. Measured live: 5s and a correct message, against 30s and
  an unexplained timeout.
- **A menu row is no longer mistaken for an empty prompt** (TM-111). The claude and codex ready
  patterns now require the prompt glyph to be the last thing on its line. The trust modal draws
  `❯ No, exit`, which the old pattern matched — so the launcher reported the agent *ready*, then
  typed the bootstrap pointer into a modal whose Enter means "No, exit". Measured on tmux 3.4 against
  two live panes: the real input box is `❯` followed by U+00A0 and nothing else, which the new
  pattern matches at its line while the menu row does not match at all. The report had this the other
  way round — it read as a timeout, not a false ready — which is why it was worth reproducing before
  fixing.
- **An approval says what it actually is** (TM-113). `orchestration_decision_approve` is a state
  gate, not an identity gate: `approvedBy` is an unauthenticated string that nothing compares to the
  run's initiator, so an agent can call the tool and pass any name. Rather than leave that implied,
  the approval record now carries `via` and `by_attested` — `"mcp"`/`false` for a tool call,
  `"session"`/`true` for the loopback session UI, which is bound to 127.0.0.1, needs a capability
  token this process minted, expires in ten minutes and can be exchanged once. `via` is a second
  argument to the service method, not a field of the tool input, so a caller cannot promote its own
  act by claiming the channel; a test asserts exactly that. `AGENT_ORCHESTRATION_REQUIRE_ATTESTED_APPROVAL=1`
  refuses tool-call approvals for architecture decisions outright
  (`AO_APPROVAL_REQUIRES_ATTESTED_CHANNEL`). The tool description, the README and the
  `agent-orchestrate` skill now say plainly that this is a stop-and-attest, not a separation of
  duties — and the skill tells an agent never to pass a person's name for a decision they did not
  make.
- **A dead pane reports what it died of** (TM-119). Liveness and exit status were two separate
  `display-message` calls — one to decide the verdict, one to fetch the number — so a pane reaped
  between them produced `{"reason":"pane exited","exit_status":null}`: a death with no way to tell a
  CLI that rejected its flags from one that was killed. `paneState` answers both in one query, and
  `paneAlive` now delegates to it. Found because the live harness's exit-status assertion failed once
  under load and passed on two clean reruns.

  Probing that turned up a second defect in the same place: **tmux answers an unknown pane id with
  exit 0 and an empty line**, not an error, so `pane_dead != "1"` read a pane that no longer exists
  as *alive*. Measured on tmux 3.4 — `display-message -p -t %99999 '#{pane_dead}'` prints nothing and
  exits 0. An empty answer is now "gone", and the test that pins it fails against the old behaviour.
- **A screen the launcher could not read is no longer reported as a screen with nothing on it**
  (TM-120). `captureAll` returned `""` whenever its tmux call failed — a timeout on a loaded machine
  included — and `""` is exactly what a pane that has drawn nothing yet returns. Readiness therefore
  polled a screen it had never actually read, matched neither the ready pattern nor any failure
  pattern, and blamed the agent. It returns `null` now; the polling loop counts unreadable looks and
  says so in the timeout instead of asserting something about the agent it never observed.

  The subscription path had the same blindness from the other direction: it decides from pushes, so
  if the server delivers nothing, nothing in this process has ever looked at the pane. It now takes
  one direct capture at the deadline before giving up.

  Both are measured, from a captured failing run whose pane logs are the whole argument: all three
  agents were reported as "ready pattern not seen", while the conductor's pane held its ready line
  AND its own `READY` answer, and `worker-a`'s held the usage-limit line whose only purpose is to be
  caught by a failure pattern. Nothing was slow and no pattern was wrong — the launcher was blind.
  The contract test now keeps its scratch tree on failure, which is what made those logs readable.
  Re-run afterwards: fourteen loop iterations, half alongside a full `two-projects.sh`, no failure —
  against failures at iteration 4 and 12 of the same loop before the fix. Evidence, not proof; the
  kept-on-failure tree stays so the next occurrence is readable rather than silent.
- **A conductor starts on its own** (TM-122). Twice, on a first-choice `claude:opus` in a clean
  repository, an orchestrator read its brief, replied READY and stopped — three healthy agents, an
  empty mailbox, no error anywhere. It was complying: the pane's bootstrap message asks it to read
  the brief and reply READY, and the licence to start the mission is the last line of a 118-line
  document it has been told to follow exactly. For a WORKER, replying READY *is* the whole job, so
  the fix cannot be a blanket change to `bootstrap_message` — an agent that invented work for itself
  rather than waiting for mail would be a worse bug than this one. The orchestrator's pointer now
  carries a `BEGIN_CLAUSE` telling it to begin in the same turn, on the same message rather than a
  second one, because a follow-up send would race the agent's own first turn and land in a composer
  busy reading the brief.
- **And a stalled run stops looking healthy.** `status` reports `STALLED` when the orchestrator has
  been up two minutes and has never sent a message, with the nudge that starts it. The check reads
  the whole journal rather than the twelve entries `status` displays: `message.sent` scrolls out of
  that tail within minutes, so a claim built on it would have grown *louder* the longer a run worked
  correctly. Verified both ways against live runs — it fires at 135s on a conductor that never sent
  anything, and stays quiet on one that has.
- **A bootstrap that never arrived is a failure, not a warning** (TM-126). When readiness timed out
  the launcher typed the pointer anyway and said "bootstrap pointer was sent anyway" — a guess. On a
  real client run it was wrong: two Claude agents timed out on their startup banner, the pointer went
  into panes whose TUI had not yet attached a key handler, and the keystrokes vanished. The composers
  were EMPTY, which is what separates this from the paste-and-settle bug where the text is sitting
  right there unsent. Nothing errored; the run held three healthy agents and an empty mailbox until a
  human noticed. The pointer is now confirmed on the pane, retried up to three times, and a delivery
  that never lands fails the candidate instead of reporting it as started.
- Two things the test for it caught in the fix itself. **Occurrences are counted, not looked for** —
  `captureAll` reads the whole scrollback, so on a failover the previous attempt's echo would confirm
  a delivery that never happened. And the "not listening" pane in the test is a **raw-mode** fixture
  rather than `sleep`: a process that merely ignores stdin still has the tty echoing what is typed at
  it, so the text appears and the check passes — the first version of the test passed against the
  bug for exactly that reason.

### Changed — the noun is "workflow" (EP-016)

- **Templates are workflows.** `ao-topology workflows` lists them, `--workflow <name>` launches one,
  `compose --save` writes to `workflows/`, and the plugin's own specs moved to
  `agent-orchestration/workflows/`. Nothing breaks on the way: `templates` and `--template` still
  work undocumented, and every search location is looked up under both names — new first, so a repo
  holding both runs the new one. A repo that never renamed anything needs no migration step, which
  the live harness asserts end to end rather than trusting.
- **The stage list is `stages:`.** One word was doing two jobs the moment a spec could name another
  spec: `workflow` for the steps of this run, and `agents[].workflow` for a whole other run. Specs
  are committed data in repos this rename does not get to break, so a top-level `workflow:` is still
  read — normalized to `stages` so nothing downstream sees two spellings — and `validate` reports it
  as deprecated rather than accepting it silently. `run.json` writes both keys for one release, so a
  consumer pinned to 0.4.0 can still read a run this version wrote. `ao-topology schema` now names
  `stages`, marks `workflow` deprecated with the collision that caused it, and documents
  `agents[].workflow` and `agents[].for_each` — the schema summary is what a composing agent reads,
  so a feature missing from it may as well not exist.

## [0.4.0] — 2026-09-05

### Added — the topology layer becomes a durable team (EP-014)

- **A per-repo agent library.** Agents are now a resource type like templates, skills, roles and
  providers, stored at `<repo>/.bytedesk/agent-orchestration/agents/<id>/` and resolved through the
  same four-tier search path. `ao-topology agent new|list|show`. A spec entry may reference a stored
  agent instead of restating it, with any inline field overriding the stored definition.
- **Durable identity.** An agent gets a short id minted once and never changed — the address every
  machine surface uses — plus a generated first name, last name and role-derived title, which is
  what people see. The two are generated independently, so a name collision can never disturb an
  address. The never-show-the-id rule is scoped to human surfaces; journals, session names,
  envelopes and spec agent ids carry it deliberately.
- **One lead per repository**, enforced at creation. A lead may be `coordinates_only`, which is a
  capability rather than an instruction: it is launched with no directory granted beyond its own and
  with its write tools removed by its adapter's `coordinator_args`. The lead is the only address an
  outsider may reach directly, so it is the most exposed agent and should be the least capable.
- **Cross-repo routing, enforced at the mailbox.** An unvouched contact from another repository is
  redirected to that repository's lead, with the original addressee preserved as `intended_for`, a
  `route.redirect` journal event, an explanation in the delivered message and an acknowledgement to
  the sender. A `via` chain (`send --via`) plus a hop limit stops re-forwarding and lead-to-lead
  loops.
- **Delegation tokens that cannot be forged by the sender.** A token is a pointer; the permission is
  the `tm` claim it names, held in the *receiving* repo's own task-management store and re-read on
  every use. Closing the task revokes the delegation with no revocation step.
- **Outbox authentication.** Each agent's launcher exports a token minted for it alone, and the run
  record stores only its digest — enough to check with, never enough to forge with. `reply --agent`
  is no longer a claim taken on trust, and an empty reply file no longer satisfies a barrier.
- **Per-agent memory.** Library agents run from their own directory, so on a CLI that keys session
  state by working directory two agents in one repo no longer share memory. The repo is granted
  through the adapter's own `add_dir_args`. Every shipped adapter now declares its memory scope and
  its grant mechanism, recorded from measurement.
- **Durable role-sessions** (TM-096). `ao-topology session open|list|close` gives an agent a named
  workspace keyed to its stable id rather than to a run — one you call, not one you launch. `open`
  on a live session reattaches to the same pane instead of creating a rival, so the identity
  survives the process that created it. The session record lives beside the agent, never inside a
  run directory that will be torn down, and names one idempotent restore command: gateway tab
  restore rebuilds from a tab record's stored `Command` when the tmux session is gone, so a
  role-session started any other way would be silently recreated wrong.
- **Sessions addressed by who is running** (TM-101). A run of one library agent is a spawn of that
  agent, and its tmux session is now named `<agent id>-<discriminator>` rather than
  `<spec name>-<run id>`, so `tmux ls` answers who rather than only what. Two concurrent spawns of
  one agent stay separately addressable; the discriminator's uniqueness scope is live sessions on
  this host, probed rather than assumed. `parseSessionName` resolves a name back to agent and spawn,
  and `session list` files live spawns under the agent that owns them. Teams and inline agents stay
  run-addressed — a team has no single answer, and an id written in a spec file is a label local to
  that file rather than an address.
- **Event-driven readiness and death** (TM-099). Readiness is now a `refresh-client -B` subscription
  on one control-mode client per session — the server pushes when a pane's content actually changes,
  so a quiet pane costs nothing and ten agents cost what three do. Deaths arrive through a
  `pane-died` hook carrying `#{pane_dead_status}`, the process's real exit code, instead of being
  discovered by a later poll. `pipe-pane` attaches before the shell is touched, so the output that
  explains why an agent never came up is no longer the part that gets lost. Agents start
  concurrently: measured flat at 6.4s for three and 9.6s for ten against a 6.2s single-agent
  baseline, where a serial launch costs agents x ready-time.

### Fixed

- **`bin/ao-topology` was not executable.** It was the only file in `bin/` without the bit, so every
  consumer invoking it got `Permission denied`.
- **`codex.json` shipped `--full-auto`**, which the installed Codex rejects outright. Replaced with
  the approval and sandbox flags that version actually has.
- **Readiness could never fail, and could pass on a shell prompt.** Nothing waited for the shell, so
  a slow rc file swallowed the launcher keystrokes while polling matched what the shell had drawn; a
  `tmux wait-for` nonce is now a real barrier, and the snapshot taken at that moment separates shell
  output from agent output. The fixed-delay path can now report not-ready, and failure patterns no
  longer fire on a word that appears only inside a path.
- **Three guards that were wired but could never fire**: `--allow-outside` was checked and never
  set; `issueDelegation`'s `coordinates_only` refusal never received the agent record; and the hop
  limit could not be reached because `send` accepted no `via` chain.
- **Routing failed open twice** — an unresolvable recipient was delivered as addressed before the
  external-sender check ran, and project identity was a raw string compare that a trailing slash or
  a symlink defeated.
- **`leadQueueDepth` measured a queue nobody fills**, selecting on a role no run agent has.
- **Readiness intermittently threw away the output it was waiting for.** The anchor separating an
  agent's output from the shell's was a SNAPSHOT of the freshly-cleared pane — which is pure
  whitespace whenever the prompt has not finished redrawing. A whitespace anchor matches inside the
  blank tail of a later capture just as readily as at the point it was taken, so the slice landed
  past the ready line and returned nothing: the agent never looked ready and paid its whole timeout,
  with the outcome depending on nothing but how fast the shell redrew. The pane now carries a
  printed unique marker, which can only match where it was printed. The same change makes
  `promptLines` count the prompt rather than the pane's whole scrollback.
- **Every agent past the sixth failed to get a pane.** `split-window -t <window>` splits the ACTIVE
  pane, so consecutive splits halved the same pane — 60 rows to 30 to 15 to 7 to 3 — and the seventh
  agent died on `no space for new pane`. The splits now re-equalize as they go, in one tmux
  invocation so the correctness is free.
- **A shared tmux server silently broke readiness for every agent but the first.** The window took
  its size from whatever unrelated session's client the server last had, so `-x 220 -y 60` came out
  93x20 and the stacked panes 12 columns wide. Readiness is decided by a per-rendered-line content
  search, so `fake-agent ready` wrapped into `fake-agent r` / `eady` and could never match: three
  agents reported one ready and paid the full 30s timeout twice, with nothing in the log saying why.
  The session now pins `window-size manual` on itself and sizes the window for the team, so neither
  our own control client nor a human attaching later reflows the agents.

### Changed

- **Resource paths moved** to `<repo>/.bytedesk/agent-orchestration/<kind>/`, with the legacy
  `<repo>/.orchestration/<kind>/` read as a fallback. The runs directory now ignores itself, so no
  consumer has to edit its own `.gitignore`.
- **A spec may not launch outside the repository that invoked it**, and `auto_approve` requires
  explicit consent (`--allow-outside`, `--allow-auto-approve`).
- `status` reports per-agent inbox depth and the age of the oldest waiting message.

### Documentation

- `docs/adr/0002-provider-credential-lifetime.md` (TM-103) — why a provider credential now stays
  readable inside the sandbox for the length of a run, what that changed in the threat model, and
  the five things that still bound it. The decision was taken in code and never written down; the
  contract test guarding the old behaviour had been failing ever since, so a real regression could
  not be told from the known one. The test now asserts the property that actually replaces
  shred-on-bootstrap: nothing readable survives the run.
- `docs/adr/0001-authoritative-orchestration-layer.md` — the tmux topology layer is authoritative
  for dispatched work; the MCP broker is kept as an opt-in sandboxed backend; `tm` owns the
  worktree. Written against the code, which uncovered two live defects in the existing dispatch
  backend.
- `docs/authorization-classes.md` — fleet's depth-based taxonomy salvaged before that plugin
  retires, plus external inbound as a fifth class. Read it as a specification: fleet implemented
  enforcement for one of its four classes.
- `tests/live/two-projects.sh` — the acceptance harness. Two real repositories, exercised through
  the CLI as a consumer would.

- Add the `design-studio` orchestration template: three panes bound to the design-system repo’s
  own `design-system-studio` director/hands/judge role files, each on its own provider chain, with
  the studio’s director driving the run and the template supplying only the terminals, fallback,
  and mailbox transport.
- Add `claude.fable-5-1` (model `claude-fable-5-1`) to the trusted model catalog and put it first on
  the `architecture.proposal`, `design.default`, `implementation.default`, and
  `provider.claude.default` aliases, ahead of `claude.opus-5` and the `claude.opus-4-8` fallback.
- Accept an optional exact `endpointId` on routing input, validated against the trusted catalog so
  arbitrary model IDs are rejected; it narrows the model allowlist to that one endpoint.
- Add an `image_generation` capability ID, advertised as supported for the Claude provider and
  unknown elsewhere until a probe says otherwise.
- Route Claude work to `claude.opus-5` (model `claude-opus-5`) on every default alias, with
  `claude.opus-4-8` as the deterministic fallback. The Claude Agent SDK ships a static model table
  that lags the CLI, so a build-time esbuild plugin clones the newest Opus entry under the new ID
  and fails loudly if the table shape changes or upstream adds the model itself. Synced from the
  released upstream source; the MCP server now advertises `0.2.3` instead of `0.1.0`.
- Stop every idle server from re-reading every run forever. Each host — claude, codex, grok, kimi —
  runs its own server against one shared state root, and each swept the full store every 5 seconds,
  reconciling every snapshot on disk (68 runs, 154 ms a pass, ~3% of a core per server) only to
  rediscover that almost all of them are terminal; 56 idle servers had accumulated 52 CPU-hours.
  A zero-byte `.active` marker, written on create and cleared on any terminal transition, turns the
  sweep into one stat per run — 154 ms becomes 3 ms — and only unfinished runs are read. The marker
  is a hint, never the truth: a stale one costs one snapshot read and the sweep clears it, and runs
  predating the scheme are swept once and then marked. The fixed interval becomes a
  self-rescheduling timer that backs off toward a minute while consecutive sweeps find nothing.
  Not addressed: nothing yet elects a single recovery owner among the servers on one machine.
- Discover providers in the caller's directory instead of the server process's own. Discovery ran in
  the MCP server's working directory — the plugin's directory — so a version-manager shim such as
  volta, which answers per project by walking up from the working directory, returned the plugin's
  own `node_modules` copy (correctly rejected by `externalProviderPaths`) while the PATH shim's
  realpath sat outside the trusted roots: no path could resolve, and codex failed
  `executable_not_found` on a machine that runs it daily. The same call fails with "Could not
  determine current directory" when a long-lived server's cwd has been deleted. Discovery now takes
  the consumer directory explicitly and falls back only to a directory that still exists (caller's
  path, `$PWD`, a still-valid `process.cwd()`, home), the availability cache is keyed on that
  directory because one entry cannot answer for two consumers pinning different provider versions,
  and `orchestration_doctor` accepts `consumerCwd` like every other grounded tool.
- Supervise the loopback session host with `systemd-run --user --scope` on Linux/WSL so the operator
  page outlives the MCP process. Native Windows stays in-process.
  `AGENT_ORCHESTRATION_SESSION_SUPERVISOR=0` forces in-process. The session-host CLI is a store-backed
  control plane (`autoRecover: false`) so cancel / follow-up / decision still work after MCP exit.
- Topology specs support ordered provider fallback chains (`candidates: ["cli:model", ...]`)
  for every agent, launch-time fallback past missing CLIs and usage/auth failures, mid-run
  `ao-topology failover` with mailbox re-delivery, launch-time input menus (`inputs.<name>.options`,
  `ao-topology inputs`), and the `logo-design` template.
- Add the tmux topology layer: declarative orchestration specs and templates, provider adapters for
  any installed CLI (claude, codex, grok, kimi, copilot, gemini, generic), domain-free role packs,
  a file-first mailbox with a JSONL journal, the `ao-topology` CLI (launch/send/wait/reply/capture/
  nudge/status/journal/stop/doctor/compose), and the `orchestration-compose`, `orchestration-launch`,
  `orchestration-conduct`, `orchestration-status`, and `setup-agent-orchestration` skills. Ships the
  `brand-identity-tournament` and `parallel-review` templates and a real-tmux contract test.
- Add a reusable cross-platform runtime built with Abstract Factory, Strategy, Facade, and Adapter
  roles. Linux keeps Bubblewrap/systemd isolation; Windows can use native AppContainer/Job Object
  isolation or a WSL2 adapter that reuses the Linux backend.
- Select the Windows backend with `AGENT_ORCHESTRATION_WINDOWS_BACKEND=auto|native|wsl`. Automatic
  selection prefers a healthy native backend and falls back to a fully provisioned WSL2 backend.
  Both explicit modes fail closed when required security dependencies are unavailable.
- Add a committed .NET 8 Windows helper for AppContainer launch, exact filesystem access rules,
  bounded Job Objects, owned-process verification, and cooperative-then-forceful termination.
- Fall back to an OS-assigned loopback port when Hyper-V or WSL reserves the fixed session-host range.
- Advertise Agent Orchestration in the Codex marketplace manifest and use Node-based MCP entries
  that load consistently on Windows and Linux.
- Store Windows state under `LOCALAPPDATA`, retain the XDG state location on Linux, and resolve
  missing nested state directories without duplicating Windows path segments.
- Project the session transcript, activity, and handoffs from the journal, and POST cancel /
  follow-up / decision through the broker. Follow-ups persist as `operator_message` events. Loopback
  Origin is required for browser mutations.
- Stream the hash-chained run journal to the session UI over cookie-auth SSE
  (`GET /api/runs/:id/events`). `after` / `Last-Event-ID` resume, a corrupt chain returns 409,
  and the status bar shows `live` / `reconnecting` / `detached`. The stage rail is `plan.stages`.
- Start a per-state-root Agent Orchestration Session host on `127.0.0.1`. Spawn returns a one-use
  `session.url`; the host exchanges it for an HttpOnly cookie and serves the committed session UI.
  Capability secrets stay out of `snapshot.json`. `agent-orchestration session-host` is the CLI bind.
- Add the Agent Orchestration Session plan and a Cobalt workbench mockup: a per-run loopback window
  for conversation, handoffs, activity, approvals, and controls. `node session-ui/serve.mjs` prints
  `Orchestration session: <url>` and opens a browser. Not wired into spawn yet.
- Wire Claude Code, Codex, Grok Build, and Kimi Code as orchestration hosts of the same MCP control
  plane. Spawn targets stay the trusted catalog (`claude`, `codex`, `grok-build`, `kimi`).
- Point sandbox `HOME` at the provider config dir so Claude Max subscription auth works without the
  unmounted host home.
- Keep the Claude credential copy mounted until sandbox teardown. Mid-run shredding made the
  bootstrap turn succeed and the task turn fail with AUTH_REQUIRED.
- Run every spawned catalog CLI in yolo / skip-permissions mode: ACP auto-approves tools after
  auth bootstrap, Codex starts in `agent-full-access`, Grok gets `--always-approve`. Bubblewrap
  still enforces the orchestration read/write mount.
- Admit the Kimi Code CLI from `~/.kimi-code/bin` in addition to the uv/pipx install roots.
- Add `install-orchestration-host` to install/trust the Grok plugin and write Kimi `mcp.json` plus
  skill/agent links without replacing unrelated MCP servers.
- Ship the governed `ROADMAP.md` and the cross-host `roadmap-orchestrator` skill with Codex UI
  metadata.
- Add validated task refinement, unlock materialization, trajectory extension, distance-aware gap
  filling, and evidence-ranked goal advancement while preserving IDs and reciprocal lineage.
- Preserve immutable roadmap identities in the packaged `ROADMAP-INVENTORY.json` ledger and require
  the precheck, edit, inventory append, canonical-view refresh, conditional source refresh, and final
  check sequence for enhancements.
- Require acyclic supersession chains to terminate at a live replacement while retaining retired
  evidence and lineage outside the active projection.
- Validate dependency-closed trajectories, human strategic approval provenance, lifecycle state
  combinations, semantic Mermaid relationships, and portable source seams in both source and clean
  installed-cache copies.
- Keep strategic proposals human-approved and non-executing, and preserve explicit
  consumer-relative `consumerCwd` for every external provider run.

## [0.3.0] — 2026-09-03

Backfilled. This release shipped without a changelog entry; the summary below is derived from the
17 commits in `ea85b8d..272a01f`, which is the authority for the detail.

- The tmux topology layer — visible agent teams in real panes, and the launch-time menus and
  `logo-design` template that drive them.
- Provider fallback chains and mid-run failover, so a dead provider moves work rather than ending it.
- A loopback session host bound on spawn, with live session SSE and operator controls, supervised
  under systemd.
- Native Windows and WSL runtimes, and the cross-platform launch repairs that made them load.
- Provider discovery in the caller's directory rather than the server process's, exact Fable 5.1
  routing, and a fix for idle servers re-reading every run forever.

**A version the package never carried.** `9e30405` moved `src/mcp.mjs` from 0.1.0 straight to
**0.2.3** — skipping 0.2.1 and 0.2.2, which never existed anywhere — while `package.json` sat at
0.2.0 and had already been there since `ea85b8d`. The two only came back together at `272a01f`,
which set both to 0.3.0. So an MCP client that asked this server its version during that fortnight
was told 0.2.3, a number no manifest ever carried and no release here is named after.

## [0.2.0] — 2026-08-21

Backfilled, on the same terms: no entry was written at the time, and `64e099a..ea85b8d` is the
authority.

- A governed living roadmap.
- The MCP tool prefix rename to `orchestration_*` (`31d586f`), which also removed this plugin's
  Codex-side `version` — it has been deliberately versionless there ever since.
- Codex read-sandbox mode alignment, canonical user-bus recovery, and refreshed source and sandbox
  bundles.

## [0.1.0] — 2026-08-21

- Add dual Claude Code and Codex plugin manifests.
- Add bundled MCP and CLI launcher contracts.
- Add cross-provider orchestration and diagnostic skills.
- Add Claude-native orchestration agent and optional Codex custom-agent template.
- Standardize the public MCP lifecycle, routing, event, cleanup, and approval surface on
  `orchestration_*`; no compatibility aliases are exposed.
- Require explicit absolute `consumerCwd` for consumer-grounded and mutating operations.
- Add deterministic capability-aware routing, the max-effort adversarial architecture protocol,
  repository-derived worktrees, durable hash-chained state, readiness probes, and atomic scheduling.
- Add Bubblewrap-enforced write containment, cooperative/verified cancellation, journal recovery,
  architecture decision lifecycle gates, installed-cache lifecycle coverage, and declarative provider
  command descriptors.
- Isolate provider roots, environments, devices, runtime sockets, and networks; outbound provider
  traffic uses `slirp4netns` with host loopback disabled.
- Add explicit one-shot/persistent session contracts, fail-closed follow-up eligibility, validated
  protocol DAGs, concrete MCP output schemas, terminal evidence immutability, periodic recovery,
  and nonce-owned exact-path worktree cleanup.
- Add bounded authenticated ACP readiness for every provider (including Kimi), fresh unmounted broker
  control directories, dependency-scoped protocol evidence, executor/contract registration gates, and
  retryable cleanup for process groups whose ownership cannot be proven.
- Run workers and sandboxed readiness probes inside transient systemd user scopes so timeouts, close
  failures, and leader exits cannot orphan provider descendants.
- Deny ACP client-side filesystem/terminal callbacks, omit credential-bearing proxy variables from
  sandbox argv, and require an active-scope worker acknowledgement before spawn returns.
- Replace persistent host credential mounts with per-turn bootstrap copies that are visible only to
  one constant, permission-denied broker authentication turn, then truncated and unlinked before the
  first task-controlled prompt.
- Restrict bootstrap inputs to auth-only files in broker-owned tmpfs; expose them as exact read-only
  mounts beneath otherwise writable provider homes whose ancestors are nested mountpoints; mount
  scratch directly at a sandbox top-level; and disable Claude user, project, and local setting sources.
- Admit only canonical provider executables beneath provider-specific installation roots, including
  fixed-command resolver support for version-manager shims; gate
  pipelined ACP prompts behind exact session responses; bound frames, transports, request buffers,
  and stderr; and add cgroup, runtime, core-dump, task-count, memory, and per-file ceilings.
- Scope run authority to the exact consumer checkout so linked worktrees cannot inspect or control
  one another, and revalidate provider-specific executable roots again at sandbox execution time.
