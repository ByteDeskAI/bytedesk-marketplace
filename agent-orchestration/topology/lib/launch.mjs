// Launch a materialized spec: write the run directory, one bootstrap file and one launcher per
// (agent, candidate), create the tmux session, start every agent on the first candidate in its
// fallback chain that actually comes up, and deliver each agent its bootstrap pointer.
// `failoverAgent` re-runs the same start logic for one agent from the next candidate mid-run.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { composePrompt } from "./prompts.mjs";
import { loadConfig } from "./config.mjs";
import { appendJournal, agentDir, loadRun, pendingReplies, saveRun } from "./mailbox.mjs";
import { composerEmptyStyled } from "./delivery.mjs";
import { childEnv, childrenFile, lineageFromEnv, lineageRefusal } from "./lineage.mjs";
import { adapterFor, attentionOnScreen, buildArgv, commandExists, failureOnScreen, grantsDirs, memoryLocation } from "./providers.mjs";
import { displayName, mintSpawn, roleVisual, sessionName } from "./identity.mjs";
import { sameIncarnation } from "./incarnation.mjs";
import { promotePromptForIncarnation } from "./prompt-lifecycle.mjs";
import { loadRole, resolveSkill } from "./resolve.mjs";
import * as tmux from "./tmux.mjs";
import { ensureRunsIgnored, exists, fail, invariant, nowIso, readJson, render, shellQuote, sleep, terminalText, writeJson, writeText } from "./util.mjs";

const POINTER_TEMPLATE = "[ao] Message {{id}} from {{from}} ({{stage}}): read {{inbox}} then write your complete reply to {{outbox}}";

export function messagePointer(fields) {
  return render(POINTER_TEMPLATE, fields);
}

export function candidateLabel(candidate) {
  return candidate.model ? `${candidate.cli}:${candidate.model}` : candidate.cli;
}

function describeAgents(spec, selfId) {
  return spec.agents
    .map((agent) => {
      const you = agent.id === selfId ? " ← you" : "";
      // A participant is a whole team behind one address. Say so: the conductor addresses it exactly
      // like an agent, but knowing there are several people back there changes how you brief it, and
      // it has no provider chain to report.
      if (agent.workflow) {
        return `- \`${agent.id}\` — a TEAM running the \`${agent.workflow}\` workflow. Address it like any other agent; its own conductor answers you.${you}`;
      }
      const chain = (agent.candidates ?? []).map(candidateLabel).join(" → ");
      return `- \`${agent.id}\` — role ${agent.role}, providers ${chain}${you}`;
    })
    .join("\n");
}

function describeWorkflow(spec) {
  const stages = spec.stages ?? spec.workflow ?? [];
  if (stages.length === 0) return "_No fixed stage list; the conductor decides the stages from the mission._";
  return stages
    .map((stage, index) => {
      const parts = [`${index + 1}. **${stage.stage}**`];
      if (stage.from) parts.push(`from \`${stage.from}\``);
      if (stage.to.length) parts.push(`to ${stage.to.map((id) => `\`${id}\``).join(", ")}`);
      if (stage.wait_for.length) parts.push(`wait for ${stage.wait_for.map((id) => `\`${id}\``).join(", ")}`);
      if (stage.contract) parts.push(`contract \`${stage.contract}\``);
      if (stage.timeout) parts.push(`timeout ${stage.timeout}`);
      if (stage.loop_until) parts.push(`repeat until \`${stage.loop_until}\`${stage.max_rounds ? ` (max ${stage.max_rounds} rounds)` : ""}`);
      const line = parts.join(" · ");
      return stage.description ? `${line}\n   ${stage.description}` : line;
    })
    .join("\n");
}

/**
 * The sentence that gets a conductor off the starting line.
 *
 * The pane's bootstrap message asks every agent to read its brief and reply READY. For a WORKER
 * that is the whole job — it then waits for mail, and an agent that invented work for itself would
 * be a worse bug than this one. For the ORCHESTRATOR it is exactly half the job, and the licence to
 * start the mission is the last line of a 118-line document it has just been told to "follow
 * exactly". Replying READY and stopping is a fair reading of the instruction it was handed, which
 * is why it happened twice on `claude:opus` in clean repositories and not at all in between.
 *
 * So the instruction is completed here rather than argued with. It rides on the SAME message as the
 * bootstrap pointer, not a second one: a follow-up send would race the agent's own first turn, and
 * arrive in a composer that is busy reading the brief.
 */
export const BEGIN_CLAUSE =
  " Then begin the mission immediately, in the same turn — do not stop after READY and do not wait" +
  " for another message. You are the conductor: nobody is going to tell you to start.";

/**
 * Send the bootstrap pointer, then CHECK IT ARRIVED.
 *
 * The launcher used to send and warn: when readiness timed out it typed the pointer anyway and said
 * "bootstrap pointer was sent anyway", which is a guess. On a real client run the guess was wrong —
 * two Claude agents timed out on their startup banner, the pointer was typed into panes whose TUI
 * had not yet attached a key handler, and the keystrokes went nowhere. The composers were EMPTY,
 * which is the tell: unsent text sitting in a composer is a different bug (the paste-and-settle one
 * above). This is typing before anything is listening at all. Nothing errored, and the run sat with
 * healthy agents and an empty mailbox until a human noticed.
 *
 * Verification is a substring of the pointer appearing on the pane — whether the agent has submitted
 * it or it is still in the composer, both mean it was RECEIVED, and only "not there at all" is the
 * failure. Whitespace is squashed on both sides because a long path wraps, and a wrapped line breaks
 * a naive match.
 *
 * A false negative costs a duplicate bootstrap, which makes an agent read its brief twice. Silent
 * total loss costs the run. That trade is not close.
 */
const squash = (text) => String(text ?? "").replace(/\s+/g, "");

export async function deliverPointer(pane, adapter, pointer, { attempts = 3, settleMs = 2000 } = {}) {
  const needle = squash(pointer).slice(0, 48);
  // Count occurrences, do not merely look for one. `captureAll` reads the whole scrollback, so on a
  // failover — where the pane is respawned and its history survives — the PREVIOUS attempt's echo
  // would confirm a delivery that never happened. A count that has gone up is the only evidence
  // that this send landed. Found by the test for this function, which respawns a pane and would
  // otherwise have passed on the corpse of an earlier attempt.
  const occurrences = async () => {
    const screen = await tmux.captureAll(pane);
    return screen === null ? null : squash(screen).split(needle).length - 1;
  };
  let before = (await occurrences()) ?? 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await tmux.sendText(pane, pointer, adapter.submit_keys);
    await sleep(settleMs);
    const after = await occurrences();
    // A capture we could not take says nothing either way: try again rather than declaring success
    // or failure from a screen this process never read.
    if (after !== null && after > before) return { delivered: true, attempts: attempt };
    if (after !== null) before = after;
  }
  return { delivered: false, attempts };
}

function describeGates(spec) {
  if (spec.gates.length === 0) return "_No human gates declared._";
  return spec.gates.map((gate) => `- after **${gate.after}**: ${gate.human ? "stop and ask the operator" : "automatic"}${gate.description ? ` — ${gate.description}` : ""}`).join("\n");
}

function describeInputs(spec) {
  const entries = Object.entries(spec.inputs_resolved ?? {});
  if (entries.length === 0) return "_None._";
  return entries.map(([key, value]) => `- **${key}**: ${value}`).join("\n");
}

function bootstrapText({ spec, agent, role, skills, cliBin }) {
  const self = agentDir(spec.run_dir, agent.id);
  const isConductor = agent.role === "orchestrator";
  const skillLines = skills.length === 0
    ? "_No skills assigned._"
    : skills.map((skill) => (skill.path ? `- \`${skill.name}\` → read \`${skill.path}\` now` : `- \`${skill.name}\` → NOT FOUND; say so in your first reply and continue without it`)).join("\n");
  return `# Bootstrap — agent \`${agent.id}\` in orchestration \`${spec.name}\`

You are one agent in a tmux-hosted multi-agent run. Read this whole file, then read every skill
listed under "Skills", then reply in your terminal with the single word READY.

## Identity

- Agent id: \`${agent.id}\`
- Role: **${agent.role}**
- Provider chain: ${agent.candidates.map(candidateLabel).join(" → ")} (the conductor can fail you over to the next one)
- Run id: \`${spec.run_id}\`
- Run directory: \`${spec.run_dir}\`
- Your mailbox: inbox \`${join(self, "inbox")}\`, outbox \`${join(self, "outbox")}\`
- Shared artifacts: \`${join(spec.run_dir, spec.artifacts.dir)}\`
- Working directory: \`${agent.cwd}\`

## Agents in this run

${describeAgents(spec, agent.id)}

## Inputs

${describeInputs(spec)}

## Mailbox protocol (all agents)

1. A message arrives as a file in your inbox. Poll that directory at safe boundaries, including
   after startup and after finishing each reply. Delivery does not type into your terminal.
   A terminal pointer, if one is supplied by the operator, is only a bell; the file is the message.
2. Read the message file, then **do the work in the same turn you read it**. Do not stop to
   confirm receipt and wait to be told to continue — nobody is going to tell you. If you are
   blocked or the request is ambiguous, still write a reply saying what is missing.
3. Write your complete reply to the exact outbox path named in the message. The reply file is the
   only thing the sender reads — never rely on what you print in the terminal.
4. Prefer this helper to write the reply (it also journals it):
   \`${cliBin} reply --run ${shellQuote(spec.run_dir)} --agent ${agent.id} --message <id> --file <your-draft.md>\`
   Writing the outbox file directly is also acceptable.
5. Put deliverables (files, images, code) under the shared artifacts directory in a subfolder named
   after your agent id and the message id, and list their paths in the reply.
6. Never write outside the run directory or your working directory unless a message explicitly
   authorizes a path. Never edit another agent's mailbox.
7. If you are blocked or the request is ambiguous, still write a reply: say what is missing.
8. If your own provider stops serving you (usage limit, auth), say so in the terminal; the
   conductor will fail you over to the next provider in your chain and your mailbox survives.

## Skills

${skillLines}

## Role

${role.text.trim()}
${role.fallback ? "\n_(fallback role pack — no specific pack found for this role)_\n" : ""}
${agent.instructions ? `## Additional instructions for this agent\n\n${agent.instructions.trim()}\n` : ""}
${isConductor ? `## Workflow you conduct

${describeWorkflow(spec)}

## Human gates

${describeGates(spec)}

## Conductor commands

Send a message (writes durable inbox files and journals; recipients poll at safe boundaries):
\`${cliBin} send --run ${shellQuote(spec.run_dir)} --from ${agent.id} --to <id>[,<id>] --stage <stage> --file <message.md>\`

Wait for replies (blocks until every recipient's reply file exists or the timeout passes):
\`${cliBin} wait --run ${shellQuote(spec.run_dir)} --from <id>[,<id>] --message <id> --timeout 20m\`

Look at an agent's screen when a wait times out:
\`${cliBin} capture --run ${shellQuote(spec.run_dir)} --agent <id> --lines 80\`

Fail an agent over to the next provider in its chain (usage limit, auth failure, dead pane);
pending messages are re-delivered automatically:
\`${cliBin} failover --run ${shellQuote(spec.run_dir)} --agent <id>\`

Status and journal: \`${cliBin} status --run ${shellQuote(spec.run_dir)}\`

Begin when you have replied READY: the mission is the inputs above plus the workflow.
` : ""}
`;
}

export function launcherScript({ agent, candidate, argv, env }) {
  const lines = ["#!/usr/bin/env bash", `# Generated by ao-topology. Runs agent ${agent.id} on ${candidateLabel(candidate)} inside its tmux pane.`, "set -u", `cd ${shellQuote(agent.cwd)}`];
  for (const [key, value] of Object.entries(env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) fail("TOPOLOGY_ENV_INVALID", `Agent ${agent.id}: env name "${key}" is not a valid variable name.`);
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  // The printf argument is written to the terminal raw, so a role typed at `agent new --role` with an
  // ESC or BEL in it would inject a sequence. Ordinary text passes through unchanged (TM-168).
  lines.push(`printf '\\033]2;%s\\007' ${shellQuote(terminalText(`${agent.id} · ${agent.role} · ${candidateLabel(candidate)}`))}`);
  lines.push(`exec ${argv.map(shellQuote).join(" ")}`);
  return `${lines.join("\n")}\n`;
}

/**
 * Everything about readiness that is a decision rather than an I/O call, so it can be tested
 * without a tmux server.
 *
 * `screenSince` is the fix for the false positive: the pane already holds a shell prompt and the
 * echoed launcher line when we start looking, and a ready pattern like /[>\u276f]/ matches a bare zsh
 * or starship prompt perfectly well. Only output produced after the launcher was sent counts.
 *
 * `baseline` is the unique marker `clearAndWaitForShell` printed into the pane, NOT a snapshot of
 * the screen. That distinction is the whole correctness of this function: a snapshot of a
 * freshly-cleared pane is whitespace, and whitespace matches inside the blank tail of a later
 * capture as readily as at the point it was taken — so the slice would land past the agent's output
 * and hand back "", and the agent would never look ready. A marker can only match where it was
 * printed.
 */
/**
 * TM-168. The icon and role label for one run agent: the declared run role, or a nested team for a
 * workflow participant. Computed from `role` every time, including for a run.json written before
 * this existed — and never taken from a stored `roleIcon`, because every agent in the run can write
 * run.json. Display-only.
 */
export function runAgentVisual(agent) {
  return roleVisual({ runRole: agent?.role ?? null, nestedTeam: Boolean(agent?.workflow) });
}

export function screenSince(screen, baseline) {
  const text = String(screen ?? "");
  // A blank anchor carries no position. Refusing to use one is what stops the silent truncation
  // above; returning the whole screen is the safe direction, because the alternative is discarding
  // the very output being waited for.
  if (!baseline || !String(baseline).trim()) return text;
  // Anchor on the last occurrence rather than a prefix match: tmux trims trailing blank lines, so a
  // snapshot taken earlier is not reliably a prefix of a later one.
  const at = text.lastIndexOf(baseline);
  return at === -1 ? text : text.slice(at + baseline.length);
}

/**
 * Verdict on one look at a pane. `null` means "nothing decided yet, keep waiting"; only the
 * ready-pattern path can return it. The fixed-delay path always decides, which is what makes
 * ready:false reachable for the five adapters that have no pattern.
 */
/**
 * The composer is the LAST line carrying a prompt glyph. Earlier ones are scrollback — an agent's
 * own answer can quote a glyph, and the box is redrawn at the bottom.
 */
export function lastComposerLine(styledScreen) {
  const lines = String(styledScreen ?? "").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) if (/[>\u276f]/.test(lines[i])) return lines[i];
  return "";
}

export function evaluateScreen(adapter, screen, { alive = true, styled = null } = {}) {
  // Before the generic failure list, because these screens are specific and it is not: the trust
  // modal contains the word "exit" and a login screen says "not logged in", and both would otherwise
  // be reported as an unexplained provider fault when what they need is one keystroke from a person.
  const attention = attentionOnScreen(adapter, screen);
  if (attention) return { ready: false, failed: true, attention: true, reason: attention.message };
  const failure = failureOnScreen(adapter, screen);
  if (failure) return { ready: false, failed: true, reason: `screen matched failure pattern /${failure}/` };
  if (!alive) return { ready: false, failed: true, reason: "pane exited" };
  if (adapter.ready.pattern) {
    if (new RegExp(adapter.ready.pattern, "m").test(screen)) return { ready: true, failed: false, reason: "ready pattern" };
    /**
     * TM-151. The pattern is a TEXT test, and text cannot answer this question. A composer holding
     * Claude's dim suggestion is READY; one holding a human's typed draft is not — and after the
     * prompt glyph both are ordinary letters. The literal `Try "` branch in the shipped pattern
     * only ever covered the fresh-session hint; an idle agent renders `❯ init the task store` and
     * scores zero, which is why a healthy reviewer never registered.
     *
     * The discriminator is STYLE, and `capture-pane -e` is the only thing that keeps it, so the
     * caller supplies a styled screen and this stays a pure decision.
     *
     * Consulted ONLY after the pattern has already failed, and it can only ever turn "keep waiting"
     * into "ready" by PROVING every visible character after the glyph is ghost text. Anything it
     * cannot parse stays undecided, which is the same direction `delivery.mjs` takes for the same
     * reason: this never widens what counts as ready on its own.
     */
    if (styled && composerEmptyStyled(lastComposerLine(styled))) {
      return { ready: true, failed: false, reason: "composer empty by style" };
    }
    return null;
  }
  const delay = adapter.ready.delay_ms ?? 3000;
  if (screen.trim().length === 0) {
    return {
      ready: false,
      failed: false,
      reason: `no output from ${adapter.id} after ${delay}ms; it may still be starting. Give this adapter a ready.pattern for a real check.`,
    };
  }
  return { ready: true, failed: false, reason: "fixed delay" };
}

/**
 * Readiness with no polling at all. The server pushes when a subscribed format changes — at most
 * once a second, for as many panes as we care to watch — so ten agents cost what three do, and a
 * quiet pane costs nothing. A capture happens only when the failure trigger actually fires, because
 * confirming a failure needs the path-stripping matcher that only exists in this process.
 *
 * Falls back to `waitReady` when there is no control client (no tmux, or control mode refused).
 */
async function waitReadySubscribed({ client, pane, adapter, timeoutMs, subName, baseline, promptLines }) {
  const started = Date.now();
  return new Promise((settle) => {
    let done = false;
    const finish = (verdict) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      client.off("subscription", onPush);
      client.unsubscribe(subName);
      settle({ ...verdict, elapsed_ms: Date.now() - started });
    };
    // Before giving up, LOOK. The subscription is a push channel: if the server never delivered —
    // because it was overloaded, or the subscription was dropped — nothing here has ever seen the
    // pane, and "ready pattern not seen" is a statement about the agent that this process has no
    // basis for. Measured on a real failure: all three panes plainly held their ready lines, one of
    // them held a usage-limit line that a failure pattern would have caught, and every agent was
    // reported as a timeout. One direct capture at the deadline turns that into the right answer.
    const timer = setTimeout(async () => {
      const raw = await tmux.captureAll(pane).catch(() => null);
      const verdict = raw === null ? null : evaluateScreen(adapter, screenSince(raw, baseline), { alive: (await tmux.paneState(pane)).alive });
      if (verdict) return finish({ ...verdict, reason: `${verdict.reason} (seen only on the final look; the subscription delivered nothing)` });
      finish({
        ready: false,
        failed: false,
        reason: raw === null
          ? `ready pattern not seen within ${timeoutMs}ms, and the final screen capture failed too — tmux may be overloaded, so this is not evidence about the agent`
          : `ready pattern not seen within ${timeoutMs}ms`,
      });
    }, timeoutMs);
    const onPush = async (event) => {
      if (done || event.name !== subName || event.pane !== pane) return;
      const verdict = decideFromSubscription(event.value, { promptLines });
      if (!verdict) return;
      if (verdict.check === "failure") {
        // The server found one of the words; this process decides whether it is actually an error.
        // If the capture itself failed we know nothing — returning here leaves the subscription
        // running, so the next push tries again, rather than silently clearing a real failure.
        const raw = await tmux.captureAll(pane);
        if (raw === null) return;
        const screen = screenSince(raw, baseline);
        const attention = attentionOnScreen(adapter, screen);
        if (attention) return finish({ ready: false, failed: true, attention: true, reason: attention.message });
        const failure = failureOnScreen(adapter, screen);
        if (failure) finish({ ready: false, failed: true, reason: `screen matched failure pattern /${failure}/` });
        return;
      }
      finish(verdict);
    };
    client.on("subscription", onPush);
    client.subscribe(subName, pane, subscriptionFormat(adapter));
  });
}

async function waitReady(pane, adapter, timeoutMs, { baseline = "" } = {}) {
  const started = Date.now();
  // Liveness and exit status in ONE query, then the screen. Asking twice — `paneAlive` to decide,
  // `paneDeath` to get the number — left a window where the second answer no longer described the
  // state the first one judged, and gave a loaded machine a second command to time out. What came
  // out of that window was `{"reason":"pane exited","exit_status":null}`: a death with no way to
  // tell a CLI that rejected its flags from one that was killed.
  // A capture we could not take is NOT a blank screen, and conflating the two is what made this
  // whole function lie under load: `captureAll` returned "" on a failed or timed-out tmux call, an
  // empty screen matches no ready pattern and no failure pattern, and the agent was reported as
  // "ready pattern not seen" — a slow agent, for what was really a query that never landed. Counted
  // rather than merely skipped, so the timeout can say which of the two actually happened.
  let unreadable = 0;
  const look = async () => {
    const state = await tmux.paneState(pane);
    const raw = await tmux.captureAll(pane);
    if (raw === null) {
      unreadable += 1;
      // A pane that is GONE is still a decision, even with no screen to read.
      return state.gone || !state.alive ? { ready: false, failed: true, reason: state.status === null ? "pane exited" : `pane exited with status ${state.status}`, exit_status: state.status ?? undefined } : null;
    }
    let verdict = evaluateScreen(adapter, screenSince(raw, baseline), { alive: state.alive });
    // TM-151. Only when the cheap plain-text test decided nothing: pay for a styled capture and ask
    // whether the composer is empty ghost text. A pane that is genuinely mid-answer, or holds a
    // typed draft, still fails this — so it can only turn "keep waiting" into "ready", never the
    // reverse, and a pane that is already decided costs nothing extra.
    if (verdict === null) {
      const styled = await tmux.capture(pane, 60, { escapes: true }).catch(() => null);
      if (styled) verdict = evaluateScreen(adapter, screenSince(raw, baseline), { alive: state.alive, styled });
    }
    if (!verdict?.failed || verdict.reason !== "pane exited" || state.status === null) return verdict;
    return { ...verdict, reason: `pane exited with status ${state.status}`, exit_status: state.status };
  };

  const timedOut = (looks) => ({
    ready: false,
    failed: false,
    reason: unreadable === 0
      ? `ready pattern not seen within ${timeoutMs}ms`
      : `ready pattern not seen within ${timeoutMs}ms, and ${unreadable} of ${looks} screen captures failed — tmux may be overloaded, so this is not evidence about the agent`,
  });

  if (adapter.ready.pattern) {
    let looks = 0;
    while (Date.now() - started < timeoutMs) {
      looks += 1;
      const verdict = await look();
      if (verdict) return { ...verdict, elapsed_ms: Date.now() - started };
      await sleep(500);
    }
    return timedOut(looks);
  }

  // No pattern for this adapter: wait the declared delay, then decide from what the pane shows.
  await sleep(adapter.ready.delay_ms ?? 3000);
  const verdict = await look();
  return { ...(verdict ?? timedOut(1)), elapsed_ms: Date.now() - started };
}

/**
 * The tmux-side failure trigger: an ERE alternation of the adapter's failure patterns, minus any
 * that tmux cannot parse. It is only a TRIGGER — a hit costs one capture, and the real decision is
 * still `failureOnScreen`, which strips paths first. Doing it the other way round would put the
 * false positive TM-091 removed straight back, because the server has no way to ignore a run path.
 */
export function tmuxFailureTrigger(adapter) {
  // Attention patterns ride the same trigger: on this path nothing is captured until the server sees
  // one of these words, so a pattern left out of the trigger can never fire at all.
  const all = [...(adapter.failure_patterns ?? []), ...(adapter.attention_patterns ?? []).map((entry) => entry.pattern)];
  const usable = all.filter((pattern) => !/[{}:]/.test(pattern));
  return usable.length > 0 ? usable.join("|") : null;
}

/** The subscription format for one pane: ready line, failure line, deadness, real exit status. */
export function subscriptionFormat(adapter) {
  const ready = adapter.ready?.tmux_pattern;
  const failure = tmuxFailureTrigger(adapter);
  return [
    ready ? `#{C/r:${ready}}` : "0",
    failure ? `#{C/r:${failure}}` : "0",
    "#{pane_dead}",
    "#{pane_dead_status}",
  ].join("|");
}

/**
 * Decide from one pushed subscription value. Pure, so the whole event path is testable without a
 * tmux server. `null` means nothing decided — and unlike a poll loop, nothing is spent waiting.
 *
 * `promptLines` is how many lines the shell's own prompt occupies after the pane was cleared. A
 * content match at or below it is that prompt, which is exactly the false positive that used to
 * make a bare zsh look like a ready CLI.
 */
export function decideFromSubscription(value, { promptLines = 1 } = {}) {
  const [readyLine, failLine, dead, deadStatus] = String(value).split("|");
  if (dead === "1") {
    const status = deadStatus === "" || deadStatus === undefined ? null : Number(deadStatus);
    return { ready: false, failed: true, reason: status === null ? "pane exited" : `pane exited with status ${status}`, exit_status: status };
  }
  if (Number(failLine) > 0) return { check: "failure" };
  if (Number(readyLine) > promptLines) return { ready: true, failed: false, reason: "ready pattern (server-side)" };
  return null;
}

/**
 * A tmux session name for one spawn of one agent: the agent's stable id plus a per-spawn
 * discriminator. Uniqueness scope is **live sessions on this host** — the discriminator only has to
 * tell two concurrent spawns apart, and that is the scope tmux itself enforces, so it is checked
 * against tmux rather than assumed from randomness.
 */
export async function uniqueSessionName(agentId, { has = tmux.hasSession, mint = mintSpawn, attempts = 10 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const name = sessionName(agentId, mint());
    if (!(await has(name))) return name;
  }
  fail("TOPOLOGY_SESSION_NAME_EXHAUSTED", `Could not mint a free session name for agent ${agentId} in ${attempts} attempts. Stop some sessions: tmux ls.`);
}

/**
 * The secret that proves an agent is itself. It is a capability, not an identifier: whoever holds it
 * can write that agent's outbox and satisfy its barrier, so it is minted per agent per run, exported
 * into that one agent's launcher environment, and never shared between agents.
 */
export function mintAgentToken(rand = randomBytes) {
  return rand(16).toString("hex");
}

export function tokenDigest(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** Build launcher + argv for every candidate of one agent; write nothing yet. */
function prepareCandidates({ spec, agent, adapters, bootstrapFile, dir, warnings, token, lineage = null, replyToken = null }) {
  // A coordinator is granted nothing. It delegates rather than implements, and it is the only
  // address an outsider may reach directly in cross-repo routing — the most exposed agent in the
  // system should be the least capable one. Its cwd is its own agent directory, so withholding the
  // work-tree grant leaves that directory the only writable path it has: "cannot write the repo" is
  // then a property of what it was launched with, not a sentence in its prompt.
  const coordinator = agent.coordinates_only === true;
  // Any other agent whose cwd is not the repo has its own memory (every shipped CLI keys session
  // state by working directory) but no access to the tree it is meant to work in. The adapter
  // declares how to grant it; if it declares nothing, say so rather than launching a blind agent.
  const addDirs = coordinator
    ? []
    : [...new Set([...(agent.add_dirs ?? []), ...(resolve(agent.cwd) === resolve(spec.consumer) ? [] : [spec.consumer])])].filter(Boolean);
  const system_prompt = `You are agent "${agent.id}" (role: ${agent.role}) in the multi-agent orchestration "${spec.name}". Before doing anything else, read ${bootstrapFile} and follow it exactly.`;
  return agent.candidates.map((candidate, index) => {
    const adapter = adapterFor({ ...agent, cli: candidate.cli, model: candidate.model }, adapters);
    if (adapter.fallback) warnings.push(`agent ${agent.id}: no adapter for cli "${candidate.cli}"; using the generic adapter with command "${adapter.command}"`);
    const vars = { run_id: spec.run_id, run_dir: spec.run_dir, session: spec.session, agent_id: agent.id, agent_role: agent.role, bootstrap_file: bootstrapFile, system_prompt };
    if (addDirs.length > 0 && !grantsDirs(adapter)) {
      warnings.push(`agent ${agent.id}: ${candidateLabel(candidate)} has no add_dir_args, so it cannot be granted ${addDirs.join(", ")} — it will only see ${agent.cwd}. Add add_dir_args to its provider JSON, or give the agent cwd ${spec.consumer}.`);
    }
    if (coordinator && (adapter.coordinator_args ?? []).length === 0) {
      warnings.push(`agent ${agent.id}: ${candidateLabel(candidate)} declares no coordinator_args, so nothing removes its write tools — it is contained only by having no directory granted beyond ${agent.cwd}. Add coordinator_args to its provider JSON.`);
    }
    const argv = buildArgv(adapter, { ...agent, cli: candidate.cli, model: candidate.model, coordinates_only: coordinator, add_dirs: addDirs }, vars);
    // AO_AGENT_TOKEN goes in last, after the spec's own env: a spec is data, often committed data,
    // and it may not name the secret that decides which agent this pane is allowed to answer as.
    // The lineage this agent would pass DOWN if it starts a run of its own. Every agent gets it,
    // not only ones a spec expects to nest: an agent has a shell and `ao-topology` on its PATH, so
    // the run we did not plan for is exactly the one that needs to carry the chain.
    const descend = childEnv({ runDir: spec.run_dir, runId: spec.run_id, agentId: agent.id, depth: lineage?.depth ?? 0, chain: lineage?.chain ?? [], name: spec.name });
    // Only the conductor answers upward, and only when this run IS a participant in another.
    //
    // Distinct names from the AO_PARENT_* set on purpose. Those describe the run this agent would be
    // the PARENT of — what a grandchild inherits — and they point at this run. Replying upward is the
    // opposite direction and points at the run above, so sharing the variables would make one of the
    // two silently wrong. The token is the parent's, minted for the participant slot this run fills,
    // so the child never names itself: it presents a secret the parent already holds a digest of.
    const upward = replyToken && agent.role === "orchestrator" && lineage?.run_dir
      ? { AO_REPLY_TO_RUN_DIR: lineage.run_dir, AO_REPLY_AS_AGENT: lineage.agent_id ?? "", AO_REPLY_TOKEN: replyToken }
      : {};
    const env = { AO_RUN_DIR: spec.run_dir, AO_AGENT_ID: agent.id, AO_AGENT_ROLE: agent.role, AO_SESSION: spec.session, AO_PROVIDER: candidateLabel(candidate), ...descend, ...upward, ...agent.env, AO_CONSUMER: spec.consumer || spec.cwd, AO_AGENT_ID: agent.id, AO_AGENT_TOKEN: token };
    return { index, candidate, label: candidateLabel(candidate), adapter, argv, env, vars, add_dirs: addDirs, memory: memoryLocation(adapter, { cwd: agent.cwd, home: spec.home ?? process.env.HOME ?? "" }), launcher: join(dir, `launch-${index}.sh`) };
  });
}

/**
 * Start one agent in its pane, walking the candidate chain from `startIndex`. Returns
 * { ok, index, label, adapter, ready, attempts:[{label, outcome}] }.
 */
async function startAgentInPane({ pane, agentId, role = null, candidates, startIndex = 0, runDir, log = () => {}, respawn = false, client = null }) {
  const attempts = [];
  for (let index = startIndex; index < candidates.length; index += 1) {
    const item = candidates[index];
    if (!(await commandExists(item.adapter.command))) {
      attempts.push({ label: item.label, outcome: `command "${item.adapter.command}" not found` });
      await appendJournal(runDir, { type: "agent.candidate_skipped", agent: agentId, candidate: item.label, reason: "command not found" });
      continue;
    }
    if (respawn || index > startIndex) await tmux.respawnPane(pane);
    log(`starting ${agentId} on ${item.label} in pane ${pane}`);
    // Prove the shell is accepting input before typing the launcher into it, and leave the pane
    // empty in the same round trip so that anything found in it afterwards is the agent's.
    const shell = await tmux.clearAndWaitForShell(pane, `ao-shell-${randomUUID().slice(0, 8)}`);
    if (!shell.ok) {
      attempts.push({ label: item.label, outcome: "shell did not become ready" });
      await appendJournal(runDir, { type: "agent.candidate_failed", agent: agentId, candidate: item.label, reason: "shell did not become ready" });
      continue;
    }
    const { baseline, promptLines } = shell;
    // `exec`, not a plain call. Run as a child of the interactive shell, an agent that dies leaves
    // the shell alive and the pane healthy — so the pane never dies, the pane-died hook never fires,
    // and a CLI that exited 42 on startup is indistinguishable from one that is merely slow. Exec'd,
    // the pane's process IS the agent: its exit is the pane's exit, `remain-on-exit` keeps the body,
    // and `#{pane_dead_status}` is the agent's own status. Failover respawns the pane either way.
    await tmux.sendText(pane, `exec bash ${shellQuote(item.launcher)}`);
    const timeoutMs = item.adapter.ready.timeout_ms ?? 45_000;
    const readiness = client && item.adapter.ready.tmux_pattern
      ? await waitReadySubscribed({ client, pane, adapter: item.adapter, timeoutMs, subName: `ao-${agentId}`, baseline, promptLines })
      : await waitReady(pane, item.adapter, timeoutMs, { baseline });
    if (readiness.failed) {
      attempts.push({ label: item.label, outcome: readiness.reason });
      await appendJournal(runDir, { type: "agent.candidate_failed", agent: agentId, candidate: item.label, reason: readiness.reason, attention: readiness.attention === true, exit_status: readiness.exit_status ?? null });
      continue;
    }
    const pointer = render(item.adapter.bootstrap_message, item.vars) + (role === "orchestrator" ? BEGIN_CLAUSE : "");
    // Always verified, ready or not. A not-ready pane is where the pointer vanishes outright, but a
    // READY one is where it lands in the composer and is never submitted, and one check covers both.
    // The cost is a settle and a capture per agent, paid in parallel with every other agent's.
    const delivery = await deliverPointer(pane, item.adapter, pointer);
    if (!delivery.delivered) {
      // Not a warning. An agent that never received its brief will never do anything, and calling
      // that "started" is what let a whole run look healthy while doing nothing.
      const reason = `bootstrap never reached the pane after ${delivery.attempts} attempts — the agent came up but was not accepting input`;
      attempts.push({ label: item.label, outcome: reason });
      await appendJournal(runDir, { type: "agent.candidate_failed", agent: agentId, candidate: item.label, reason, attention: false, exit_status: null });
      continue;
    }
    const outcome = readiness.ready
      ? "ready"
      : `started (${readiness.reason}); bootstrap confirmed on the pane`;
    attempts.push({ label: item.label, outcome });
    await appendJournal(runDir, { type: "agent.started", agent: agentId, candidate: item.label, adapter: item.adapter.id, pane, ready: readiness.ready, bootstrap_attempts: delivery.attempts });
    return { ok: true, index, label: item.label, adapter: item.adapter, ready: readiness.ready, attempts };
  }
  await appendJournal(runDir, { type: "agent.exhausted", agent: agentId, attempts });
  return { ok: false, index: -1, label: null, adapter: null, ready: false, attempts };
}

/**
 * Launch one run. Returns { runDir, session, agents:[{id, pane, provider, ready, attempts}], warnings, attach }.
 */
/**
 * Add a child to its parent's index, best effort.
 *
 * Best effort on purpose: the child is already running by the time this is called, so a parent whose
 * directory has been removed underneath it must not turn a live run into a failed launch. The
 * journal entry beside it is the durable record; this file is the convenience `stop` reads.
 */
async function recordChild(lineage, child) {
  try {
    const file = childrenFile(lineage.run_dir);
    const existing = (await readJson(file).catch(() => null)) ?? [];
    const children = Array.isArray(existing) ? existing : [];
    if (!children.some((entry) => entry.run_dir === child.runDir)) {
      children.push({ run_dir: child.runDir, run_id: child.runId, name: child.name, session: child.session, agent_id: lineage.agent_id ?? null, at: nowIso() });
      await writeJson(file, children);
    }
    await appendJournal(lineage.run_dir, { type: "run.spawned", child_run_id: child.runId, child_run_dir: child.runDir, child_name: child.name, child_session: child.session, agent: lineage.agent_id ?? null });
  } catch {
    /* a parent we cannot reach is not a reason to fail a child that is already up */
  }
}

export async function launchRun({ spec, adapters, skillSearchDirs, roleSearchDirs, cliBin, dryRun = false, allowAutoApprove = false, maxDepth = undefined, lineage = lineageFromEnv(), launchChild = null, replyToken = null, log = () => {} }) {
  const warnings = [];

  // Where this run sits in the tree, decided before anything is created. A run launched by an agent
  // inherits its lineage through the environment, so this fires for a child a model started by hand
  // just as it does for one a spec asked for — which is the case that actually runs away.
  const refusal = lineageRefusal({ name: spec.name, lineage, ...(maxDepth === undefined ? {} : { maxDepth }) });
  invariant(!refusal, refusal && refusal.startsWith("workflow") ? "TOPOLOGY_WORKFLOW_CYCLE" : "TOPOLOGY_DEPTH_EXCEEDED", refusal || "");
  // Consent, not just a warning. auto_approve strips the agent's own permission prompts, which
  // docs/topology.md names as this layer's safety boundary; a spec is data, often committed data,
  // so removing that boundary has to be an operator's decision at the moment of launch.
  const autoApproved = spec.agents.filter((agent) => agent.auto_approve);
  if (autoApproved.length > 0) {
    warnings.push(
      `auto_approve is on for ${autoApproved.map((agent) => agent.id).join(", ")} — ${autoApproved.length === 1 ? "that agent" : "those agents"} will run without permission prompts in ${spec.cwd}. Their own prompts are normally the safety boundary.`,
    );
    // The gate fires on --dry-run as well. A dry run is how an operator inspects a spec, so it is
    // exactly where the consent question belongs: finding out about it only after panes exist is
    // finding out too late.
    invariant(
      allowAutoApprove,
      "TOPOLOGY_AUTO_APPROVE_UNCONFIRMED",
      `This spec runs ${autoApproved.length === 1 ? "an agent" : "agents"} without permission prompts (auto_approve): ${autoApproved.map((agent) => `${agent.id} (${agent.role})`).join(", ")}. Their own prompts are the safety boundary this layer relies on, and the spec removes it in ${spec.cwd}. Re-run with --allow-auto-approve if that is genuinely intended.`,
      { agents: autoApproved.map((agent) => agent.id) },
    );
  }
  if (!dryRun && spec.agents.some(agent => !agent.workflow && agent.candidates.some(candidate => adapters.get(candidate.cli)?.requires_repository_readiness === true))) {
    const { leadState } = await import('./lead.mjs');
    const { reviewerAvailability } = await import('./reviewer.mjs');
    const options = { consumer: spec.consumer || spec.cwd, pluginRoot: dirname(dirname(dirname(fileURLToPath(import.meta.url)))) };
    const lead = await leadState(options), reviewer = await reviewerAvailability(options);
    invariant(lead.status === 'responsive' && reviewer.available, 'TOPOLOGY_STARTUP_NOT_READY', 'Governed workflow launch requires a responsive repository lead and independent reviewer. Create or assign the lead first; no workflow panes were created.');
  }
  invariant(!(await exists(join(spec.run_dir, "run.json"))), "TOPOLOGY_RUN_EXISTS", `Run directory already exists: ${spec.run_dir}`);
  if (!dryRun && (await tmux.hasSession(spec.session))) {
    fail("TOPOLOGY_SESSION_EXISTS", `tmux session "${spec.session}" already exists. Stop it first: ao-topology stop --session ${spec.session}`);
  }

  const prepared = [];
  // A participant is a team, not a process: it gets a mailbox so the conductor can address it, and
  // nothing else. No skills, no role pack, no launcher, no pane. Its child run is started after the
  // parent's own session exists, so the child can be told where to reply.
  const participants = spec.agents.filter((agent) => agent.workflow);
  for (const agent of spec.agents) {
    if (agent.workflow) {
      prepared.push({ agent, skills: [], role: { text: "", path: null, fallback: false }, dir: agentDir(spec.run_dir, agent.id), bootstrapFile: null, candidates: [], token: mintAgentToken(), participant: true });
      continue;
    }
    const skills = [];
    for (const name of agent.skills.filter((item) => item && item !== "none")) {
      const resolved = await resolveSkill(name, skillSearchDirs);
      if (!resolved.path) warnings.push(`agent ${agent.id}: skill "${name}" not found in any skill directory`);
      skills.push(resolved);
    }
    const role = await loadRole(agent.role, roleSearchDirs);
    if (role.fallback) warnings.push(`agent ${agent.id}: no role pack for "${agent.role}"; using ${role.path ? "worker" : "an inline placeholder"}`);
    const dir = agentDir(spec.run_dir, agent.id);
    const bootstrapFile = join(dir, "BOOTSTRAP.md");
    // One token per agent, not per candidate: a failover changes the provider, not who the agent is.
    const token = mintAgentToken();
    const candidates = prepareCandidates({ spec, agent, adapters, bootstrapFile, dir, warnings, token, lineage, replyToken });
    prepared.push({ agent, skills, role, dir, bootstrapFile, candidates, token });
  }

  if (dryRun) {
    return {
      dryRun: true,
      runDir: spec.run_dir,
      session: spec.session,
      warnings,
      agents: prepared.map((item) => ({
        id: item.agent.id,
        role: item.agent.role,
        ...runAgentVisual(item.agent),
        cwd: item.agent.cwd,
        candidates: item.candidates.map((candidate) => ({ label: candidate.label, adapter: candidate.adapter.id, command: candidate.argv, add_dirs: candidate.add_dirs, memory: candidate.memory })),
        skills: item.skills,
        role_pack: item.role.path,
      })),
    };
  }

  // Before anything is written into the run dir: these repos deliberately commit `.bytedesk/`, so
  // without this every mailbox file and journal line lands in the consumer's next diff.
  await ensureRunsIgnored(spec.run_dir);
  await mkdir(join(spec.run_dir, spec.artifacts.dir), { recursive: true });
  for (const item of prepared) {
    await mkdir(join(item.dir, "inbox"), { recursive: true });
    await mkdir(join(item.dir, "outbox"), { recursive: true });
    // A participant has a mailbox and no launcher: there is no pane to brief, and the child run's
    // own conductor gets its instructions from the child's spec.
    if (item.participant) continue;
    const loaded = await loadConfig({ consumer: spec.consumer || spec.cwd, pluginRoot: dirname(dirname(dirname(fileURLToPath(import.meta.url)))) });
    const promptAgent = { ...Object.fromEntries(['id','role','full_name','title','template','coordinates_only','instructions_file','_agent_dir','_prompt_vars'].map(key=>[key,item.agent[key]])), instructions: item.agent._inline_instructions ?? item.agent.instructions ?? "", _dir:item.dir };
    await writeJson(join(item.dir,'prompt-agent.json'),promptAgent);
    const composed = await composePrompt({ agent: promptAgent, consumer: spec.consumer || spec.cwd, dir: item.dir, loaded, templateName: item.agent.template });
    invariant(composed.ok, "TOPOLOGY_PROMPT_INVALID", "Workflow prompt configuration is invalid.", { errors: composed.errors });
    await writeText(item.bootstrapFile, composed.text + "\n" + bootstrapText({ spec, agent: {...item.agent, instructions:""}, role: item.role, skills: item.skills, cliBin }));
    await writeJson(join(item.dir, "prompt-state.json"), { desired_revision: composed.revision, sources: composed.sources, status: "awaiting-ack", nonce: randomUUID(), replacement: "cold-start" });
    for (const candidate of item.candidates) {
      await writeText(candidate.launcher, launcherScript({ agent: item.agent, candidate: candidate.candidate, argv: candidate.argv, env: candidate.env }), 0o700);
    }
  }

  const run = {
    version: 1,
    name: spec.name,
    run_id: spec.run_id,
    session: spec.session,
    consumer: spec.consumer,
    run_dir: spec.run_dir,
    layout: spec.layout,
    inputs: spec.inputs_resolved ?? {},
    // Null at the root, and stored rather than inferred: "no parent" and "a parent we failed to
    // write" look identical from the outside otherwise, and the difference matters when you are
    // holding an orphan and asking where it came from.
    parent: lineage,
    depth: lineage?.depth ?? 0,
    // `stages` is the field; `workflow` stays alongside it so a run.json written by this version
    // is still readable by a consumer pinned to the previous one.
    stages: spec.stages,
    workflow: spec.stages,
    gates: spec.gates,
    artifacts_dir: join(spec.run_dir, spec.artifacts.dir),
    created: nowIso(),
    state: "launching",
    sequence: 0,
    agents: prepared.map((item) => ({
      id: item.agent.id,
      agent_id: item.agent._agent || item.agent.id,
      role: item.agent.role,
      ...runAgentVisual(item.agent),
      cwd: item.agent.cwd,
      pane: null,
      bootstrap: item.bootstrapFile,
      // The digest, never the secret. A record that is enough to check a reply with, and never
      // enough to forge one with: the run dir is readable by every agent in the run. Anything that
      // needs the token itself reads it from that agent's own launcher, where only that pane sees it.
      token_sha256: tokenDigest(item.token),
      candidates: item.candidates.map((candidate) => ({ label: candidate.label, cli: candidate.candidate.cli, model: candidate.candidate.model ?? null, adapter: candidate.adapter.id, launcher: candidate.launcher, submit_keys: candidate.adapter.submit_keys, add_dirs: candidate.add_dirs, memory: candidate.memory })),
      active: null,
      provider: null,
      adapter: null,
      submit_keys: ["Enter"],
      // A participant carries the name of the workflow it stands for. The run_dir and session are
      // filled in once the child is actually launched, below — before that they are honestly null
      // rather than optimistically guessed, so a failed child is visible as one.
      ...(item.participant ? { workflow: { name: item.agent.workflow, inputs: item.agent.inputs ?? {}, run_dir: null, session: null, conductor: null } } : {}),
      // Which fan-out this child came from, so `--to <collective id>` can find its members and a
      // barrier over the group can too. Absent on a participant that was written out by hand.
      ...(item.agent.fanout_of ? { fanout_of: item.agent.fanout_of, fanout_item: item.agent.fanout_item ?? null } : {}),
    })),
  };
  await saveRun(spec.run_dir, run);
  await appendJournal(spec.run_dir, { type: "run.created", name: spec.name, run_id: spec.run_id, session: spec.session, agents: run.agents.map((agent) => agent.id) });

  // Tell the parent it has a child. Recorded in two places for two different readers: the journal is
  // the append-only history a human reads, `children.json` is the index `stop` walks so it does not
  // have to scan every run in the repo looking for orphans to adopt.
  if (lineage?.run_dir) await recordChild(lineage, { runDir: spec.run_dir, runId: spec.run_id, name: spec.name, session: spec.session });

  // Conductor first so it owns pane 0 / the main pane. Participants are not in this list at all —
  // they have no process to host, and including one would consume a pane that stays empty.
  const ordered = [...prepared].filter((item) => !item.participant).sort((a, b) => (a.agent.role === "orchestrator" ? -1 : b.agent.role === "orchestrator" ? 1 : 0));
  const first = ordered[0];
  // Sized for the whole team before the first split, because a window that is resized after the
  // panes exist redistributes rows by ratio and leaves the small ones small.
  const geometry = tmux.windowSizeFor(ordered.length);
  const firstPane = await tmux.newSession(spec.session, { cwd: first.agent.cwd, windowName: spec.layout === "windows" ? first.agent.id : "main", ...geometry });
  const panes = new Map([[first.agent.id, firstPane]]);
  const rest = ordered.slice(1);
  if (spec.layout === "windows") {
    for (const item of rest) panes.set(item.agent.id, await tmux.newWindow(spec.session, item.agent.id, item.agent.cwd));
  } else if (rest.length > 0) {
    const ids = await tmux.splitPanes(`${spec.session}:main`, rest.map((item) => item.agent.cwd));
    rest.forEach((item, index) => panes.set(item.agent.id, ids[index]));
    // The requested layout once, over the tiling the splits left behind.
    await tmux.selectLayout(`${spec.session}:main`, spec.layout === "grid" ? "tiled" : "main-vertical");
  }
  // Per-pane setup, all panes at once. remain-on-exit must be set before anything can die or the
  // pane vanishes and its exit status with it, and pipe-pane must be attached before the shell is
  // touched — it only ever sees what is written after it attaches, so attaching it later loses
  // precisely the part that says why an agent never came up.
  await Promise.all(
    ordered.map((item) =>
      tmux.preparePane(panes.get(item.agent.id), {
        title: `${item.agent.id} · ${item.agent.role}`,
        log: `cat >> ${shellQuote(join(item.dir, "pane.log"))}`,
        display: { agent: displayName(item.agent), role: item.agent.role, ...runAgentVisual(item.agent) },
      }),
    ),
  );
  // One hook for the whole session: a death pushes a record instead of a poll discovering it later.
  // `#{pane_dead_status}` is the process's real exit code, readable only because remain-on-exit was
  // set above. `show-hooks` will not list this hook even though it fires — do not go looking there.
  // TSV, not JSON: the hook body is parsed by tmux, then by run-shell, then by the shell, and every
  // layer of quoting is a chance to write a command that registers cleanly and silently does
  // nothing. Two fields and one printf survive all three.
  const deathLog = join(spec.run_dir, "deaths.tsv");
  const hooked = await tmux.setHook(
    spec.session,
    "pane-died",
    `run-shell -b "printf '%s\\t%s\\n' '#{hook_pane}' '#{pane_dead_status}' >> ${shellQuote(deathLog)}"`,
  );
  if (!hooked) warnings.push("tmux refused the pane-died hook; agent deaths will not be recorded in deaths.tsv.");
  // `?? null`, not the bare lookup: a participant has no pane and `undefined` is dropped by
  // JSON.stringify, which would leave run.json with no `pane` key at all for that agent. Every
  // reader then has to distinguish "absent" from "null", and one of them will forget.
  const observedBindings = await tmux.listServerPanes();
  for (const agent of run.agents) {
    agent.pane = panes.get(agent.id) ?? null;
    agent.binding = observedBindings.find(p => p.paneId === agent.pane && p.sessionName === run.session) || null;
    agent.session_kind = "run";
  }
  await saveRun(spec.run_dir, run);

  // One control-mode client for the session: the readiness signal for every pane, pushed by the
  // server. If control mode is unavailable the starts fall back to the capture loop.
  const client = new tmux.ControlClient(spec.session);
  const subscribed = await client.start().catch(() => false);
  if (!subscribed) {
    client.close();
    warnings.push("tmux control mode did not attach; readiness fell back to polling each pane.");
  }

  // Agents start together. They occupy separate panes and share nothing but the tmux server, so
  // serial starts only ever bought worst-case `agents x timeout_ms` — a chain of five slow CLIs used
  // to take five timeouts to report what it now reports in one.
  const started = await Promise.all(
    ordered.map((item) =>
      startAgentInPane({
        pane: panes.get(item.agent.id),
        agentId: item.agent.id,
        role: item.agent.role,
        candidates: item.candidates,
        runDir: spec.run_dir,
        log,
        client: subscribed ? client : null,
      }).then((outcome) => ({ item, outcome })),
    ),
  );
  client.close();

  const finalBindings = await tmux.listServerPanes();
  const results = [];
  for (const { item, outcome } of started) {
    const pane = panes.get(item.agent.id);
    const entry = run.agents.find((agent) => agent.id === item.agent.id);
    entry.binding = finalBindings.find(p => p.paneId === pane && p.sessionName === run.session) || null;
    if (outcome.ok) {
      entry.active = outcome.index;
      entry.provider = outcome.label;
      entry.adapter = outcome.adapter.id;
      entry.submit_keys = outcome.adapter.submit_keys;
      if (!outcome.ready) warnings.push(`agent ${item.agent.id}: ${outcome.label} did not look ready (${outcome.attempts.at(-1).outcome}); bootstrap pointer was sent anyway`);
      if (outcome.index > 0) warnings.push(`agent ${item.agent.id}: fell back to ${outcome.label} after ${outcome.attempts.slice(0, -1).map((attempt) => `${attempt.label} (${attempt.outcome})`).join(", ")}`);
    } else {
      warnings.push(`agent ${item.agent.id}: every provider in its chain failed — ${outcome.attempts.map((attempt) => `${attempt.label}: ${attempt.outcome}`).join("; ")}`);
    }
    results.push({ id: item.agent.id, role: item.agent.role, ...runAgentVisual(item.agent), pane, provider: outcome.label, adapter: outcome.adapter?.id ?? null, ready: outcome.ready, attempts: outcome.attempts });
  }
  await saveRun(spec.run_dir, run);
  if (spec.layout !== "windows") await tmux.selectPane(panes.get(first.agent.id));

  // Children last, and only once this run's own session exists. A child needs to be told where to
  // reply, and "where" is this run — so there is nothing to tell it until this run is real. Launched
  // through the caller's own launcher so the child resolves adapters, roles and skills exactly as a
  // hand-typed `launch` would; this function does not know how to build that context and should not
  // learn.
  for (const item of prepared.filter((entry) => entry.participant)) {
    const entry = run.agents.find((agent) => agent.id === item.agent.id);
    if (!launchChild) {
      warnings.push(`agent ${item.agent.id}: workflow "${item.agent.workflow}" was not launched — this caller cannot start child runs.`);
      continue;
    }
    try {
      const child = await launchChild({
        workflow: item.agent.workflow,
        inputs: item.agent.inputs ?? {},
        // The parent's own lineage, extended by one: the child reads this and records it, exactly as
        // a child started by a model from an agent's environment would.
        lineage: { run_dir: spec.run_dir, run_id: spec.run_id, agent_id: item.agent.id, depth: (lineage?.depth ?? 0) + 1, chain: [...(lineage?.chain ?? []), spec.name] },
        // The parent's token for THIS participant. The child's conductor answers as `reviewers` in
        // the parent's mailbox, and this is the secret that lets it — minted by the parent, so the
        // child never has to be trusted to name itself.
        replyToken: item.token,
      });
      entry.workflow = { ...entry.workflow, run_dir: child.runDir, session: child.session, conductor: child.conductor ?? null, state: child.state };
      for (const warning of child.warnings ?? []) warnings.push(`workflow ${item.agent.id}: ${warning}`);
    } catch (error) {
      // A child that will not start is a degraded run, not a dead one: the panes that did come up
      // are still useful and the conductor can be told what is missing.
      entry.workflow = { ...entry.workflow, error: error?.message ?? String(error) };
      warnings.push(`agent ${item.agent.id}: workflow "${item.agent.workflow}" failed to launch — ${error?.message ?? error}`);
    }
  }

  run.state = results.every((result) => result.provider) && run.agents.every((agent) => !agent.workflow || agent.workflow.run_dir) ? "running" : "degraded";
  await saveRun(spec.run_dir, run);
  await appendJournal(spec.run_dir, { type: "run.launched", state: run.state, warnings });
  return { runDir: spec.run_dir, session: spec.session, state: run.state, agents: results, participants: run.agents.filter((agent) => agent.workflow).map((agent) => ({ id: agent.id, ...runAgentVisual(agent), ...agent.workflow })), warnings, attach: tmux.attachCommand(spec.session) };
}

// ---------------------------------------------------------------------------------------------
// Durable role-sessions.
//
// Everything above is run-oriented: spawn a set of agents, work, tear the session down. A role
// bound to a project is the opposite — a named workspace you CALL rather than launch, that outlives
// any one run and keeps its identity across a restart of whatever started it. A lead that loses its
// identity on restart is not a lead.
//
// Three rules, and the third is the one that is easy to get silently wrong.
//
//  1. The name is derived from the agent's stable id, never from a run id. `<prefix>-<agent id>`.
//     `.` and `:` are refused: measured on tmux 3.4, `new-session -s "a.b"` silently creates `a_b`
//     and `has-session -t "a.b"` then fails, so a dotted name would make the reattach probe miss and
//     quietly create a second session every time.
//  2. Reattach beats create. The session outliving this process IS the durable state, so the first
//     thing `openRoleSession` does is ask tmux whether it already exists.
//  3. The record must be enough to rebuild the session. The gateway restores a tab by reattaching
//     when the tmux session is still alive, but when it is gone it recreates from the tab RECORD's
//     stored Command — the command the gateway assembled at create time, not whatever actually ran.
//     So a role-session must be reconstructible from one stable command string, and that string is
//     what we store and what we launch through. `bash <agent dir>/session.sh` is that string: it
//     lives in the agent's own durable directory rather than a run directory, so it still exists
//     after the run that created it is gone, and running it twice reconstructs the same workspace.
//     Anything that launches a role-session by a different command breaks gateway restore silently.

const ROLE_SESSION_NAME = /^[A-Za-z0-9_-]{1,96}$/;

/**
 * The durable session name for one agent. Stable across runs and across restarts — the discriminator
 * that `identity.mjs` mints is for one SPAWN of an agent, which is a different question from where
 * that agent permanently lives.
 */
export function roleSessionName(agentId, { prefix = "ao" } = {}) {
  // An empty id would give every agent the same session name, which is the one failure this
  // function exists to prevent — and `ao-` passes the charset check on its own.
  invariant(
    typeof agentId === "string" && /^[A-Za-z0-9_-]+$/.test(agentId),
    "TOPOLOGY_SESSION_NAME_INVALID",
    `A role-session needs an agent id to be named after; got ${JSON.stringify(agentId)}.`,
  );
  const name = `${prefix}-${agentId}`;
  invariant(
    ROLE_SESSION_NAME.test(name),
    "TOPOLOGY_SESSION_NAME_INVALID",
    `"${name}" cannot be a tmux session name. Letters, digits, "-" and "_" only, at most 96 characters; "." and ":" are refused because tmux rewrites or mis-parses them and the session then cannot be found again.`,
  );
  return name;
}

/** Where an agent's durable session record lives: beside the agent, not inside any run. */
export function roleSessionPath(agentsDir, agentId) {
  return join(agentsDir, String(agentId), "session.json");
}

/**
 * Open the durable session for one agent: reattach if it is already running, otherwise create it.
 * Returns { session, pane, created, reattached, record }.
 *
 * `agentsDir` is the repo's agent library root; the agent's own directory under it is both the
 * session's cwd (which is what gives the agent its own memory) and where its record and launcher
 * live, so nothing about the session depends on a run directory that will be torn down.
 */
export function roleSessionNeedsGovernance({ role, coordinatesOnly = false }) {
  return !coordinatesOnly && !['lead', 'reviewer'].includes(role);
}

export async function openRoleSession({ agentsDir, agentId, adapter, argv, env = {}, prefix = "ao", role = "worker", coordinatesOnly = false, controlledRestart = false, log = () => {} }) {
  const session = roleSessionName(agentId, { prefix });
  const dir = join(agentsDir, String(agentId));
  const recordPath = roleSessionPath(agentsDir, agentId);
  // TM-168 title bar. Read-only: the stored definition supplies the readable name, and agent.json is
  // never written back. An agent with no definition on disk is shown by its id.
  const stored = await readJson(join(dir, "agent.json")).catch(() => null);
  const display = { agent: stored ? displayName(stored) : agentId, role, ...roleVisual({ role }) };

  if (env.AO_CONSUMER && roleSessionNeedsGovernance({ role, coordinatesOnly })) {
    const { leadState } = await import('./lead.mjs');
    const { reviewerAvailability } = await import('./reviewer.mjs');
    const options = { consumer: env.AO_CONSUMER, pluginRoot: dirname(dirname(dirname(fileURLToPath(import.meta.url)))), env: { ...process.env, ...env } };
    const lead = await leadState(options), reviewer = await reviewerAvailability(options);
    invariant(lead.status === 'responsive' && reviewer.available, 'TOPOLOGY_STARTUP_NOT_READY', 'A responsive repository lead and independent reviewer are required before starting governed work. Use lead ensure or lead assign; the existing session is preserved.');
  }

  if (await tmux.hasSession(session)) {
    // The live session IS the state. Reattaching is the whole point: creating a second one would
    // give the agent two identities and lose whatever the first was in the middle of.
    const record = (await exists(recordPath)) ? await readJson(recordPath) : null;
    const panes = await tmux.listPanes(session);
    invariant(record?.agent_id === agentId, 'TOPOLOGY_SESSION_OWNERSHIP', 'A same-named session has no matching owned record; refusing adoption or restart.');
    const currentBinding=(await tmux.listServerPanes()).find(p=>p.paneId===record.binding?.paneId);
    invariant(record.binding && currentBinding && sameIncarnation(currentBinding, record.binding), 'TOPOLOGY_SESSION_OWNERSHIP', 'Recorded session incarnation is absent or replaced; refusing reattachment.');
    if (!panes.some(p => p.alive) || controlledRestart) {
      invariant(record.binding, 'TOPOLOGY_SESSION_OWNERSHIP', 'Dead session has no recorded incarnation; preserve it for recovery.');
      const observed = (await tmux.listServerPanes()).find(p => p.paneId === record.binding.paneId);
      invariant(observed && sameIncarnation(observed, record.binding), 'TOPOLOGY_SESSION_OWNERSHIP', 'Session incarnation changed; refusing restart.');
      await tmux.respawnPane(observed.paneId);
      record.binding=(await tmux.listServerPanes()).find(p=>p.paneId===observed.paneId);
      await writeJson(recordPath,record);
      const shell = await tmux.clearAndWaitForShell(observed.paneId, `ao-role-${randomUUID().slice(0,8)}`);
      invariant(shell.ok, 'TOPOLOGY_SESSION_START', 'Restarted shell did not become ready.');
      await writeText(record.launcher, launcherScript({ agent: { id:agentId, role, cwd:dir }, candidate:{cli:adapter.id}, argv, env }), 0o700);
      await tmux.sendText(observed.paneId, `exec bash ${shellQuote(record.launcher)}`);
      if (env.AO_CONSUMER) {
        const readiness = await waitReady(observed.paneId, adapter, adapter.ready?.timeout_ms || 30000, { baseline: shell.baseline });
        invariant(readiness.ready, 'TOPOLOGY_SESSION_START', 'Provider is not accepting its startup instructions.');
        const startedBinding = (await tmux.listServerPanes()).find(p => p.paneId === observed.paneId);
        invariant(startedBinding && sameIncarnation(startedBinding, record.binding), 'TOPOLOGY_SESSION_OWNERSHIP', 'Restarted process incarnation changed before prompt delivery.');
        await promotePromptForIncarnation({ agent: { id: agentId, _dir: dir }, binding: startedBinding, consumer: env.AO_CONSUMER, session });
        await deliverPointer(observed.paneId, adapter, `Read ${join(dir,'prompt.md')} and begin your standing role. Poll your protocol inbox at safe boundaries.`);
      }
      record.binding = (await tmux.listServerPanes()).find(p => p.paneId === observed.paneId);
      await writeJson(recordPath, record);
      await tmux.setRoleDisplay(observed.paneId, display, { session });
      return {session,pane:observed.paneId,binding:record.binding,created:false,reattached:false,restarted:true,record};
    }
    log(`reattaching to ${session}`);
    // Ownership is proven above, so a session opened before TM-168 gets its title bar here too.
    if (panes[0]?.id) await tmux.setRoleDisplay(panes[0].id, display, { session });
    return { session, pane: panes[0]?.id ?? null, binding: record.binding, created: false, reattached: true, record };
  }

  const launcher = join(dir, "session.sh");
  // The one command the session is ever started by — ours to run, and the gateway's to restore from.
  const command = `bash ${shellQuote(launcher)}`;
  await mkdir(dir, { recursive: true });
  await writeText(launcher, launcherScript({ agent: { id: agentId, role, cwd: dir }, candidate: { cli: adapter.id }, argv, env }), 0o700);

  const record = {
    version: 1,
    session,
    agent_id: agentId,
    role,
    cwd: dir,
    provider: adapter.id,
    launcher,
    command,
    // Stated in the record because a restore path in another process reads this file, not this code.
    restore_contract: "Recreate this session by running `command` with cwd `cwd`. It is idempotent and is the only supported entry point; starting the session any other way makes a gateway tab restore rebuild it wrong.",
    created_at: nowIso(),
  };
  await writeJson(recordPath, record);

  const pane = await tmux.newSession(session, { cwd: dir, windowName: agentId });
  record.binding=(await tmux.listServerPanes()).find(p=>p.paneId===pane && p.sessionName===session);
  await writeJson(recordPath,record);
  await tmux.setPaneOption(pane, "remain-on-exit", "on");
  // The session title options came with newSession; the pane supplies what they render.
  await tmux.setRoleDisplay(pane, display);
  await tmux.pipePane(pane, `cat >> ${shellQuote(join(dir, "pane.log"))}`);
  const shell = await tmux.clearAndWaitForShell(pane, `ao-role-${randomUUID().slice(0, 8)}`);
  invariant(shell.ok, 'TOPOLOGY_SESSION_START', 'Session shell did not become ready.');
  await tmux.sendText(pane, `exec bash ${shellQuote(launcher)}`);
  if (env.AO_CONSUMER) {
    const readiness = await waitReady(pane, adapter, adapter.ready?.timeout_ms || 30000, { baseline: shell.baseline });
    invariant(readiness.ready, 'TOPOLOGY_SESSION_START', 'Provider is not accepting startup instructions; session preserved.');
    const startedBinding = (await tmux.listServerPanes()).find(p => p.paneId === pane && p.sessionName === session) || null;
    invariant(startedBinding && sameIncarnation(startedBinding, record.binding), 'TOPOLOGY_SESSION_OWNERSHIP', 'Started process incarnation changed before prompt delivery.');
    await promotePromptForIncarnation({ agent: { id: agentId, _dir: dir }, binding: startedBinding, consumer: env.AO_CONSUMER, session });
    const delivery = await deliverPointer(pane, adapter, `Read ${join(dir,'prompt.md')} and begin your standing role. Poll your protocol inbox at safe boundaries.`);
    invariant(delivery.delivered, 'TOPOLOGY_SESSION_START', 'Standing bootstrap was not delivered.');
  }
  const binding = (await tmux.listServerPanes()).find(p => p.paneId === pane && p.sessionName === session) || null;
  record.binding = binding;
  await writeJson(recordPath, record);
  if (env.AO_CONSUMER) {
    const { afterSessionOpen } = await import('./startup.mjs');
    await afterSessionOpen({ consumer: env.AO_CONSUMER, agentId, session, pane, incarnation: binding, env: { ...process.env, ...env } });
  }
  log(`created ${session}`);
  return { session, pane, binding, created: true, reattached: false, record };
}

/**
 * What the pane-died hook recorded: one { pane, status } per death, in order. The status is the
 * process's real exit code, which is only readable because remain-on-exit was set on the pane
 * before it died — without it tmux destroys the pane and the code goes with it.
 */
export async function readDeaths(runDir) {
  const text = await readFile(join(runDir, "deaths.tsv"), "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [pane, status] = line.split("\t");
      return { pane, status: status === "" || status === undefined ? null : Number(status) };
    });
}

/**
 * Restart one agent on the next candidate in its chain (or a specific one via `toLabel`),
 * re-send its bootstrap, and re-ring every message it has not answered yet.
 *
 * THREE THINGS SURVIVE THIS AND THEY NEED THREE SEPARATE ANSWERS. See `docs/quota-failover.md`.
 *
 *   the WORK        survives: same pane, same worktree, same branch. `startAgentInPane` respawns
 *                   in place and re-sends the bootstrap, which is what tells the new provider to
 *                   orient itself — `git status`, `git log`, read its prompt file — because it has
 *                   no idea what the last one had been doing.
 *   the CONVERSATION does NOT: a different CLI has a different memory. That is precisely WHY
 *                   `pendingReplies` is re-delivered below rather than assumed answered, and it is
 *                   the fact a team most often misreads — a cold agent looks broken and is not.
 *   the CLAIM       survives outside this layer entirely, on tm's dispatch heartbeat, which keys
 *                   off the worker registry rather than the pane. Named ceiling: `claimTtlMinutes`
 *                   defaults to 240 minutes against a five-hour quota window, so a repository that
 *                   relies on quota failover raises it. The topology layer deliberately cannot
 *                   import task-management, so that is a config line, not a cross-plugin heartbeat.
 *
 * `incidentId` / `approvedBy` (TM-135) are the quota-failover path. Supplying an incident asserts
 * it is OPEN and names this agent and this provider, and spends `failover.consent`: `ask` requires
 * a human named in `approvedBy`, `auto` is the operator's advance consent and announces, `never`
 * refuses. Supplying none leaves the manual path exactly as it was — an operator at a keyboard is
 * already the human turn the gate exists to require.
 */
export async function failoverAgent({ runDir, agentId, adapters, toLabel, incidentId = null, approvedBy = null, env = process.env, home = homedir(), pluginRoot = null, log = () => {} }) {
  const run = await loadRun(runDir);
  const entry = run.agents.find((agent) => agent.id === agentId);
  invariant(entry, "TOPOLOGY_UNKNOWN_AGENT", `Unknown agent "${agentId}". Agents: ${run.agents.map((agent) => agent.id).join(", ")}.`);
  // Failover is a PROVIDER concept: restart this process on the next model in its chain. A team has
  // no provider and no chain, so the question does not apply — and answering it from the empty chain
  // produced "no provider left after none. Chain: .", which reads like a fault rather than a
  // category error. Fail over an agent inside the child run instead.
  invariant(
    !entry.workflow,
    "TOPOLOGY_AGENT_IS_A_WORKFLOW",
    `${agentId} is a workflow participant running "${entry.workflow?.name}", not a process on a provider — there is no chain to fail over. Fail over an agent inside its own run: \`failover --run ${entry.workflow?.run_dir ?? "<child run dir>"} --agent <id>\`.`,
  );
  invariant(await tmux.hasSession(run.session), "TOPOLOGY_SESSION_GONE", `tmux session ${run.session} is not running.`);
  // TM-135. Before anything is respawned: is there an observation that justifies this, and has
  // somebody consented to it? Both refusals are invariants, so a run whose incident has been
  // resolved or whose config says `never` is left exactly as it was.
  let quota = null;
  if (incidentId) {
    const { authorizeFailover } = await import("./quota.mjs");
    quota = await authorizeFailover({ consumer: run.consumer || runDir, agentId, provider: entry.adapter ?? null, incidentId, approvedBy, env, home, pluginRoot });
    log(`failover authorised by ${quota.approval.approved_by} against incident ${quota.incident.incident_id}`);
  }
  let startIndex = (entry.active ?? -1) + 1;
  if (toLabel) {
    startIndex = entry.candidates.findIndex((candidate) => candidate.label === toLabel || candidate.cli === toLabel);
    invariant(startIndex >= 0, "TOPOLOGY_CANDIDATE_UNKNOWN", `"${toLabel}" is not in ${agentId}'s chain: ${entry.candidates.map((candidate) => candidate.label).join(", ")}.`);
  }
  invariant(startIndex < entry.candidates.length, "TOPOLOGY_CHAIN_EXHAUSTED", `${agentId} has no provider left after ${entry.provider ?? "none"}. Chain: ${entry.candidates.map((candidate) => candidate.label).join(" → ")}. Add candidates to the template or restart with --to <cli:model>.`);
  if (entry.binding) {
    const observed = (await tmux.listServerPanes()).find(p => p.paneId === entry.pane);
    invariant(observed && ['serverKey','serverPid','sessionId','sessionCreated','paneId','panePid'].every(k => observed[k] === entry.binding[k]), 'TOPOLOGY_SESSION_OWNERSHIP', 'Run pane incarnation changed; refusing failover.');
  }
  const previous = entry.provider;
  const candidates = entry.candidates.map((candidate, index) => {
    const adapter = adapterFor({ cli: candidate.cli, model: candidate.model, args: [], skills: [] }, adapters);
    return { index, label: candidate.label, adapter, launcher: candidate.launcher, vars: { run_id: run.run_id, run_dir: runDir, session: run.session, agent_id: agentId, agent_role: entry.role, bootstrap_file: entry.bootstrap } };
  });
  await appendJournal(runDir, { type: "agent.failover", agent: agentId, from: previous, to_index: startIndex,
    ...(quota ? { incident: quota.incident.incident_id, approved_by: quota.approval.approved_by, consent: quota.consent } : {}) });
  const started = await startAgentInPane({ pane: entry.pane, agentId, role: entry.role, candidates, startIndex, runDir, log, respawn: true });
  entry.binding = (await tmux.listServerPanes()).find(p => p.paneId === entry.pane && p.sessionName === run.session) || null;
  // TM-132: the respawn keeps the pane but takes a new panePid, so this agent's OLD six-tuple is
  // now provably absent — and a slot reconcile would read that as "the holder is gone" and hand its
  // cutover slot to the next in the queue. Re-stamp before anything can observe the gap. Best
  // effort: a failover must not fail because a slot record could not be rewritten.
  if (entry.binding) {
    const { restampSlotBindings } = await import("./slots.mjs");
    await restampSlotBindings({ consumer: run.consumer || runDir, agentId, binding: entry.binding }).catch(() => {});
  }
  if (!started.ok) {
    entry.active = entry.candidates.length;
    entry.provider = null;
    run.state = "degraded";
    await saveRun(runDir, run);
    return { ok: false, agent: agentId, from: previous, attempts: started.attempts };
  }
  entry.active = started.index;
  entry.provider = started.label;
  entry.adapter = started.adapter.id;
  entry.submit_keys = started.adapter.submit_keys;
  await saveRun(runDir, run);
  // The restarted provider reads its durable inbox at a safe boundary. Bootstrap readiness
  // does not prove that a later composer is empty or that a tool is not accepting input.
  const pending = await pendingReplies(runDir, [agentId]);
  // The announcement, and the incident closed against the takeover it authorised. Both are best
  // effort by contract: the pane has already changed hands, and reporting a completed failover as
  // failed because a mailbox or a state file could not be written would be a worse lie than a
  // missing message. `auto` is legitimate precisely BECAUSE this fires — the operator's rule
  // forbids silent substitution, not substitution.
  let announced = null;
  if (quota) {
    const { announceFailoverApplied, resolveIncident } = await import("./quota.mjs");
    announced = await announceFailoverApplied({ consumer: run.consumer || runDir, incident: quota.incident, approval: quota.approval, from: previous, to: started.label, env, home }).catch(() => null);
    await resolveIncident({ consumer: run.consumer || runDir, agentId, state: "applied", by: quota.approval.approved_by, note: `${previous ?? "none"} -> ${started.label}`, env, home }).catch(() => {});
  }
  await appendJournal(runDir, { type: "agent.failover_complete", agent: agentId, from: previous, to: started.label, redelivered: [], pending: pending.map((item) => item.id),
    ...(quota ? { incident: quota.incident.incident_id, approved_by: quota.approval.approved_by, announced: announced?.status ?? null } : {}) });
  return { ok: true, agent: agentId, from: previous, to: started.label, ready: started.ready, redelivered: [], pending: pending.map((item) => item.id), attempts: started.attempts,
    ...(quota ? { incident: quota.incident.incident_id, approved_by: quota.approval.approved_by, announced: announced?.status ?? null } : {}) };
}
