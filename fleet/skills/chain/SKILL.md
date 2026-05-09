---
name: fleet-chain
description: Dependency-aware multi-stage orchestration of parallel sessions. Spawn stage 1 in parallel; the always-on rules engine then spawns stage 2 once stage 1 is all done, stage 3 once stage 2 is done, and so on. The skill itself returns immediately — chains survive the chat session ending. Use when the user says "fleet chain", "/fleet-chain", "spawn A then B", "after BDP-N finishes spawn BDP-M", or any phrasing about multi-stage orchestration of sessions.
user-invokable: true
argument-hint: "<stage1> then <stage2> [then <stage3> ...]    # each stage is space-separated tickets"
allowed-tools:
  - Bash
  - Read
  - Write
  - mcp__plugin_atlassian_atlassian__getJiraIssue
  - mcp__plugin_atlassian_atlassian__getTransitionsForJiraIssue
  - mcp__plugin_atlassian_atlassian__transitionJiraIssue
---

## What this skill does

Orchestrates dependency chains across the multi-session command center, **without blocking the chat session**. The skill:

1. Spawns stage 1 immediately (via `/fleet-spawn`).
2. Writes one rule file per subsequent stage to the rules engine.
3. Reports the chain plan and exits.

The always-on notifier daemon (the rules engine) evaluates rules every 5s and fires the next stage's spawn the moment the previous stage's sessions all reach `done`. Because rules live as files in `~/.claude-sessions/rules/`, the chain continues to execute even after this chat session ends, after Claude restarts, or across reboots (rules persist; the daemon re-reads on startup).

```
/fleet-chain BDP-A BDP-B then BDP-C
```
spawns A and B immediately; installs one rule that, when both A and B are `done`, spawns C.

```
/fleet-chain BDP-A then BDP-B then BDP-C
```
strictly serial — A spawned now, rule for B (waits A done), rule for C (waits B done).

## Steps

1. Parse the argument string by splitting on the literal token `then`. Each segment is one stage; each stage is one or more space-separated tickets (with optional `=slug` syntax matching `/fleet-spawn`).
2. Validate every ticket exists in Jira (single `mcp__plugin_atlassian_atlassian__getJiraIssue` per ticket; abort the whole chain if any is invalid).
3. **Pre-write all prompt files** — for every ticket in every stage, write its prompt to `/tmp/<TICKET>-prompt.txt` now. The rules engine references these paths when firing.
4. Show the plan to the user; ask for confirmation if there are 3+ stages or 5+ total tickets.
5. **Spawn stage 1 immediately** — invoke `/fleet-spawn` with stage 1's tickets (handles Jira transitions + spawn).
6. **Install rules for stages 2..N** — for each subsequent stage, write a rule file with `claude-sessions rules` semantics:

   ```bash
   CHAIN_ID="chain-$(date +%s)-$$"
   STAGE_NUM=2
   RULE_ID="${CHAIN_ID}-stage${STAGE_NUM}"
   RULE_FILE="$HOME/.claude-sessions/rules/${RULE_ID}.json"

   # The exec for stage N is: spawn this stage's tickets via spawn-claude-feature
   # (one call per ticket, since spawn-claude-feature is one-ticket-per-invocation).
   EXEC=$(cat <<'BASH'
   set -e
   spawn-claude-feature BDP-C BDP-C-slug --prompt-file /tmp/BDP-C-prompt.txt --full-auto
   BASH
   )

   jq -n --arg id "$RULE_ID" \
         --argjson wait_for '["BDP-A","BDP-B"]' \
         --arg wait_state "done" \
         --arg exec "$EXEC" \
         --argjson timeout 60 \
         --arg created "$(date -Iseconds)" \
         --arg label "Chain stage 2 of 3: spawn BDP-C after BDP-A,BDP-B done" \
         '{id:$id, wait_for:$wait_for, wait_state:$wait_state, exec:$exec, timeout_min:$timeout, created:$created, label:$label}' \
         > "$RULE_FILE"
   ```

   Stage N's `wait_for` = stage N-1's tickets. Stage N's `exec` = spawn-claude-feature calls for stage N's tickets, semicolon-joined. Set `timeout_min` to 120 (2h) per stage by default — long enough for most feature implementations.

7. **Transition Jira tickets for later stages** — they remain in their current status (typically `To Do`) until their stage fires. The spawned session itself transitions to In Progress at spawn time. (Exception: if the user wants visibility, you can pre-transition them to `Selected for Development` if that status exists; otherwise leave them.)

8. Report the chain plan with rule IDs and exit.

## Output format

```
Chain installed: chain-1715287200-12345

  Stage 1 (firing now):    BDP-A, BDP-B
  Stage 2 (rule pending):  BDP-C            ← when BDP-A, BDP-B reach done
  Stage 3 (rule pending):  BDP-D, BDP-E     ← when BDP-C reaches done

Rules:
  chain-1715287200-12345-stage2  → spawns BDP-C
  chain-1715287200-12345-stage3  → spawns BDP-D, BDP-E

The rules engine (always-on) will fire each stage automatically.

  See pending rules:    claude-sessions rules
  Cancel a stage:       claude-sessions rules cancel <rule-id>
  Watch the fleet:      /fleet
                        http://127.0.0.1:7681/

This skill is done — the chain runs in the background. Close this chat any time.
```

## Constraints

- Stages are dependency-ordered; sessions WITHIN a stage are parallel.
- Pre-write ALL prompt files before installing any rules — a missing prompt file when a rule fires will cause the spawn to fail silently in the rule log.
- Rules default to a 2h per-stage timeout. If a stage takes longer than that, the rule is removed and the chain stalls; user can re-install manually.
- Do not auto-kill sessions on stall — the user decides.
- Do not auto-retry failed sessions.
- If the same ticket appears in multiple stages, refuse the chain — that's almost certainly a typo.
- If `claude-sessions service status notify` shows the daemon is not active, refuse the chain and tell the user to start it: `claude-sessions service start notify`. Without the daemon, no rule will ever fire.

## Why this design

The previous version of this skill polled `/fleet-wait` between stages, which meant the chat session was blocked for the entire chain duration (sometimes hours) and the chain died if Claude restarted. The rules-engine version moves orchestration into the always-on daemon: skill writes intent (rules), daemon executes intent. Skill returns in seconds; chain continues independently.

## Examples

```
/fleet-chain BDP-360                                                    # degenerate single-stage; just spawns
/fleet-chain BDP-360 BDP-361 then BDP-362                               # 2 in parallel, then 1
/fleet-chain BDP-360 then BDP-361 then BDP-362                          # serial 3-stage
/fleet-chain BDP-360 BDP-361 BDP-362 then BDP-363 then BDP-364 BDP-365  # 3 → 1 → 2
```
