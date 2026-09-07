# client-rebrand

Take a client through a rebrand in six stages, one at a time, stopping for a human between each.

```
discovery → identity → direction → theme → brand → mockups
```

Each stage is a team of agents in tmux. Between stages **nothing is running** — which is what makes
this survive the way real client work actually goes: three directions go to the client on Tuesday
and come back on the following Monday.

## Using it

```bash
REBRAND=client-rebrand/bin/rebrand

$REBRAND new viking-surface-care --name "Viking Surface Care" \
    --input site=https://www.vikingpowerwashing.com \
    --input rename_from="Viking Power Washing"

export REBRAND_CLIENT=~/Documents/GitHub/ByteDeskAI/clients/viking-surface-care

$REBRAND status              # where the work got to
$REBRAND next                # run the next stage, if the gate allows
$REBRAND collect discovery   # record what the run produced
$REBRAND approve discovery --note "good, but the audit missed the vehicle wrap"
$REBRAND next                # stage 2
```

Stopping is closing the terminal. Resuming is `rebrand next`.

## They are ordinary ao-topology workflows

The six specs are native orchestration specs, and they resolve by name — the driver launches them
that way rather than by path, so anything that discovers workflows finds them:

```bash
AO=agent-orchestration/bin/ao-topology
WF=client-rebrand/workflows

$AO workflows --workflows-dir $WF                     # all six, with their descriptions
$AO inputs --workflow client-rebrand-3-direction --workflows-dir $WF
$AO launch --workflow client-rebrand-3-direction --workflows-dir $WF --input client_dir=<dir> ...
```

`--workflows-dir` is needed because spec resolution searches the consumer repo, `~/.config` and
`agent-orchestration`'s own `workflows/` — a sibling plugin is on none of those paths. The same is
true of the stage skills, which is why the driver also passes `--skills-dir` at
`bytedesk-designer/skills`. Running a stage through `rebrand` handles both.

## The gate

`next` refuses for exactly four reasons, and says which:

- an earlier stage is not approved — stages are serial;
- the stage produced its work and nobody has approved it;
- **it was approved and then the files changed** — the approval no longer describes what is on
  disk, and both digests are printed;
- it is marked complete but its folder is empty.

The third is the one worth having. `approve` records a sha256 over the stage's whole artifact set,
so an approval cannot come to describe a file that was edited afterwards. Adding or removing a file
breaks it too: a stage's deliverable is the set, not any one file in it.

## The case file

A git repository per client, outside this marketplace:

```
clients/viking-surface-care/
  state.json      brief, per-stage status, artifacts, approvals
  01-discovery/   brief.md, audit.md, assets/
  02-identity/    IDENTITY.md
  03-direction/   concepts/, prompts/, notes.md
  04-theme/       tokens.json, PALETTE.md
  05-brand/       *.png
  06-mockups/     *.png
  runs/           symlinks to each stage's orchestration run
```

`state.json` is `bytedesk-designer`'s run-folder contract plus an `approval` block per stage.

## Tests

```bash
bash client-rebrand/tests/test-rebrand.sh
```

No models, no network. The gate is the subject, and none of it needs an agent — the thing that
decides whether a client's money gets spent on the next stage is testable on its own.
