# TM-130 — patch for `topology/cli.mjs`

**Written against `main` @ `ebc92e3`** (the merged TM-127 tip), re-anchored after `d79db04` moved
this file. Every line number below is `main`'s. `topology/cli.mjs` is integrator-owned, so this is
the change I want rather than an edit I made.

Everything it depends on is committed on `tm/TM-130-delivery-state-machine`:
`topology/lib/delivery.mjs`, the `composer` block on `providers/{claude,codex,kimi}.json`, and
`assertTmuxPattern` in `topology/lib/providers.mjs`.

> **What `d79db04` changed under this patch.** `ensureSupervision(ctx)` is now called from `launch`,
> `session open` and `send`. In `send` it lands inside the `out({…})` object (line 833), *after* the
> `delivered` loop has already run — so the loop this patch replaces (lines 813-828) is **byte-for-byte
> identical** to the pre-merge version and the replacement below applies verbatim. The `status` body
> is unchanged too; only its line numbers moved. The exit-3 addition is the one place the merge
> matters, and it is called out there.

Four changes: wire the ring into `send`, implement `--no-ring` (it has been in `USAGE` at line 65
and in two test files since this command was written, and the body never read it), add the optional
`ack` verb, and give `status` an `! UNDELIVERED` banner.

---

## 1. Imports

**Context — `topology/cli.mjs:10-12` (main):**

```js
import { doctor as runDoctor, tmuxInstallPlan } from "./lib/doctor.mjs";
import { failoverAgent, launchRun, openRoleSession, roleSessionName, uniqueSessionName } from "./lib/launch.mjs";
import { appendJournal, loadRun, pendingReplies, queueDepth, readJournal, recordReply, saveRun, sendMessage, waitForReplies } from "./lib/mailbox.mjs";
```

**Change:**

```js
import { doctor as runDoctor, tmuxInstallPlan } from "./lib/doctor.mjs";
import { closeAllClients, isUndelivered, ringMessage, undeliveredReport } from "./lib/delivery.mjs";
import { deliverPointer, failoverAgent, launchRun, messagePointer, openRoleSession, roleSessionName, tmuxFailureTrigger, uniqueSessionName } from "./lib/launch.mjs";
import { agentDir, appendJournal, loadRun, pendingReplies, queueDepth, readJournal, recordReply, saveRun, sendMessage, waitForReplies } from "./lib/mailbox.mjs";
```

`deliverPointer` and `tmuxFailureTrigger` are passed INTO `ringMessage` rather than imported by it.
That is deliberate: `delivery.mjs` takes every side effect as a parameter, which is what lets the
unit tests drive the whole state machine with a stub that throws on any tmux use.

---

## 2. `send` — the ring, and `--no-ring`

**Context — `topology/cli.mjs:813-828` (main)**, the block TM-127 left as a permanent `rang: false`.
Unchanged by `d79db04`, so this matches your working tree exactly:

```js
    const delivered = [];
    const { forwardMessageToWorkflow } = await import('./lib/mailbox.mjs');
    for (const delivery of message.deliveries) {
      const agent = run.agents.find((item) => item.id === delivery.agent);
      if (agent?.workflow?.run_dir) {
        const forwarded = await forwardMessageToWorkflow({ runDir, messageId: message.id,
          recipient: delivery.agent, standingOptions: { pluginRoot: PLUGIN_ROOT, home: ctx.home } });
        delivered.push({ agent: agent.id, workflow: agent.workflow.name, forwarded_as: forwarded.id,
          run_dir: agent.workflow.run_dir, holds: forwarded.holds, notification: 'durable-pending' });
      } else {
        // Pane liveness proves neither an empty composer nor a safe tool-input
        // state. No adapter currently supplies a mechanically proven safe bell.
        delivered.push({ agent: delivery.agent, standing: Boolean(delivery.standing),
          rang: false, notification: 'durable-pending' });
      }
    }
```

**Change:**

```js
    // `--no-ring` has been in USAGE, in tests/live/two-projects.sh and in
    // tests/contract/topology-tmux.test.mjs since this command was written, and was never
    // implemented in this body — the flag parsed and did nothing.
    const noRing = flags["no-ring"] === true || String(flags["no-ring"]) === "true";
    const adapters = await loadAdapters(ctx.providerDirs);
    const delivered = [];
    const { forwardMessageToWorkflow } = await import('./lib/mailbox.mjs');

    // TM-127 disabled the bell on the correct observation that "pane liveness proves neither an
    // empty composer nor a safe tool-input state" — but the result was that every send reported
    // { rang: false, notification: 'durable-pending' }, so an idle agent was never woken at all.
    // The answer is not to re-enable the guess: `ringMessage` OBSERVES the composer through the
    // adapter's measured `composer` block, and an adapter without one still holds and reports.
    const ring = async ({ agentEntry, agentId, pointer, session, runDirForState, messageId }) => {
      const adapter = adapters.get(agentEntry?.adapter ?? "") ?? adapters.get(agentEntry?.cli ?? "");
      if (!adapter) {
        return { agent: agentId, rang: false, notification: 'durable-pending',
          delivery: { state: 'held', ring_capability: 'unsupported', reason: `no adapter recorded for ${agentId}`, escalated: false } };
      }
      return ringMessage({
        runDir: runDirForState, agentId, agent: agentEntry, adapter, pointer, messageId,
        session, noRing, deliverPointer, tmuxFailureTrigger,
        log: (line) => process.stderr.write(`${line}\n`),
      });
    };

    try {
      for (const delivery of message.deliveries) {
        const agent = run.agents.find((item) => item.id === delivery.agent);
        if (agent?.workflow?.run_dir) {
          const forwarded = await forwardMessageToWorkflow({ runDir, messageId: message.id,
            recipient: delivery.agent, standingOptions: { pluginRoot: PLUGIN_ROOT, home: ctx.home } });
          // The child's conductor is the one that has to wake up, in the CHILD session. Same bell,
          // no new path: "a message reaches a terminal state on every transport, or a human is told
          // which one it is stuck on and why."
          const childRun = await loadRun(agent.workflow.run_dir).catch(() => null);
          const conductor = childRun?.agents?.find((item) => item.id === agent.workflow.conductor) ?? null;
          const rung = conductor
            ? await ring({
                agentEntry: conductor, agentId: conductor.id, session: childRun.session,
                runDirForState: agent.workflow.run_dir, messageId: forwarded.id,
                pointer: messagePointer({ id: forwarded.id, from, stage, inbox: join(agentDir(agent.workflow.run_dir, conductor.id), "inbox"), outbox: join(agentDir(agent.workflow.run_dir, conductor.id), "outbox") }),
              })
            : { rang: false, notification: 'durable-pending', delivery: null };
          delivered.push({ agent: agent.id, workflow: agent.workflow.name, forwarded_as: forwarded.id,
            run_dir: agent.workflow.run_dir, holds: forwarded.holds,
            rang: rung.rang, notification: rung.notification, delivery: rung.delivery });
          continue;
        }
        // OPEN QUESTION for the integrator: a standing (cross-repo) delivery does not carry
        // `inbox`/`outbox` back from `sendMessage` — `standing-mailbox.mjs` owns those paths. The
        // pointer below names the command that reads it, which is true and useful; if you would
        // rather surface the real path, thread it out of `sendStandingMessage` and drop this branch.
        const pointer = delivery.inbox
          ? messagePointer({ id: message.id, from, stage, inbox: delivery.inbox, outbox: delivery.outbox })
          : `[ao] Message ${message.id} from ${from} (${stage}): read it with ${CLI_BIN} mailbox inbox --agent ${delivery.agent}, then reply.`;
        const rung = await ring({
          agentEntry: agent, agentId: delivery.agent, pointer,
          session: run.session, runDirForState: runDir, messageId: message.id,
        });
        delivered.push({ agent: delivery.agent, standing: Boolean(delivery.standing),
          rang: rung.rang, notification: rung.notification, delivery: rung.delivery });
      }
    } finally {
      // One control client per session, refcounted — a fan-out `--to a,b,c` costs one tmux client,
      // not three — but the process must not be held open by it.
      closeAllClients();
    }
```

`delivered[]` stays **additive**: every existing key keeps its meaning and type, `rang` stays the
boolean discriminator, and everything new lives under `delivery`
(`state`, `ring_capability`, `pane`, `waited_ms`, `typed`, `composer_empty_after`, `rungs`,
`attempts`, `reason`, `engaged`, `escalated`). `notification` widens to `submitted`,
`no-safe-bell`, `ring-skipped`, `stuck-in-composer`, `ring-failed`, `stale-binding` and
`submitted-inert`; **`durable-pending` keeps its current meaning exactly** — the file is in the
mailbox and no bell was rung — which is what an adapter with no measured composer still reports.

---

## 3. `send` — exit 3

**Context — the end of `send`, `topology/cli.mjs:830-843` (main).** This is the block `d79db04`
touched: `supervision:` is line 833, and it must keep running before the exit code is set, because a
degraded supervisor is not what exit 3 means.

```js
    out({
      ok: true,
      id: message.id,
      // The receiving repo is the run's, never the caller's cwd — same reasoning as routingConsumer.
      supervision: await ensureSupervision({ ...ctx, consumer: routingConsumer || ctx.consumer }),
      deliveries: message.deliveries,
      holds: message.holds,
      delivered,
      // A redirect is not an error, but the sender has to be told: it is waiting on an answer from
      // an agent that never received the message.
      redirected: message.redirects.length > 0 ? message.redirects : undefined,
      next: `${CLI_BIN} wait --run ${runDir} --from ${list(flags.to).join(",")} --message ${message.id} --timeout 20m`,
    });
  },
```

**Change — insert between the closing `});` of `out({…})` (line 843) and the `},` that ends `send`:**

```js
    // Exit 3 ONLY when the pane was judged safe and the pointer still did not land. Never for
    // `held` (nothing was typed, so nothing is wrong with the pane), never for an adapter with no
    // measured composer, never for `--no-ring`, and never for a degraded supervisor. `isUndelivered`
    // is that rule in one place.
    if (delivered.some((item) => isUndelivered(item.delivery))) process.exitCode = 3;
```

---

## 4. `ack` — optional, and nothing depends on it

Useful to a human or a hook; **nothing in the protocol requires it and no state depends on it** —
engagement is a `pane.log` byte offset, which costs zero model turns. Add to the command table:

```js
  async ack({ flags }) {
    const runDir = await runDirFrom(flags);
    const agentId = String(flags.agent && flags.agent !== true ? flags.agent : process.env.AO_AGENT_ID || "");
    const messageId = String(flags.message && flags.message !== true ? flags.message : "");
    invariant(agentId && messageId, "TOPOLOGY_ACK_INVALID", "Pass --agent <id> and --message <id>.");
    await appendJournal(runDir, { type: "message.acked", id: messageId, agent: agentId, note: flags.note && flags.note !== true ? String(flags.note) : null });
    out({ ok: true, id: messageId, agent: agentId });
  },
```

and to `USAGE`, immediately after the `wait` line (`topology/cli.mjs:66`):

```
  ack --run <run_dir> --agent <id> --message <id> [--note <text>]
                                               optional receipt; no state depends on it
```

Deliberately NOT wired to `ensureSupervision`: `ack` is a journal append that an agent or a hook may
fire at any moment, and it changes no standing state.

---

## 5. `status` — the `! UNDELIVERED` banner

**Context — `topology/cli.mjs:966-969` (main)**, unchanged by `d79db04`:

```js
    const stalled = Boolean(
      orchestrator && alive && run.state === "running" && !everSent && Number.isFinite(sinceLaunch) && sinceLaunch > 120_000,
    );
    const report = { run_id: run.run_id, name: run.name, session: run.session, session_alive: alive, state: run.state, run_dir: runDir, inputs: run.inputs, agents, pending_count: pending.length, queues, stalled, recent: journal };
```

**Change:**

```js
    const stalled = Boolean(
      orchestrator && alive && run.state === "running" && !everSent && Number.isFinite(sinceLaunch) && sinceLaunch > 120_000,
    );
    // Escalation is never silent. Two things land here: a bell that was judged safe and still did
    // not land, and a message that WAS submitted and then produced nothing — the latter is TM-122
    // (an agent that acknowledged its bootstrap and stopped) caught mechanically, for a stat().
    const undelivered = await undeliveredReport(runDir);
    const report = { run_id: run.run_id, name: run.name, session: run.session, session_alive: alive, state: run.state, run_dir: runDir, inputs: run.inputs, agents, pending_count: pending.length, queues, stalled, undelivered, recent: journal };
```

**And after the existing `if (stalled) { … }` block (`topology/cli.mjs:976-980`), add:**

```js
    if (undelivered.length > 0) {
      out(`  ! UNDELIVERED: ${undelivered.length} message${undelivered.length === 1 ? "" : "s"} reached the mailbox and were never driven.`);
      for (const item of undelivered) out(`    - ${item.message} → ${item.agent}: ${item.state} (${item.notification}) — ${item.reason}`);
      out(`    The message files are intact; only the bell failed. Re-ring one with: nudge --run ${runDir} --agent <id> --text "Read your inbox and answer <message-id> now."`);
    }
```

The wording deliberately mirrors the `! STALLED` block above it: name the condition, say what it
looks like, and end with the exact command that fixes it.

---

## Note on TM-139 (`absolutize`'s default parameter and a dead cwd)

Checked, because it is the same class of bug. **Nothing in `topology/lib/delivery.mjs` assumes a
live cwd.** It never calls `absolutize`, never calls `process.cwd()`, and every path it touches is
derived from the absolute `runDir` the CLI already resolved — `join(runDir, ".mailbox-sequence.lock")`,
`agentDir(runDir, agentId)`, `join(dir, "pane.log")`. Its tmux calls go through the existing
`tmux()` → `run()` path with `cwd` unset, exactly as every other caller in this layer already does,
so it adds no new exposure. The `join(process.cwd(), "providers")` in
`tests/unit/topology-delivery.test.mjs` is test-only and matches the convention in
`tests/unit/topology-mailbox.test.mjs`. I have not touched `util.mjs`.
