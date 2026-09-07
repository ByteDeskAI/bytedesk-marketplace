# The goal planner

A conversational surface at `/planner` where you state a goal in prose and an agent proposes board
operations. Nothing it says reaches the board until you approve a specific set of operations, and
what lands is exactly what you approved.

This document is about the boundary that makes that true, how to configure an agent, and what the
planner deliberately cannot do. For the wire format of every route, see
[`dashboard-api.md`](dashboard-api.md); for the design rationale behind the boundary, see
`knowledge/architecture/the-goal-planner-s-governed-proposal-boundary` in the knowledge store.

## What it is for

You have an outcome in your head and no tickets. Typing it into the board means deciding the epic,
the task breakdown, the acceptance criteria and the dependency order in one pass, in a form, before
you have thought it through. The planner is the conversation that comes first: describe the goal,
attach the design note or the log that explains it, let the agent read the current board, and get
back a proposal you can read as English and either approve or throw away.

It plans work. It does not do work, and it does not decide what this machine is allowed to run.

## The four operations

An agent proposes operations by **name** from a fixed table. It never supplies a function, a path,
or a store call, so the blast radius of a model that has read an untrusted attachment is this table
rather than everything `lib/` can do.

| Operation | Arguments | What it does |
|---|---|---|
| `epic.create` | `title`, `ref?` | Adds an epic. `ref` names it for later operations in the same proposal. |
| `epic.activate` | `epic` | Makes an epic the active one, so later `task new` calls file into it. |
| `task.create` | `title`, `body`, `acceptance[]`, `epic?` | Adds a task. The body and at least one criterion are required — the store's own create gate, applied at preview so the refusal arrives before you approve rather than after. |
| `task.depends` | `task`, `on[]` | Orders two tasks: `task` is blocked by everything in `on`. Writes both ends of the edge. |

Absent, each for a reason: **nothing deletes**, **nothing marks a task done**, **nothing dispatches
or spawns a worker**, and **nothing writes config or state** beyond the active epic. A planning
conversation proposes work; approving one cannot complete work or change what the board permits.

A proposal may reference things it is creating: `epic.create {ref: "auth"}` followed by
`task.create {epic: "auth"}` files the task under the epic that same apply mints.

## The boundary, in four properties

**1. The agent holds no tool that writes the board.** Its MCP server runs with
`TM_MCP_PROFILE=planner`, which narrows the tool table to reads — `tm_board`, `tm_show`, `tm_find`,
`tm_why`, `tm_graph`, `tm_history`, `tm_log`, `tm_stale`, `tm_parallel`, `tm_export`,
`tm_cap_list` — plus exactly one writer, `tm_plan_propose`, which records a proposal on its own
session and touches nothing else. It is an allowlist: a tool added to the CLI's table is invisible
to a planner until somebody names it here.

`tm_doctor` and `tm_agents` were on that list and had to come off. Both look like reads and both
have a mutating mode reached by an argument (`tm_doctor {fix:true, confirm:true}`,
`tm_agents {action:"reap"}`) — and the confirmation that gates the destructive half is supplied by
the caller, so an agent holding the tool simply confirms its own write. A read-only surface chosen
by tool name rather than by what its arguments can do is not a read-only surface.

**2. Preview and apply are the same code.** `previewOps` runs the validation half; `applyOps` runs
it again and then writes. An approval card that describes something other than what lands is worse
than no approval card, so the description cannot come from a second implementation that might
drift. Where the store refuses, its own wording is what you read — you are entitled to the store's
sentence, not a paraphrase of it.

**3. Approval is bound to the exact operations.** The proposal is stored server-side and digested.
`POST /api/planner/:id/apply` takes the digest you approved; the server compares it to the proposal
it is holding, then `applyOps` recomputes the digest independently from the operations it is about
to run. Neither the browser's operation list nor its digest is trusted. Approving five tasks and
applying six is the failure this closes, and it is invisible without the check.

The proposal is also *claimed* off the session under the store lock before it is applied, which is
what makes an approval single-use: without that, a double-click created the whole set twice.

**4. It is all of it or none of it.** The apply runs under one reentrant store lock and rolls back
every record it created if any operation fails — including when the process is killed mid-write. A
journal beside the store records what an in-flight apply had created, and recovery undoes exactly
those records on the next start. (An earlier version swept "everything created after the landing
began" instead; that reasoning rests on a lock that died with the process that held it, so the
heuristic was removed rather than tightened.)

## Configuring an agent

The planner talks [ACP](https://agentclientprotocol.com) over stdio to an agent **you** configure.
There is no default and nothing is downloaded: add the agents you trust to `config.json` in the
store.

```jsonc
// .bytedesk/task-management/config.json
{
  "planner": {
    "agents": [
      { "id": "claude", "label": "Claude Code", "command": "claude-code-acp" },
      { "id": "local",  "label": "Local model", "command": "/opt/acp/my-agent", "args": ["--stdio"] }
    ]
  }
}
```

| Field | Meaning |
|---|---|
| `id` | Stable key used by the run route. Defaults to `agent-<n>`. |
| `label` | What the page shows. Defaults to the id, then the command. |
| `command` | The executable. Required; an entry without one is ignored. |
| `args` | Argument list, optional. |
| `cwd` | Where to spawn it. Defaults to the repository root. |

**The command line never reaches the browser.** `GET /api/planner/agents` returns health — id,
label, connected, capabilities — and strips the command and its arguments, because a page that can
read the command can read whatever secret an operator put in it, and the page has no use for it.

`POST /api/planner/agents/:id/probe` actually spawns the agent, initializes and shuts it down. A
health check that only reads configuration reports healthy for a command that is not installed,
which is the one answer nobody wants from a preflight.

## Using it

1. **Open a session** with a goal — one bounded outcome, not a document. Optionally name an epic it
   belongs to.
2. **Attach context** if it helps: design notes, logs, a CSV, a screenshot. Attachments are session
   context, not board evidence — see the limits below.
3. **Pick an agent and run.** One run per session: two agents prompting into one conversation would
   interleave their questions. The dashboard streams AG-UI events, so turns, tool calls and
   permission requests render as structure rather than as parsed prose. A browser that connects late
   still gets everything that came before it.
4. **Read the proposal.** Each operation is described by its real consequence in words. Anything the
   board would refuse is refused here, in the board's own wording, before you approve.
5. **Approve or discard.** Approving applies that exact set, atomically. Discarding leaves the board
   untouched; the conversation can continue and propose something else.
6. **Close the session** as `applied`, `rejected` or `cancelled`. A closed session takes no more
   turns or attachments.

Sessions survive a reload — goal, turns and proposal are files. **Runs do not**: a run is a live
process attached to a live agent, and a run record no process backs is how a dashboard ends up
showing a planner that is "running" three days after a reboot.

## Attachments

Untrusted bytes somebody dropped on a page, treated as such.

- **Allowlisted by extension AND sniffed by magic bytes**: `.md`, `.markdown`, `.txt`, `.log`,
  `.json`, `.yaml`, `.yml`, `.csv`, `.toml`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`.
- **2 MB per file, 8 MB per session, 20 files.**
- Stored under their **sha256**, never under the name you uploaded, and served with
  `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and a sandboxing CSP.
- The display name is text and only text; it never becomes a path.

## Where it lives on disk

```
.bytedesk/task-management/planner/
  PL-<12 hex>.json        one session: goal, turns, attachments, proposal
  PL-<12 hex>/            that session's attachment blobs, named by sha256
```

**This directory is gitignored**, for the same reason `state.json` is: it is one machine's
in-flight thinking plus files somebody dropped on a page. `evidence/` is shared and belongs in git;
this is the opposite of that. A planning session is deliberately **not a board entity** — no id
prefix in the index, no `kindOf` arm, nothing that makes a half-finished conversation look like
work somebody committed to.

## What this is not

The planner is a **governed proposal boundary**, not an authorization system. It guarantees that
board writes originating from a planning conversation are named, previewed against the real gates,
approved as an exact set, and applied atomically or not at all. It does not authenticate who
approved — anyone who can reach the dashboard can approve a proposal, exactly as anyone who can run
`tm` can create a task. Treat dashboard access as board write access.
