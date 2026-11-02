# Why agents coordinate through the CLI instead of MCP — audit and staged design

Read-only research, 2026-10-09. Repository: bytedesk-marketplace, `main` at 77c05462, plus the PR #235
branch (TM-427). The only git write was `git fetch` of the TM-427 branch, which updated FETCH_HEAD.
"Verified" means a live process listing was checked. "Read" means the claim comes from source only.

## Answer for Ryan

Most agents **cannot** use MCP tools. Every standing role that topology launches runs Claude with
`--strict-mcp-config` and passes no `--mcp-config`, so neither plugin's MCP server starts in those
sessions. The `mcp` field on agent records is parsed and then ignored. The tools that do exist also
miss several verbs that agents use: standing-mail reply, lead probe ack, and every governed `manage`
and `reviewer` verb.

**Verified:** the standing leads (pids 88351, 88157, 88454, 739445), the reviewers (311358, 788370)
and the topology worker 449556 have **zero** MCP child processes. Operator sessions (60759, 60896) each
run `agent-orchestration/dist/host-launcher.cjs` and `task-management/bin/tm-mcp` as children.

Workers dispatched through the tmux backend have the opposite problem. They load **every** user MCP
server, including the infisical (secrets) and kubernetes servers.

---

## 1. MCP tools that exist today

### 1a. agent-orchestration server

Code: `agent-orchestration/src/mcp.mjs`, built to `dist/mcp.cjs`, launched through `.mcp.json` →
`dist/host-launcher.cjs` → `runHost` (`src/platform/host-adapters.mjs:96-111`). On Linux, `runHost`
starts `dist/mcp.cjs` as a child process, so the server descends from the session's `claude`
process (verified: 67972 → 67998). Tools are registered through the `register()` helper at
`src/mcp.mjs:222`.

**Identity.**

- **Provider-run tools:** they take `consumerCwd`, which `service.resolveConsumer` resolves to a
  repository. No agent identity is involved.
- **Topology tools:** they act as `sessionIdentity()` (`topology/lib/standing-mailbox.mjs:399-412`).
  That is the launcher's `AO_AGENT_ID`/`AO_CONSUMER` (`session-identity.mjs:36-40`). Without those, it
  is the identity minted at SessionStart, re-read on every call (`src/topology-api.mjs:40-49`, TM-466).
  A `from` or `agent` argument may only repeat it (`topology-api.mjs:63-69`).

| Line | Tool | Purpose |
|---|---|---|
| 236 | `orchestration_capabilities` | Describe providers, intents and protocols |
| 237 | `orchestration_doctor` | Provider readiness |
| 238 | `orchestration_route` | Preview a route |
| 239 | `orchestration_plan` | Execution plan |
| 240 | `orchestration_spawn` | Start a provider run; a write run gets a worktree |
| 241–243 | `orchestration_status`, `_list`, `_events` | Read runs |
| 248–249 | `orchestration_run_wait`, `_run_followup` | Provider-run wait and follow-up |
| 250–251 | `orchestration_wait`, `_send` | Deprecated aliases |
| 252–253 | `orchestration_cancel`, `_cleanup` | Run lifecycle |
| 254, 258 | `orchestration_decision_get`, `_decision_approve` | `approvedBy` is an unverified label |
| 272, 276, 279 | `orchestration_run_mail_send`, `_reply`, `_wait` | Run-scoped mail; each starts the `ao-topology` CLI as a child (`topology-api.mjs:9-29`) |
| 283 | `orchestration_lead_status` | Lead state; `cached` mints no probe |
| 285 | `orchestration_session_handoff` | Lead or the agent itself only (TM-463) |
| 287 | `orchestration_mailbox_send` | Send standing mail as yourself |
| 291 | `orchestration_mailbox_receive` | `readStandingInbox`; the `mailbox inbox` equivalent |
| 293 | `orchestration_mailbox_wait` | Only the original sender may wait (TM-465); at most 55 s |
| 296 | `orchestration_mailbox_list` | Your own receipts |
| 298 | `orchestration_mailbox_dispose` | Record a disposition |
| 302–310 | `orchestration_goal_start`, `_status`, `_report`, `_control`, `_reconcile` | Goal loops; control passes `authenticatedHuman:false` (`topology-api.mjs:174`) |

### 1b. task-management server

Code: `task-management/bin/tm-mcp` → `task-management/lib/mcp.mjs` (the `TOOLS` array from `:146`).

**Identity.** Tools act as `actor()` (`lib/actor.mjs:76-84`): the `TM_ACTOR` or `CLAUDE_AGENT_NAME`
label, otherwise `main`. It is a label, not an authenticated identity. The governance gates key on
the `TM_DISPATCH_WORKER` environment variable: `governance.mjs:6, 20, 55` and
`governance-check.mjs:193`. Those gates live in library code, so they bind MCP calls too, as long as
the server inherited that environment variable.

**Profile.** `TM_MCP_PROFILE=planner` narrows the server to an allowlist (`PLANNER_TOOLS` `:116`,
`plannerTools()` `:141`). A byte-identity test calls every permitted tool with destructive arguments
and checks the store did not change. This is the pattern to reuse for other roles.

| Kind | Tools (line) |
|---|---|
| Read | `tm_board` 202, `tm_next` 209, `tm_show` 216, `tm_find` 226, `tm_why` 252, `tm_log` 262, `tm_standup` 287, `tm_cap_list` 643, `tm_graph` 934, `tm_export` 980, `tm_time` 1001, `tm_parallel` 1012, `tm_history` 1072, `tm_stale` 1089, `tm_goal_show` |
| Write | `tm_epic` 294, `tm_task_create` 345, `tm_task_update` 388 (start, review-ready, done, park, block, unblock, delete, restore), `tm_task_edit` 483, `tm_ac_add` 513, `tm_ac_accept` 530, `tm_evidence` 558, `tm_adr_new` 594, `tm_cap_propose` 613, `tm_cap_accept` 666, `tm_cap_ship` 680, `tm_cap_drop` 698, `tm_sprint` 716, `tm_handoff` 798, `tm_claim` 805, `tm_label` 834, `tm_worktree` 860, `tm_link` 895, `tm_ticket` 915, `tm_task_field` 1019 (comment at 1061), `tm_goal_import` 1171, `tm_goal_{open,finding,assess,revise,complete}` 1208; `resume` is excluded on purpose (1206) |
| Read with a writing mode reached by an argument | `tm_doctor` 952 (fix), `tm_agents` 1095 (reap) |
| Asynchronous | `tm_dispatch` 1120, `tm_collect` 1156 |
| Planner | `tm_plan_propose` 148 |

### 1c. ao-review server (the reviewer only)

Code: `agent-orchestration/topology/review-mcp.mjs`. It is hand-rolled JSON-RPC rather than the MCP
SDK, because `topology/` runs without `node_modules`. It has one tool, `review_submit`, which calls
`submitReviewVerdict`. Its identity is the `AO_AGENT_ID` and `AO_CONSUMER` that the host pins in the
server's environment (`reviewer.mjs:181-186`). On PR #235 the caller must also descend from the
reviewer's pane (`requireReviewerCaller` → `requireCallerInPane`).

---

## 2. CLI verbs agents use, and their MCP equivalents

| CLI verb (`topology/cli.mjs`) | MCP equivalent | Gap |
|---|---|---|
| `mailbox send` :738 | `orchestration_mailbox_send` | **Different behaviour.** The CLI resolves `lead@<repo>`, `--to-repo` and the all-leads broadcast through `resolveStandingTargets` (cli.mjs:742-744; `addressing.mjs:263`). MCP passes `to` through unresolved (`topology-api.mjs:111-120`). The TM-271 resolver was fixed in one caller and not the other. |
| `mailbox inbox` :731 | `orchestration_mailbox_receive` | Covered. |
| `mailbox reply` :730 (`recordStandingReply`, `standing-mailbox.mjs:501`) | None | **Missing.** `_run_mail_reply` handles run mail only. |
| `mailbox wait` :711 | `orchestration_mailbox_wait` | Covered, but limited to 55 s against the CLI's 20 min default. |
| `mailbox outbox` :709, `forward`, `resume` :724 | None | Outbox and forward are missing. Resume is a human's decision, so leaving it out is correct. |
| `mailbox receipts`, `dispose` :696 | `_mailbox_list`, `_mailbox_dispose` | Covered. |
| `lead ack <nonce>` :1005 (`leadNonceAck`, `lead.mjs:610`) | None | **Missing.** This is what lead probes need (TM-478). |
| `lead status` :987, `probes` :988 | `orchestration_lead_status` | `probes` is missing. |
| `lead ensure`, `assign`, `detach` | None | Operator verbs; acceptable. |
| `reviewer status`, `ensure`, `request`, `collect`, `eligible`, `ack` :877-892 | None | **Missing** for leads. The reviewer acknowledges readiness by printing `AO_REVIEWER_READY` on its pane (`reviewer.mjs:242`). |
| `review submit` :785 | `review_submit` (reviewer only) | Covered. |
| `manage report`, `status`, `eligible`, `assignment` (worker-allowed); `admit`, `start-worker`, `stop-worker`, `rework`, `retry-review`, `integrate`, `record-landing`, `close`, `transfer`, `rebind`, `cleanup`, `assign`, `release` (lead) :894-931 | None | **Missing entirely.** The worker allowlist exists only in the CLI (cli.mjs:898), not in `management.mjs`. |
| `observer …` :1255, `role …` :1008 | None | Low priority. |
| `tm dispatch` / `tm collect` | `tm_dispatch` / `tm_collect` | Covered. |
| `tm comment` | `tm_task_field {comment}` | Covered. |
| `tm accept` | `tm_ac_accept` | Covered. |
| `tm evidence` | `tm_evidence` | Covered. |
| `tm done` | `tm_task_update {action:"done"}` | Covered; the governance gates apply. |

---

## 3. What each role is launched with, and what it can reach

**Root cause (read, then verified).**

- `agent-orchestration/providers/claude.json` sets `"args": ["--strict-mcp-config"]` for every Claude
  session that topology launches.
- `buildArgv` (`topology/lib/providers.mjs:283-299`) never reads `agent.mcp`. The field is parsed at
  `agents.mjs:167` and copied at `lead.mjs:360` and `reviewer.mjs:584`. No code outside
  `reviewer.mjs` produces `--mcp-config`.
- `permissions.mjs:25` (`RESTART_NOTE`) tells operators that adding a server to `agent.json "mcp"`
  loads it. **That is false.**
- This marketplace lead's `agent.json` has `mcp: []`. The default templates `lead-default` and
  `reviewer-default` (`config.defaults.json`) declare no `mcp`.

| Role | Launch path and decisive flags | MCP servers loaded | Bash |
|---|---|---|---|
| Standing lead | `openLeadSession` (`lead.mjs:382-397`) → `buildArgv`: `--strict-mcp-config --append-system-prompt …`, plus `--dangerously-skip-permissions` if the template sets `auto_approve`, plus `--disallowed-tools Write,Edit,NotebookEdit` when `coordinates_only` (`providers.mjs:288, 293`) | **None** (verified, 88351) | Yes |
| Standing observer and other roles | `openAgentSession` (`roles.mjs:140-160`). Coordinator flags are skipped when `own_state_only` (`providers.mjs:293`). | None | Yes |
| Standing reviewer, current code | `buildReviewerArgv` (`reviewer.mjs:191-226`): `--restricted --setting-sources '' --strict-mcp-config --mcp-config <ao-review> --allowed-tools mcp__ao-review__review_submit --disallowed-tools Write,Edit,NotebookEdit,Agent,Task --permission-prompts none`. Custom args, env, command or MCP are refused (`:192`). | `ao-review` only | No |
| Standing reviewer, **live** (311358, 788370) | The argv from before TM-365: `--restricted --safe-mode --strict-mcp-config`, with no `--mcp-config` | **None, so they have no `review_submit`** (verified) | No |
| tm worker, topology backend (`task-management/lib/dispatch/topology.mjs:93-117` → `launch.mjs:734-763`) | `--strict-mcp-config --settings {PreToolUse Bash guard}` (`launch.mjs:702`); env `TM_DISPATCH_WORKER`, `TM_DISPATCH_TASK`, `TM_DISPATCH_BRANCH` (`:763`) | None (verified, 449556) | Yes |
| tm worker, tmux backend (`dispatch/tmux.mjs:40` `DEFAULT_COMMAND`, `:228` guard) | `claude -p … --settings {guard} <prompt>`. There is **no** `--strict-mcp-config` and **no** `--setting-sources`. | **All user and project servers** (verified, 507008, 2377535, 2380207): ao, tm, km, teamcity, design-patterns, agent-browser, **infisical**, **kubernetes** | Yes |
| Orchestration backend (ACP provider runs, `src/provider-sandbox.mjs`) | Not traced in detail | Not traced | — |
| Claude subagents (Agent tool) | Share the parent session's MCP server processes, so they act **as the parent** | Inherited from the parent; none under a strict lead | Per agent definition |

**The worker guard does not see MCP.** It is a PreToolUse hook that matches only `Bash`
(`tmux.mjs:56`, `launch.mjs:702`, `task-management/hooks/hooks.json:28,60`). A tmux worker's MCP calls
are never inspected. That covers `orchestration_spawn` (a write run), `tm_claim`, `tm_worktree` or
`tm_dispatch` with `steal`, `tm_doctor` with `fix`, `tm_agents` with `reap`, and the infisical and
kubernetes tools. The library-level governance gates still apply. TM-502 covers the "loads
everything" half of this.

---

## 4. Identity: would MCP as the primary channel make identity sound?

**For the reviewer: yes, on one condition.** The reviewer has no Bash, no hooks
(`--setting-sources ''`) and no Agent tool. The only processes descended from its pane are `claude`
and its MCP servers. TM-427's `requireCallerInPane` (PR #235, `slots.mjs:178-196`) therefore means
"this tool call came from the reviewer."

The condition: **nothing that runs untrusted code may run inside the reviewer's process tree.** A
"run required checks" tool executes code the worker wrote. If it runs as a child of the MCP server,
that code descends from the reviewer's pane, passes `requireReviewerCaller`, and could submit an
`approve` verdict. Checks must run outside the pane tree, for example through `systemd-run --user`,
the repository supervisor, or the session host.

**For leads and workers that have Bash: no stronger than the CLI.** Pane ancestry proves "something
running in this pane." That includes every Bash child, `npm test`, and git hooks.

What MCP adds is that the server's environment is fixed when it starts. An agent cannot strip
`TM_DISPATCH_WORKER` or a profile allowlist from the server. From Bash it can, with
`env -u TM_DISPATCH_WORKER ao-topology manage …`. MCP makes those gates sound only if the CLI path
for the same verbs is closed or proven the same way.

**Existing hole to report on TM-427.** `integrateTask` calls `runRequiredChecks`
(`management.mjs:974-989`, run at `:979`). That runs worker-authored code with `env: process.env`
(`topology/lib/util.mjs:36`) as a descendant of the lead's pane. The code inherits `AO_AGENT_ID` and
passes `requireLeadCaller` (PR #235 `delegation.mjs`), so it can run lead verbs. T3 removes this.

**What pane proof breaks:**

- **Headless and non-tmux callers.** This means `claude -p` operator scripts, ACP orchestration
  runs, and tmux-backend workers. The `tm-<id>` worker panes are not bound in the census, so
  `requireCallerInPane` has no binding to check. These callers can never act as lead or reviewer,
  which is acceptable. They keep SessionStart identity for ordinary mail, and PR #235 still refuses
  reserved senders such as `ao-supervisor`, `ao-management` and `tm-dispatch`.
- **macOS.** `/proc` cannot be read, so the proof fails closed (`slots.mjs:170-172`) and lead verbs
  are unavailable on darwin. This overlaps TM-282.
- **The WSL host adapter** (`host-adapters.mjs:60-72`). Ancestry cannot be proven across the
  `wsl.exe` boundary.
- **Subagents.** They share the parent's MCP server, so they always act as the parent. This is
  acceptable for a lead's subagents. The reviewer's Agent tool is already disabled.

---

## 5. Recommended design: staged tasks

**Order:**

- After TM-427 (PR #235) merges, these can run in parallel: **T2**, **T3** (T3 also needs TM-505),
  **T7**, and **T1**.
- After T1: **T4**, **T5** and **T6**, in parallel. T6 can merge with TM-502.
- **T8** is optional.

Each task also updates the affected role prompt (`agent-orchestration/roles/*.md`, and the lead
prompt template) to prefer the MCP tool and keep the CLI as the fallback. Each brief should state
its verification commands. The tests below each include a check that fails when the result is
empty, so an empty result cannot pass.

### T1 — Make `agent.mcp` load servers (prerequisite for leads and workers)

- **Files:** `topology/lib/providers.mjs` (`buildArgv`, plus a new adapter key `mcp_config_args`);
  `providers/claude.json`; `topology/lib/lead.mjs`; `roles.mjs`; `launch.mjs`; `config.defaults.json`
  (`lead-default.mcp: ["ao","tm"]`); `permissions.mjs` (correct `RESTART_NOTE`, add allow rules for
  `mcp__ao__*` and `mcp__tm__*`).
- **Design:** names resolve through a registry the host owns: `ao` → `dist/host-launcher.cjs`, and
  `tm` → `bin/tm-mcp`. Each server's environment pins `AO_AGENT_ID`, `AO_CONSUMER` and a profile.
  Refuse inline server objects that come from a repo-tracked `agent.json`; this is the TM-501
  concern. The reviewer keeps refusing `agent.mcp` (`reviewer.mjs:192`).
- **Acceptance criteria:**
  1. The argv contains exactly one `--mcp-config`, holding only the named servers.
  2. An adapter with no `mcp_config_args` and a non-empty `mcp` refuses to launch rather than
     silently dropping the servers.
  3. A relaunched lead has `host-launcher.cjs` and `tm-mcp` as children.
- **Tests:** a unit test on `buildArgv` output; a refusal test for an inline server; a live check
  with `ps --ppid <lead claude pid>`.

### T2 — Read-only reviewer mail tool (closes TM-509 AC1)

- **Files:** `topology/review-mcp.mjs`; `reviewer.mjs:222` (`--allowed-tools` list).
- **Tool:** `review_inbox` calls `readStandingInbox` (`standing-mailbox.mjs:432`) as the pinned
  `AO_AGENT_ID`. It accepts no `agent` argument and proves the caller's pane under TM-427.
- **Decision for the lead:** `review_mail_reply` is left out by default. Findings in the verdict
  stay the reviewer's only outbound channel, which keeps "no write tools beyond submit."
- **Acceptance criteria:**
  1. `tools/list` returns exactly `review_submit`, `review_inbox` and `review_run_checks`.
  2. The reviewer sees only mail delivered to it.
- **Tests:** a tools/list snapshot; a test that another agent's mail is not shown; a byte-identity
  test for the repository and board after calling every tool with hostile arguments, following the
  `PLANNER_TOOLS` pattern.

### T3 — `review_run_checks(request)`, run by the host outside the pane tree

- **Files:**
  - `topology/lib/management.mjs:974`: split `runRequiredChecks` into a collector that does not
    throw and takes an `env` and a runner. `integrate` (`:1008`, `:1173`) uses the same collector,
    so there is one implementation.
  - `review-mcp.mjs`.
  - `reviewer.mjs:1398`: read `required_checks` through `loadGovernedConfig` (TM-505).
- **Rules:**
  - The revision comes from the request packet, never from a tool argument.
  - The check list comes only from config on the server's default branch.
  - The environment is an allowlist (PATH, HOME, LANG). Drop `AO_*`, `TM_*`, `CLAUDE*`, `TMUX*`,
    `GH_*`, `GITHUB_TOKEN` and the NATS variables.
  - Checks run outside the pane tree, through `systemd-run --user --wait --pipe --collect` or a
    request to the repository supervisor.
- **Returns:** `[{name, argv, exit_code, revision, duration_ms, log_tail}]`, the TM-216
  check-evidence shape (`cli.mjs:884`).
- **Acceptance criteria:**
  1. The evidence matches the TM-216 shape.
  2. A failing check returns evidence and does not throw.
  3. Checks never descend from a reviewer or lead pane.
- **Tests:** a check that dumps its environment shows no session variables; a check that walks
  `/proc` finds no reviewer or lead pane pid; a `required_checks` value written by a worker is
  ignored.

### T4 — Mail and probe-ack parity for leads and workers

- **Files:** `src/mcp.mjs`, `src/topology-api.mjs`.
- **Changes:** add `orchestration_mailbox_reply` (`recordStandingReply`) and
  `orchestration_lead_ack(nonce)` (`leadNonceAck`, `lead.mjs:610`). Route `mailboxSend` through
  `resolveStandingTargets`.
- **Acceptance criteria:**
  1. MCP and the CLI resolve `lead@<repo>`, `--to-repo` and the all-leads broadcast to identical
     targets.
  2. An ack is accepted only from the lead's pane.
- **Tests:** an update to the `tests/unit/mcp-contract.test.mjs` tool list; a test that both paths
  produce the same targets; ack from the lead's pane succeeds and ack from another pane is refused.
  This feeds TM-478.

### T5 — Governed-task verbs as MCP tools (includes TM-509 AC2)

- **Files:** `src/mcp.mjs`; `topology-api.mjs`; `management.mjs`. Move the worker allowlist from
  `cli.mjs:898` into `management.mjs` so both callers share it. Add rework from a `blocked` verdict.
- **Tools:**
  - `orchestration_manage_report`: workers, for their own `TM_DISPATCH_TASK` only.
  - `orchestration_manage_rework` and `_manage_retry_review`: the lead, through `requireLeadCaller`.
  - `orchestration_manage_status`: read-only.
- **Acceptance criteria:**
  1. A worker calling rework is refused on both paths.
  2. A lead calling rework from a blocked verdict returns the task to working.
  3. A report sent through MCP produces a record identical to one sent through the CLI.
- **Tests:** one for each criterion, including the TM-509 deadlock shapes (a blocked verdict, and a
  collected-failed worker with no submitted revision).

### T6 — Worker launch flags and worker tool profiles (merge with TM-502)

- **Files:** `task-management/lib/dispatch/tmux.mjs:40`; `dispatch/topology.mjs:93`;
  `task-management/lib/mcp.mjs` (`WORKER_TOOLS` allowlist plus a `TM_MCP_PROFILE=worker` branch next
  to `plannerTools`); `src/mcp.mjs` (`AO_MCP_PROFILE=worker` allowlist).
- **Launch flags:** `--setting-sources user --strict-mcp-config --mcp-config <ao+tm, profile=worker>`.
- **Allowed:** reads; `tm_ac_accept`, `tm_evidence` and `tm_task_field` comment on the worker's own
  task; `tm_task_update` review-ready; mailbox send, receive, list, dispose and wait;
  `manage_report`; cached `lead_status`.
- **Denied:** `tm_dispatch`, `tm_claim`/`tm_worktree` with steal, `tm_doctor`, `tm_agents`,
  `orchestration_spawn`, `_cleanup`, `_cancel`, `_decision_approve`, `goal_*` and
  `session_handoff`.
- **Acceptance criteria:**
  1. A worker loads only the ao and tm servers. The infisical, kubernetes and teamcity servers are
     absent.
  2. Denied tools are absent from `tools/list`.
- **Tests:** a byte-identity test calling every denied tool with destructive arguments; a live
  `ps --ppid` check on a dispatched worker; the TM-502 AC that a project SessionStart hook does not
  run while the worker guard still loads.

### T7 — Verify that each role's launch flags loaded its tools

- **Files:** `topology/lib/doctor.mjs`, `roles.mjs` (`role status`).
- **Behaviour:** compare the MCP children each live role actually has (`ps --ppid`) with what its
  role expects. Flag a reviewer running the argv from before TM-365 (`--safe-mode` without
  `--mcp-config`) and recommend a forced relaunch. TM-488's comment of 2026-10-09 confirms that
  `reviewer ensure` reattaches a stale reviewer instead of relaunching it.
- **Acceptance criteria:**
  1. The doctor names live stale reviewers 311358 and 788370.
  2. It reports "expected none" rather than nothing at all for roles that should have no MCP.
- **Tests:** a fixture process list with one stale reviewer and one healthy lead.

### T8 (optional) — Other provider adapters

Add `mcp_config_args` (or the equivalent) for codex and the other adapters, or refuse when `mcp` is
set. Without it, a Codex lead silently gets no tools, which is the same failure T1 fixes for Claude.

---

## Overlapping tm tasks

| Task | Status | How it relates |
|---|---|---|
| TM-352 | done | mailbox wait, CLI and MCP |
| TM-355 | done | MCP parity for run mail, lead status and handoff |
| TM-356 | done | Sender comes from session identity |
| TM-365 | done | Reviewer `review_submit` channel |
| TM-466 | done | MCP uses the SessionStart-minted identity |
| TM-384 | done | Held-mail fallback |
| TM-427 / PR #235 | in progress | Pane proof. Report the in-tree check-runner hole to it (section 4). |
| TM-462 | blocked | Reserved senders; folded into PR #235 |
| TM-478 | in progress | Lead probes; T4 supplies the ack |
| TM-488 | open | Needs the reviewer relaunched (T7) |
| TM-509 | open | AC1 is T2; AC2 is T5 |
| TM-505 | open | Prerequisite for T3 |
| TM-479 | open | Reviewer cannot read the repo; partly addressed by T2 and T3 |
| TM-502 | open | Same change as T6 |
| TM-481 | open | Worker can merge before the verdict |
| TM-501 | open | Repo-tracked session commands; constrains T1 |
| TM-282 | open | macOS, where pane proof fails closed |
| TM-450 | open | MCP stray-flag guard |
| TM-496 | open | Committed `dist/` conflicts; affects every `src/mcp.mjs` task |

## About `--dangerously-skip-permissions`

This report does not recommend the flag. It appears only as a quotation of current behaviour:

- `providers/claude.json` `auto_approve_args`;
- `task-management/lib/dispatch/tmux.mjs:40` `DEFAULT_COMMAND`;
- live process argv observed with `ps`.

None of the staged tasks adds it, and the reviewer design keeps `--restricted` with no Bash.
Whether workers and leads should keep it is a separate question, already tracked by TM-219
(auto_approve off by default).
