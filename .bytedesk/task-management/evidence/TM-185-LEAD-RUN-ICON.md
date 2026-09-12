# TM-185: a registered lead coordinating a run shows the lead icon

**Result:** fixed inside TM-168, at commit `78cae6c` on `tm/TM-168-surfaces`, on top of `02b8380`.

When the repository's registered lead is launched into a run as `orchestrator`, it now shows 👑
everywhere, matching presence:
- its run pane, and its title bar;
- its `run.json` entry;
- launch output, both JSON and dry run;
- `status`, `agent list`, `session list` and `role list`.

A non-lead orchestrator keeps 🎼.

## What changed

**`launch.mjs`**
- `registeredLeadId({ consumer, env, home })` returns the registration's `agent_id`. A missing
  consumer, or a missing or unreadable registration, returns null and never raises an error.
- `runAgentVisual(agent, leadId)` passes `repoRole: "lead"` when the agent matches the registered
  lead. A nested team still takes precedence.
- `launchRun` looks the lead up once per launch.

**`cli.mjs`**
- `status` looks the lead up once per call.
- `agent list` and `session list` share `libraryVisuals(ctx)`, which also looks it up once per call.

**`roles.mjs`**
- Role holder rows use the registration that role status and role list already read.

**Unchanged:**
- No tmux listing was added, and `agent.json` is never written.
- The pane title text is unchanged: `conductor · orchestrator · fake-agent:c1`.

## Evidence at `78cae6c`

All runs used `TMUX=''`, a private `TMUX_TMPDIR`, and a clean tree.

| Check | Result |
|---|---|
| Full topology unit suite | 410/410, exit 0 |
| Stability, `tests/unit/topology-role*.test.mjs`, 5 runs | stable; 19 tests passed in every run, exit 0 |
| Contract `tests/contract/topology-role-icon-tmux.test.mjs` | 1/1, exit 0, no leaks |

In the contract run:
- the lead's pane shows `@ao_role_icon` 👑;
- its title is `👑 Ada Vale, Engineering Lead · Lead`;
- the attached xterm receives `ESC]0;👑 Ada Vale, Engineering Lead · Lead BEL`;
- an inline orchestrator's pane shows 🎼;
- `run.json` and `status` agree.

**Red run D** removed the lead lookup (`registeredLeadId` returns null). It fails two unit tests
(`null !== 'ada00001'`) and the contract test.

## Not asserted

- `roleStatus` holder icons, because its path lists tmux panes, which the fake tmux cannot answer.
- `role show`.
- A registration that names an inline run agent id rather than a library id.
