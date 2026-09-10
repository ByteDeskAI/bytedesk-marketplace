# Running the EP-018 demo

A governed orchestration, end to end, in about ten minutes: two standing roles, a three-agent run,
two verified deliveries, two replies, a liveness census, and a clean teardown.

It exists because every claim EP-018 makes is about behaviour on live panes, and four attempts at
this demo produced four defects that no unit test had found — TM-155, TM-151, TM-157 and TM-160.
**Run it after any change to the launch, delivery or readiness paths.** It finds what the suites
cannot.

## Choose a repository

Any repository that is **idle and clean**. Not the marketplace checkout — the demo writes
`.bytedesk/` and you want that removal to be trivially safe.

It must be one **Claude has been trusted in**, or the first agent session stops at the folder-trust
question and nothing types at that screen, by design. `ao-topology doctor` reports this as
`CLAUDE_FOLDER_UNTRUSTED` once TM-155 lands. To trust one: `cd <repo> && claude`, answer
"Yes, I trust this folder", Ctrl-C. It is asked once per repository — agent subdirectories inherit it.

## Run it

```bash
REPO=/path/to/an/idle/repo
PLUG=/path/to/bytedesk-marketplace/agent-orchestration

# An isolated tmux socket. KEEP THE PATH SHORT: tmux builds $TMUX_TMPDIR/tmux-<uid>/default and a
# unix socket path is capped near 104 bytes — a per-session scratch directory blows through it and
# tmux answers "File name too long", which reads like a filename problem and is not (TM-155).
export TMUX_TMPDIR=/tmp/aodemo; mkdir -p "$TMUX_TMPDIR"; export TMUX=''

# A readiness probe rings the pane and waits for a MODEL TURN. The defaults are tuned for a machine
# that answers quickly; give it room (TM-157).
export AO_PROBE_TIMEOUT_MS=150000 AO_LEAD_ACK_TIMEOUT_MS=150000

cd "$REPO"
mkdir -p .bytedesk/agent-orchestration
cat > .bytedesk/agent-orchestration/config.json <<JSON
{
  "templates": {
    "lead-default":     { "role": "lead",     "cli": "claude", "prompt": "$PLUG/prompts/lead.md" },
    "reviewer-default": { "role": "reviewer", "cli": "claude", "prompt": "$PLUG/prompts/reviewer.md" }
  }
}
JSON
```

> **Why the config names absolute prompt paths.** A repo config template **replaces** the default
> rather than merging with it, and a relative `./prompts/lead.md` resolves against the *repository*,
> where it does not exist. Copying the documented default value is the trap; both failures used to
> report only `Invalid lead prompt; refusing restart` (TM-155 names the key now).

```bash
node $PLUG/bin/ao-topology doctor --json          # answer anything it reports before continuing
node $PLUG/bin/ao-topology lead ensure --json
node $PLUG/bin/ao-topology reviewer ensure --json

# Both must read `responsive`. Each costs one model turn, and the proof is cached, so ask for them
# one at a time and expect the first call to take a while.
node $PLUG/bin/ao-topology role status lead --json
node $PLUG/bin/ao-topology role status reviewer --json

node $PLUG/bin/ao-topology launch \
  --spec "$REPO/.bytedesk/agent-orchestration/workflows/ep018-demo.json" \
  --allow-auto-approve --json
```

`launch` refuses with `TOPOLOGY_STARTUP_NOT_READY` unless **both** roles are responsive, and creates
nothing when it refuses.

```bash
RUN=$(ls -dt "$REPO"/.bytedesk/agent-orchestration/runs/*/ | head -1)

# --from-project is REQUIRED. Without it the send is external, admission holds it, and the reply is
# `source_identity_required` rather than a delivery.
node $PLUG/bin/ao-topology send --run "$RUN" --from conductor --to scribe --stage describe \
  --from-project "$REPO" --json \
  --body "In one sentence: what is this repository? Read README.md in your cwd and reply in the same turn."

node $PLUG/bin/ao-topology wait --run "$RUN" --from scribe --timeout 7m --json
cat "$RUN/agents/scribe/outbox/"*describe*.reply.md

node $PLUG/bin/ao-topology census --json
```

## What to look for

| Signal | Meaning |
|---|---|
| `ring: … submitted` | the pointer was typed and the composer emptied — a verified delivery |
| `ring: … stuck-in-composer` | **may be a false alarm — see TM-160.** Check the outbox before believing it |
| `holds: [{reason: "source_identity_required"}]` | you omitted `--from-project` |
| census `state`, `dispatchable` | the census has been right every time it disagreed with another layer |

## Tear down — all of it

```bash
tmux -S "$TMUX_TMPDIR/tmux-$(id -u)/default" kill-server     # SOCKET-SCOPED. Never a bare kill-server.
pkill -f "ao-topology supervise.*$(basename $REPO)"
rm -rf "$REPO/.bytedesk"
STATE=~/.local/state/bytedesk/agent-orchestration
grep -rl "$(basename $REPO)" "$STATE" | xargs -r rm -f
rm -rf "$TMUX_TMPDIR"
```

Then verify: `git -C "$REPO" status --porcelain` is empty, and your own tmux sessions are untouched.

> **A bare `tmux kill-server` from a demo or a test destroyed 37 live agent sessions on this machine
> once.** `.claude/rules/tmux-test-isolation.md` is the rule that came out of it: blank `TMUX`, set
> `TMUX_TMPDIR`, and scope every kill with `-S` or `-L`. All three, every time.

## Known caveats, so you can tell a demo bug from a real one

- **TM-160** — a delivered message can report `stuck-in-composer`. The styled composer check reaches
  the ring gate but not the landing verdict, so a pane rendering a dim suggestion after a successful
  submit reads as an unsent draft. Wrong in the safe direction; check the outbox.
- **TM-155** — an untrusted repository stalls silently at the folder-trust modal.
- **TM-151** — a ready composer showing a placeholder hint can read as not-ready.
- The agents run with `auto_approve` (`--dangerously-skip-permissions`). That is why the demo repo
  should be idle and disposable, and why `--allow-auto-approve` is required to launch it.
