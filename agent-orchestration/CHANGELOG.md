# Changelog

## [0.6.0] — 2026-09-09

### Added

- Repository lead and reviewer registries, configurable templates and one prompt resolver.
- Startup hook/watcher detection, exact session bindings, durable standing messages and holds.
- Presence v1 producer and frozen contract fixtures, task-store-backed review/integration gates.

### Fixed

- Lock ownership races, unsafe prompt fallback, hook sibling deletion and watcher lease fencing.
- Linked worktree identity and cross-repository routing admission.

## [Unreleased]

### Added

- **Delivery is a state machine, not a fire-and-forget bell** (TM-130). New `topology/lib/delivery.mjs`
  observes each transition instead of assuming it: `held` / `not-typed` / `typed-unsubmitted` /
  `submitted` / `engaged` / `submitted-inert` / `escalated`. Classification (`classifyLanding`,
  `nextRung`, `decideBell`) is pure and the I/O is separate, so the whole ladder is testable with a
  stub client and no tmux server. The retry ladder is cheapest-rung-first and idempotent: a stuck
  draft is recovered by sending the submit key **alone** (never re-typed — re-typing appends a second
  copy to the draft), a never-typed pointer goes back through `deliverPointer`, and nothing re-sends
  the message of record. Ring bookkeeping lives in `run.json` under `ring_state[messageId][agentId]`,
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

### Fixed

- **`providers/codex.json`'s ready pattern never matched.** Re-measured 2026-09-09 against tmux 3.4
  on a live idle codex pane: the shipped `^\s*[›>❯][^a-zA-Z0-9]*$` answered **0**, while
  `^\s*›\s*Ask Codex to do anything` answered 16. An empty codex composer renders that placeholder
  and the old pattern forbade letters after the glyph, so every codex agent burned its full 30s
  `timeout_ms` and was then reported as a slow agent. Both the JS and the tmux form are corrected.
- **Mail wording, applied from the `BEGIN_CLAUSE` lesson** (TM-122). `bootstrapText` and
  `prompts.mjs` now say: do the work in the same turn you read the message, do not stop to confirm
  receipt and wait to be told to continue, and if you are blocked still write a reply saying what is
  missing.
- **Sandbox teardown no longer fails on a provider's Go module cache.** An agent that ran
  `go build` or `go test` left `go/pkg/mod` inside its sandbox HOME with directories at mode
  `0555`. Unlink needs write on the *parent* directory, so cleanup died with
  `EACCES: permission denied, unlink '/dev/shm/.../provider-home/<provider>/go/pkg/mod/.../LICENSE'`
  — `fs.rm({ force: true })` does not help, because `force` only swallows `ENOENT`. Every broker
  and turn-scratch removal now goes through `removeTree`, which restores write on its own
  directories and retries once. Symlinked directories are not followed, so it cannot chmod outside
  the tree it owns.

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
