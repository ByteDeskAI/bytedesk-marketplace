---
name: client-rebrand
description: Take a client through a rebrand one gated stage at a time — discovery, identity, direction, colour and theme, logo and brand, website mockups — pausing for the operator's approval between each. Use when someone says a client is rebranding, changing their name, needs a new logo and identity, wants brand concepts or website mockups, or asks to pick a rebrand back up where it was left. Also use to check where a client's rebrand got to.
user-invokable: true
argument-hint: "<client-slug> | new <slug> --name \"<client>\" | status | next | approve <stage>"
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
---

# Client rebrand

Six stages, in order, each one a tmux agent team, with a human approval between each.

```
discovery → identity → direction → theme → brand → mockups
```

The operator approves every stage. You never approve one on their behalf, and you never start a
stage the driver refuses — the refusal is the product, not an obstacle.

## The one command you need

`bin/rebrand` in this plugin owns the case file and the gate. Everything below goes through it.

```bash
REBRAND=${CLAUDE_PLUGIN_ROOT}/bin/rebrand

$REBRAND new <slug> --name "<Client Name>" --input site=<url> --input rename_to="<new name>"
$REBRAND status --client <dir>          # where the work got to
$REBRAND next --client <dir>            # run the next stage, if the gate allows
$REBRAND collect <stage> --client <dir> # record what a finished run produced
$REBRAND approve <stage> --client <dir> --note "<what the operator said>"
$REBRAND reject <stage> --client <dir> --why "<what has to change>"
```

Set `REBRAND_CLIENT` once and drop `--client`.

## What to do

1. **Find out where it is.** `status` first, always — including when the operator sounds certain.
   A case file is the authority on which stage is next, not the conversation.
2. **Run one stage.** `next` launches that stage's agent team into tmux and returns a run
   directory. Report the run directory and the attach command; do not sit and poll the panes.
3. **When the run finishes, `collect`.** That copies what the run produced into the stage folder
   and records it. It refuses when the run produced nothing, which is a real outcome worth
   reporting rather than working around.
4. **Show the operator the deliverables and stop.** Name the files, say what changed since the
   last round, and give your own read of the work — but the decision is theirs. Then wait.
5. **On their word, `approve` or `reject`.** A rejection needs `--why`; that text becomes the
   brief for the next round, so write down what they actually objected to rather than a summary.

## The four refusals, and what each one means

`next` fails for exactly four reasons. Relay the message; do not route around it.

| Refusal | What it means | What unblocks it |
|---|---|---|
| an earlier stage is not approved | stages are serial | approve the earlier one |
| produced but nobody approved it | the work is done, the decision is not | the operator looks, then `approve` |
| **approved then changed** | a deliverable was edited after sign-off | re-approve deliberately, or restore the files |
| marked complete, folder empty | the files were deleted or never landed | re-run the stage |

The third is the one that matters. An approval is bound to a sha256 over the stage's whole
artifact set, so it cannot come to describe a file that changed afterwards. If you hit it, say
plainly that what was approved and what is on disk are no longer the same thing, and show both
digests. Never re-approve to clear it unless the operator says to.

## Stopping and picking it up again

There is nothing to stop. Between stages no process is running — the tmux session for the last
stage is gone and the next has not started. The case file on disk is the entire state.

So "we're waiting on the client" is just: stop reading. Days later, `status` says where it got to
and `next` continues. A fresh session with no memory of the earlier one is in exactly the same
position as one that has been running all week, which is the design rather than a limitation.

## What never happens here

- **Never approve a stage yourself.** Not even when the work is obviously good and the operator is
  asleep. The gate exists because a client is paying for the next stage.
- **Never edit a deliverable after it was approved** to "fix a small thing". That breaks the
  digest, correctly, and turns a clean case file into one that needs explaining.
- **Never skip a stage** because its input seems obvious. Stage 4 without stage 3 is a palette
  chosen against nothing.
- **Never hand the client raw run output.** The run directory holds mailboxes, panes and rounds;
  the stage folder holds the deliverable. Only the second is theirs.
