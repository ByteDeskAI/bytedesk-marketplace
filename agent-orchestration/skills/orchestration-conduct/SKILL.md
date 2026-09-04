---
name: orchestration-conduct
description: The conductor's protocol inside a launched tmux orchestration — write briefs, send them through the mailbox, wait for replies, route to judges, run revision rounds, stop at human gates, and write the final report. Loaded automatically by the orchestrator agent from its BOOTSTRAP.md; also useful when a human wants to drive a run by hand.
user-invokable: true
argument-hint: "(runs inside a launched orchestration; reads $AO_RUN_DIR)"
---

# Conduct a run

You are the orchestrator agent. Your run directory is `$AO_RUN_DIR` (also printed in your
BOOTSTRAP.md). `AO` below is the `ao-topology` launcher named in your bootstrap file.

The workflow stages, agents, inputs, and gates are in your BOOTSTRAP.md. The spec that generated
them is `$AO_RUN_DIR/run.json`. Read both before the first stage.

## The loop, per stage

1. **Write the brief as a file** under `$AO_RUN_DIR/artifacts/conductor/<stage>-round<N>.md`. A
   brief contains, in this order: goal in one paragraph; inputs as absolute paths; the output
   contract (required headings, file formats, where to put files); constraints and bans quoted
   verbatim from their source; how success is judged; the deadline. If a skill in your bootstrap
   provides a brief template (for example `brand-brief`), use it — it knows the domain.
2. **Send it** to every recipient in one call so they receive the identical file:
   `AO send --run $AO_RUN_DIR --from <your id> --to a,b --stage <stage> --round <N> --contract <name> --file <brief.md>`
   The command prints the message id (`003-brief`) and the exact `wait` command to run next.
3. **Wait**: `AO wait --run $AO_RUN_DIR --from a,b --message <id> --timeout <stage timeout>`.
   It blocks and then prints every reply in full. On `TIMEOUT`, do not resend. Run
   `AO capture --run $AO_RUN_DIR --agent <id> --lines 80`, decide whether the agent is working,
   stuck at a prompt, or waiting for approval, and either wait again (`--timeout 10m`) or
   `AO nudge --run $AO_RUN_DIR --agent <id> --text "<one short instruction>"`.
   If the screen shows a usage limit, rate limit, login prompt, a dead pane, or the agent has
   been silent for two waits with no file activity, **fail it over**:
   `AO failover --run $AO_RUN_DIR --agent <id>` — it restarts the agent on the next provider in
   its chain, re-sends the bootstrap, and re-delivers every message it has not answered. Then
   wait again. If the chain is exhausted the command says so; report it at the next gate rather
   than improvising a replacement.
4. **Check replies against the contract** before anything else. A reply missing a required
   heading or a listed deliverable goes back to its author as a new message (`--stage <stage>`,
   `--round <N>`, body = what is missing). Do not repair it yourself.
5. **Route to the judge or reviewer** (if the workflow has one): the message body is the original
   brief plus the absolute path of every candidate's reply and deliverables. Ask for exactly one
   verdict in the scorecard contract.
6. **Act on the verdict**:
   - `accept <candidate>` → proceed to the next stage or the gate.
   - `revise <candidate> — fixes` → send only the named candidates a revision message: "keep the
     concept; apply fixes 1, 3, 4" with the judge's text quoted. Increment the round. Stop after
     `max_rounds` and go to the gate with the best candidate and the open findings.
   - `reject all` → one restart of the stage with a sharpened brief that names why every
     candidate failed; if that also fails, go to the gate and report.
7. **Journal decisions.** Whenever you pick a winner, drop a candidate, extend a timeout, or
   deviate from the workflow, write `$AO_RUN_DIR/artifacts/conductor/decision-<stage>-<N>.md`
   with three lines: what, why, evidence path.

## Human gates

When you reach a gate: write `$AO_RUN_DIR/artifacts/GATE-<stage>.md` (state, candidates, verdict,
scorecard path, what approval would mean), then print a short summary in your terminal and ask
the operator a direct question. Wait for their typed answer. Continue only on an explicit yes;
on changes, treat their text as a revision message; on no, stop and report.

## Finishing

Write `$AO_RUN_DIR/artifacts/REPORT.md`: what was produced (paths), the winner and why, what was
rejected and why, timings per stage (`AO journal --run $AO_RUN_DIR`), open problems, and the
promotion step the spec's `artifacts.promote_to` describes — which you recommend, never perform.
Then say the run is complete. Do not stop the tmux session; the operator does.

## Rules

- One message per stage per recipient. Never type a brief directly into another agent's pane.
- Competing agents get the same brief file. Never tailor a brief to a model.
- Never write into another agent's mailbox or edit their deliverables.
- Never promote, commit, push, or publish. Recommend; the operator acts.
- Keep terminal output short; files carry the substance.
