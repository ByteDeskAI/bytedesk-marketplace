import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// TM-355: run mail, reply and session handoff are ONE implementation, the `ao-topology` verb.
// Re-implementing their ringing and routing here would be a second caller to keep in step, so the
// MCP tool runs the verb. `../topology/cli.mjs` resolves from src/ and from the dist/ bundle alike.
const TOPOLOGY_CLI = fileURLToPath(new URL('../topology/cli.mjs', import.meta.url));
export function runTopologyCli(args, { env, cwd, input = '' }) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [TOPOLOGY_CLI, ...args, '--json'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', async code => {
      const { fail } = await import('../topology/lib/util.mjs');
      let value;
      try { value = JSON.parse(stdout); } catch {
        return reject(Object.assign(new Error(`ao-topology ${args[0]} exited ${code}: ${(stderr || stdout).trim().slice(-2000)}`), { code: 'TOPOLOGY_CLI_FAILED' }));
      }
      if (value?.ok === false && value.code) {
        try { fail(value.code, value.message, value.details); } catch (error) { return reject(error); }
      }
      done({ exitCode: code, value });
    });
    child.stdin.end(input);
  });
}

// MCP adapters share the topology domain services. Consumer admission stays at the
// public boundary; neither the plugin cwd nor an earlier request supplies identity.
/**
 * TM-466: the MCP server never sees CLAUDE_ENV_FILE exports, so a non-launcher session's minted
 * identity (AO_SESSION_AGENT_ID/AO_SESSION_CONSUMER) is absent from its env. It does see
 * CLAUDE_CODE_SESSION_ID, so read the record SessionStart wrote for that session and supply the same
 * two variables. Re-read per call: SessionStart may finish after the server starts. A launcher
 * identity, or variables already present, win unchanged, so `callerIdentity` decides as before.
 */
export async function withMintedSessionIdentity(env) {
  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  if (env.AO_AGENT_ID || env.AO_SESSION_AGENT_ID || !sessionId) return env;
  const { sessionAgentId, sessionIdentitiesDir } = await import('../topology/lib/session-identity.mjs');
  const { readJson } = await import('../topology/lib/util.mjs');
  const agentId = sessionAgentId(sessionId);
  const record = await readJson(join(sessionIdentitiesDir(env), `${agentId}.json`)).catch(() => null);
  if (record?.agent_id !== agentId || record.session_id !== String(sessionId) || !record.consumer) return env;
  return { ...env, AO_SESSION_AGENT_ID: agentId, AO_SESSION_CONSUMER: record.consumer };
}

// TM-464: every value goes to the CLI as one `--key=value` token, so a value that starts with `--`
// (a subject of `--from-project=/x`) stays a value and can never become a flag.
const flag = (key, value) => `--${key}=${value}`;

// MCP adapters share the topology domain services. Consumer admission stays at the
// public boundary; neither the plugin cwd nor an earlier request supplies identity.
export function createTopologyApi(service) {
  const baseEnv = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: service.stateRoot };
  const context = async input => {
    const identity = await service.resolveConsumer(input.consumerCwd);
    return { consumer: identity.requestedCwd, env: await withMintedSessionIdentity(baseEnv), pluginRoot: service.pluginRoot, stateHome: service.stateRoot };
  };
  // TM-356: the agent a mailbox tool acts as is this server's session identity (the launcher's
  // AO_AGENT_ID and AO_CONSUMER, else the SessionStart-minted one), never the tool's `from` or
  // `agent` field, which may only repeat it.
  const me = async (agent, options) => {
    const { sessionIdentity } = await import('../topology/lib/standing-mailbox.mjs');
    return sessionIdentity({ env: options.env, agent, consumer: options.consumer });
  };
  const runArgs = (input, options) => [flag('run', input.runDir), flag('consumer', options.consumer)];
  return {
    async runMailSend(input) {
      const options = await context(input);
      const sender = await me(input.from, options);
      const args = ['send', ...runArgs(input, options), flag('from', sender.agent), flag('to', input.to.join(',')), flag('stage', input.stage ?? 'message')];
      for (const key of ['subject', 'task']) if (input[key]) args.push(flag(key, input[key]));
      const { exitCode, value } = await runTopologyCli(args, { env: options.env, cwd: options.consumer, input: input.body });
      // Exit 3 is a sent message whose pointer did not land in a pane; the caller is told, not failed.
      return { ...value, undelivered: exitCode === 3 };
    },
    async runMailReply(input) {
      const options = await context(input);
      const { agent } = await me(input.agent, options);
      return (await runTopologyCli(['reply', ...runArgs(input, options), flag('agent', agent), flag('message', input.messageId)],
        { env: options.env, cwd: options.consumer, input: input.body })).value;
    },
    async runMailWait(input) {
      const options = await context(input);
      const args = ['wait', ...runArgs(input, options), flag('timeout', `${input.timeoutMs ?? 55_000}ms`), flag('poll', `${input.pollIntervalMs ?? 2000}ms`), '--quiet'];
      if (input.from?.length) args.push(flag('from', input.from.join(',')));
      if (input.messageId) args.push(flag('message', input.messageId));
      const { value } = await runTopologyCli(args, { env: options.env, cwd: options.consumer });
      if (!value.ok) { const { fail } = await import('../topology/lib/util.mjs'); fail('TOPOLOGY_WAIT_TIMEOUT', `No reply within ${input.timeoutMs ?? 55_000}ms; still pending: ${(value.pending ?? []).map(item => `${item.agent}:${item.id}`).join(', ')}`, value); }
      return value;
    },
    async leadStatus(input) {
      const options = await context(input);
      const { leadState } = await import('../topology/lib/lead.mjs');
      const { leadRecoveryStatus } = await import('../topology/lib/lead-recovery.mjs');
      // `cached` answers from proof already on disk and mints no probe; otherwise the probe is bounded.
      const state = await leadState({ consumer: options.consumer, env: options.env, pluginRoot: options.pluginRoot,
        ...(input.cached ? { readOnly: true, ackTimeoutMs: 0 } : { ackTimeoutMs: input.ackTimeoutMs ?? 30_000 }) });
      return { ...state, recovery: await leadRecoveryStatus({ consumer: options.consumer, env: options.env }) };
    },
    async sessionHandoff(input) {
      const options = await context(input);
      // TM-463: the verb itself refuses a caller that is neither the lead nor the target agent.
      return (await runTopologyCli(['session', 'handoff', flag('agent', input.agent), flag('file', input.file), flag('consumer', options.consumer)],
        { env: options.env, cwd: options.consumer })).value;
    },
    async mailboxSend(input) {
      const options = await context(input);
      const sender = await me(input.from, options);
      const destination = input.destinationConsumerCwd ? await service.resolveConsumer(input.destinationConsumerCwd) : null;
      const { sendStandingMessage } = await import('../topology/lib/standing-mailbox.mjs');
      const { selectLiveTransport } = await import('../topology/lib/orch-transport.mjs');
      const transport = await selectLiveTransport({ env: options.env });
      return sendStandingMessage({ ...input, consumer: destination?.requestedCwd || options.consumer,
        from: sender.agent, fromProject: sender.consumer, provenance: { source: 'orchestration_mailbox_send' } }, { ...options, transport });
    },
    async mailboxReceive(input) {
      const options = await context(input);
      const { agent } = await me(input.agent, options);
      const { readStandingInbox } = await import('../topology/lib/standing-mailbox.mjs');
      const { selectLiveTransport } = await import('../topology/lib/orch-transport.mjs');
      return readStandingInbox({ ...options, agent, limit: input.limit,
        transport: await selectLiveTransport({ env: options.env }) });
    },
    async mailboxWait(input) {
      const options = await context(input);
      // TM-465: only the message's sender may wait on (and so read) its reply. The repository check is
      // the envelope's sourceRepoId inside waitForStandingReply, as for the CLI, not consumerCwd.
      const caller = await me(null, { ...options, consumer: null });
      const { waitForStandingReply } = await import('../topology/lib/standing-mailbox.mjs');
      const result = await waitForStandingReply({ ...options, caller, id: input.id, timeoutMs: input.timeoutMs ?? 55_000, pollMs: input.pollIntervalMs ?? 2000 });
      // A timeout or a permanent hold is a tool error naming the message, as the CLI exits non-zero.
      if (!result.ok) { const { fail } = await import('../topology/lib/util.mjs'); fail(result.code, result.message, result); }
      return result;
    },
    async mailboxList(input) {
      const options = await context(input);
      const { agent } = await me(input.agent, options);
      const { listMailboxReceipts } = await import('../topology/lib/mailbox-receipts.mjs');
      // Named fields only: a tool input can never carry allAgents through to the reader.
      return { receipts: await listMailboxReceipts({ ...options, agent, kind: input.kind, status: input.status,
        workflowId: input.workflowId, runId: input.runId, taskId: input.taskId }) };
    },
    async mailboxDispose(input) {
      const options = await context(input);
      const { agent } = await me(input.agent, options);
      const { setMailboxDisposition } = await import('../topology/lib/mailbox-receipts.mjs');
      // TM-482 F2: receipts are per sender; `sender` picks one when several senders reused the ID.
      return setMailboxDisposition({ ...input, ...options, agent, from: input.sender });
    },
    async goalStart(input) {
      const options = await context(input);
      const { startGoalLoop } = await import('../topology/lib/goal-loop.mjs');
      return startGoalLoop({ ...options, goalId: input.goalId, request: input.request });
    },
    async goalStatus(input) {
      const options = await context(input);
      const api = await import('../topology/lib/goal-loop.mjs');
      return input.loopId ? api.showGoalLoop({ ...options, loopId: input.loopId }) : { loops: await api.listGoalLoops(options) };
    },
    async goalReport(input) {
      const options = await context(input);
      const { reportGoalLoop } = await import('../topology/lib/goal-loop.mjs');
      return reportGoalLoop({ ...options, loopId: input.loopId, report: input.report });
    },
    async goalControl(input) {
      const options = await context(input);
      const { controlGoalLoop } = await import('../topology/lib/goal-loop.mjs');
      // Tool input never attests a human. Human-only decisions remain on the
      // authenticated operator surface even if a body says actor.kind=human.
      return controlGoalLoop({ ...options, loopId: input.loopId, request: input.request, authenticatedHuman: false });
    },
    async goalReconcile(input) {
      const options = await context(input);
      const api = await import('../topology/lib/goal-loop.mjs');
      return input.loopId ? api.reconcileGoalLoop({ ...options, loopId: input.loopId }) : { loops: await api.reconcileGoalLoops(options) };
    },
  };
}
