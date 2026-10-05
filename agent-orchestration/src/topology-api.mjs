// MCP adapters share the topology domain services. Consumer admission stays at the
// public boundary; neither the plugin cwd nor an earlier request supplies identity.
export function createTopologyApi(service) {
  const env = { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: service.stateRoot };
  const context = async input => {
    const identity = await service.resolveConsumer(input.consumerCwd);
    return { consumer: identity.requestedCwd, env, pluginRoot: service.pluginRoot, stateHome: service.stateRoot };
  };
  return {
    async mailboxSend(input) {
      const options = await context(input);
      const destination = input.destinationConsumerCwd ? await service.resolveConsumer(input.destinationConsumerCwd) : null;
      const { sendStandingMessage } = await import('../topology/lib/standing-mailbox.mjs');
      const { selectLiveTransport } = await import('../topology/lib/orch-transport.mjs');
      const transport = await selectLiveTransport({ env });
      return sendStandingMessage({ ...input, consumer: destination?.requestedCwd || options.consumer,
        fromProject: options.consumer, provenance: { source: 'orchestration_mailbox_send' } }, { ...options, transport });
    },
    async mailboxReceive(input) {
      const options = await context(input);
      const { readStandingInbox } = await import('../topology/lib/standing-mailbox.mjs');
      const { selectLiveTransport } = await import('../topology/lib/orch-transport.mjs');
      return readStandingInbox({ ...options, agent: input.agent, limit: input.limit,
        transport: await selectLiveTransport({ env }) });
    },
    async mailboxWait(input) {
      const options = await context(input);
      const { waitForStandingReply } = await import('../topology/lib/standing-mailbox.mjs');
      const result = await waitForStandingReply({ ...options, id: input.id, timeoutMs: input.timeoutMs ?? 55_000, pollMs: input.pollIntervalMs ?? 2000 });
      // A timeout or a permanent hold is a tool error naming the message, as the CLI exits non-zero.
      if (!result.ok) { const { fail } = await import('../topology/lib/util.mjs'); fail(result.code, result.message, result); }
      return result;
    },
    async mailboxList(input) {
      const options = await context(input);
      const { listMailboxReceipts } = await import('../topology/lib/mailbox-receipts.mjs');
      return { receipts: await listMailboxReceipts({ ...input, ...options }) };
    },
    async mailboxDispose(input) {
      const options = await context(input);
      const { setMailboxDisposition } = await import('../topology/lib/mailbox-receipts.mjs');
      return setMailboxDisposition({ ...input, ...options });
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
