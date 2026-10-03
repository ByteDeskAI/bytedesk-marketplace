#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OrchestrationService } from "./service.mjs";
import { serializeError } from "./errors.mjs";
import { TASK_INTENTS } from "./policy/catalog.mjs";
import { MODEL_CATALOG, PROVIDER_CATALOG } from "./providers/index.mjs";
import { PROTOCOL_DEFINITIONS } from "./protocols/definitions.mjs";
import { createTopologyApi } from "./topology-api.mjs";

const intent = z.enum(TASK_INTENTS);
const effort = z.enum([...new Set(MODEL_CATALOG.flatMap((entry) => entry.supportedEfforts))]);
const provider = z.enum(PROVIDER_CATALOG.map((entry) => entry.providerId));
const endpointId = z.enum(MODEL_CATALOG.map((entry) => entry.endpointId));
const protocolId = z.enum(Object.keys(PROTOCOL_DEFINITIONS));
const sessionMode = z.enum(["oneshot", "persistent"]);
const availabilityState = z.enum(["available", "unavailable", "unknown"]);
const consumerCwd = z.string().describe("Required absolute path inside the repository that invoked the plugin. Never use the plugin or marketplace cwd.");
const routingFields = {
  consumerCwd,
  intent,
  task: z.string().min(1),
  requiredCapabilities: z.array(z.string()).optional(),
  provider: provider.optional().describe("Optional explicit provider. Dynamic routing is used when omitted."),
  endpointId: endpointId.optional().describe("Optional exact endpoint from the trusted model catalog. Arbitrary model IDs are rejected."),
  originProvider: provider.optional().describe("For review tasks, exclude the originating provider family when possible."),
  effort: effort.optional(),
  optimization: z.enum(["quality", "latency", "cost", "balanced", "mechanical"]).optional(),
  risk: z.enum(["low", "medium", "high", "critical"]).optional(),
  availability: z.object({
    providers: z.record(z.string(), availabilityState),
    endpoints: z.record(z.string(), availabilityState),
  }).passthrough().optional(),
  allowProviders: z.array(z.string()).optional(),
  denyProviders: z.array(z.string()).optional(),
  snapshotId: z.string().optional(),
  protocolId: protocolId.optional().describe("Optional execution protocol. The service applies its intent-based default when omitted."),
  sessionMode: sessionMode.optional().describe("Optional provider-session lifecycle. The service applies its default when omitted."),
};
const { protocolId: _protocolOnlyForPlans, ...singleRouteFields } = routingFields;
const runFields = { consumerCwd, runId: z.string().min(1) };

const errorData = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.unknown().optional(),
}).passthrough();

const consumerData = z.object({
  requestedCwd: z.string(),
  checkoutRoot: z.string(),
  repositoryKey: z.string(),
}).passthrough();

const routingCandidateData = z.object({
  candidateId: z.string(),
  endpointId: z.string(),
  providerId: z.string().nullable(),
  eligible: z.boolean(),
  rejectionCodes: z.array(z.string()),
}).passthrough();

const routingDecisionData = z.object({
  kind: z.literal("routing_decision"),
  schemaVersion: z.literal(1),
  decisionId: z.string(),
  intent,
  alias: z.string(),
  status: z.string(),
  candidates: z.array(routingCandidateData),
  selected: routingCandidateData.nullable(),
  fallbackPath: z.array(z.string()),
}).passthrough();

const routingExplanationData = z.object({
  kind: z.literal("routing_explanation"),
  schemaVersion: z.literal(1),
  decisionId: z.string(),
  status: z.string(),
  summary: z.string(),
}).passthrough();

const executionPlanData = z.object({
  kind: z.literal("execution_plan"),
  schemaVersion: z.literal(1),
  planId: z.string().optional(),
  protocolId: z.string(),
  intent,
  status: z.string(),
  stages: z.array(z.object({
    stageId: z.string(),
    role: z.string(),
  }).passthrough()),
}).passthrough();

const executionPlanExplanationData = z.object({
  kind: z.literal("execution_plan_explanation"),
  schemaVersion: z.literal(1),
  planId: z.string(),
  protocolId: z.string(),
  status: z.string(),
  stages: z.array(z.object({ stageId: z.string(), role: z.string() }).passthrough()),
}).passthrough();

const runData = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  revision: z.number().int().nonnegative(),
  state: z.string(),
  input: z.object({
    intent,
    task: z.string(),
    permissionProfile: z.enum(["read", "write"]),
  }).passthrough(),
  consumer: consumerData,
  plan: executionPlanData,
  sessions: z.array(z.unknown()),
  outputs: z.array(z.unknown()),
}).passthrough();

const eventData = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  seq: z.number().int().positive(),
  at: z.string(),
  type: z.string(),
  revision: z.number().int().nonnegative(),
  previousHash: z.string().nullable(),
  hash: z.string(),
  payload: z.object({}).passthrough(),
}).passthrough();

const availabilityData = z.object({
  providers: z.record(z.string(), availabilityState),
  endpoints: z.record(z.string(), availabilityState),
}).passthrough();

const capabilitiesData = z.object({
  schemaVersion: z.literal(1),
  providerIds: z.array(z.string()),
  models: z.array(z.object({
    schemaVersion: z.literal(1),
    endpointId: z.string(),
    providerId: z.string(),
  }).passthrough()),
  intents: z.array(z.string()),
  protocols: z.array(z.string()),
  permissionProfiles: z.array(z.string()),
  lifecycle: z.array(z.string()),
}).passthrough();

const doctorData = z.object({
  ok: z.boolean(),
  pluginRoot: z.string(),
  stateRoot: z.string(),
  executables: z.array(z.object({ id: z.string(), command: z.string(), ok: z.boolean() }).passthrough()),
  providerProbes: z.array(z.object({ id: z.string(), ready: z.boolean(), reason: z.string() }).passthrough()),
  bundledBridges: z.array(z.object({ id: z.string(), ok: z.boolean(), path: z.string() }).passthrough()),
  availability: availabilityData,
}).passthrough();

const routeData = z.object({
  consumer: consumerData,
  decision: routingDecisionData,
  explanation: routingExplanationData,
}).passthrough();

const planData = z.object({
  consumer: consumerData,
  plan: executionPlanData,
  explanation: executionPlanExplanationData,
}).passthrough();

const spawnData = z.object({
  run: runData,
  explanation: executionPlanExplanationData,
}).passthrough();

const followupData = z.object({
  run: runData,
  parentRunId: z.string(),
}).passthrough();

const cleanupData = z.object({
  cleaned: z.boolean(),
  reason: z.string().optional(),
  run: runData,
}).passthrough();

const decisionData = z.object({
  runId: z.string(),
  protocol: z.union([z.string(), z.object({ protocolId: z.string() }).passthrough()]),
  state: z.string(),
  evidence: z.array(z.unknown()),
  approval: z.unknown().nullable(),
}).passthrough();

const approvedDecisionData = z.object({
  runId: z.string(),
  decision: z.object({ state: z.string() }).passthrough(),
  evidence: z.array(z.unknown()),
}).passthrough();

function outputEnvelope(successData) {
  return z.object({
    schemaVersion: z.literal(1),
    data: z.union([successData, errorData]),
  }).passthrough();
}

function result(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: { schemaVersion: 1, data: value },
  };
}

function register(server, service, name, description, inputSchema, outputDataSchema, operation) {
  server.registerTool(name, { description, inputSchema, outputSchema: outputEnvelope(outputDataSchema) }, async (input) => {
    try {
      return result(await operation.call(service, input));
    } catch (error) {
      const serialized = serializeError(error);
      return { ...result(serialized), isError: true };
    }
  });
}

export async function createServer(options = {}) {
  const service = await new OrchestrationService(options).initialize();
  const server = new McpServer({ name: "agent-orchestration", version: "0.16.1" });

  register(server, service, "orchestration_capabilities", "Describe orchestration providers, intents, protocols, permissions, lifecycle, and repository isolation guarantees.", {}, capabilitiesData, function () { return this.capabilities(); });
  register(server, service, "orchestration_doctor", "Check provider readiness through bounded, sandboxed, non-prompting ACP sessions without reading or exposing credentials. Pass consumerCwd so provider discovery runs where the caller runs.", { consumerCwd: consumerCwd.optional() }, doctorData, service.doctor);
  register(server, service, "orchestration_route", "Resolve a consumer repository and preview one deterministic, capability-aware provider/model route. Use orchestration_plan for multi-stage protocols.", singleRouteFields, routeData, service.route);
  register(server, service, "orchestration_plan", "Create an explainable execution plan. Architecture automatically uses the Claude-versus-Sol adversarial protocol.", { ...routingFields, permissionProfile: z.enum(["read", "write"]).default("read"), expectedOutput: z.string().optional(), timeoutMs: z.number().int().positive().max(7_200_000).optional() }, planData, service.plan);
  register(server, service, "orchestration_spawn", "Start a durable provider-native orchestration run. Write runs create an isolated worktree derived from consumerCwd.", { ...routingFields, permissionProfile: z.enum(["read", "write"]).default("read"), expectedOutput: z.string().optional(), timeoutMs: z.number().int().positive().max(7_200_000).optional(), maxTurns: z.number().int().positive().max(200).optional(), idempotencyKey: z.string().min(1).max(256).optional() }, spawnData, service.spawn);
  register(server, service, "orchestration_status", "Get a run after proving it belongs to the explicit consumer repository.", runFields, runData, service.getRun);
  register(server, service, "orchestration_list", "List runs belonging only to the explicit consumer repository.", { consumerCwd }, z.array(runData), service.list);
  register(server, service, "orchestration_events", "Read durable run events after a sequence number.", { ...runFields, after: z.number().int().nonnegative().optional() }, z.array(eventData), service.events);
  register(server, service, "orchestration_wait", "Wait up to 55 seconds for a run state change or terminal result.", { ...runFields, timeoutMs: z.number().int().positive().max(55_000).optional(), pollIntervalMs: z.number().int().positive().max(2_000).optional() }, runData, service.wait);
  register(server, service, "orchestration_send", "Start a cancellable child run that continues the final read-only provider session with a scoped follow-up message.", { ...runFields, message: z.string().min(1), timeoutMs: z.number().int().positive().max(7_200_000).optional() }, followupData, service.send);
  register(server, service, "orchestration_cancel", "Idempotently request cancellation and terminate the verified worker process group when active.", runFields, runData, service.cancel);
  register(server, service, "orchestration_cleanup", "Permanently discard and remove a terminal run worktree through Git after repository ownership checks.", runFields, cleanupData, service.cleanup);
  register(server, service, "orchestration_decision_get", "Return the attributed evidence and approval state for an architecture decision run.", runFields, decisionData, service.decision);
  // "attributed", not "authorized": `approvedBy` is an unauthenticated label. This gate proves that a
  // separate explicit act happened and records it with a rationale in the tamper-evident journal —
  // it does not prove who performed it, and the description says so where a caller will read it.
  register(server, service, "orchestration_decision_approve", "Record an approval or rejection of an architecture decision with a rationale. `approvedBy` is an unverified label, not an authenticated identity: this gate proves a separate explicit act was taken and journals it, it does not prove a human took it. For an approval an agent cannot make, use the run's loopback session UI, which mints a capability token this process holds.", { ...runFields, approved: z.boolean(), rationale: z.string().min(1), approvedBy: z.string().min(1) }, approvedDecisionData, service.approveDecision);

  const topology = createTopologyApi(service);
  const record = z.object({}).passthrough();
  const receipt = z.object({ messageId: z.string(), status: z.enum(['accepted', 'handled', 'deferred', 'rejected']), agent: z.string() }).passthrough();
  const loopRecord = z.object({ loopId: z.string(), state: z.string(), revision: z.number() }).passthrough();
  const agent = z.string().min(1).max(160);
  const loopId = z.string().regex(/^gl-[a-f0-9]{24}$/);
  const mailboxFields = { consumerCwd, agent: agent.optional(), kind: z.enum(['mail', 'reply']).optional(),
    status: z.enum(['accepted', 'handled', 'deferred', 'rejected']).optional(),
    workflowId: z.string().optional(), runId: z.string().optional(), taskId: z.string().optional() };
  register(server, topology, 'orchestration_mailbox_send', 'Send a durable inter-agent message through the logical mailbox. Publication, recipient acceptance and task ownership are separate outcomes.',
    { consumerCwd, destinationConsumerCwd: consumerCwd.optional(), from: agent, to: z.string().min(1).max(512), id: z.string().min(1).max(200), body: z.string().min(1).max(131072),
      task: z.string().optional(), stage: z.string().optional(), subject: z.string().optional(), context: record.optional() },
    z.object({ envelope: record, status: z.string() }).passthrough(), topology.mailboxSend);
  register(server, topology, 'orchestration_mailbox_receive', 'Receive mail into a durable recipient inbox before broker ACK. This accepts an obligation but does not claim or complete a task. Use mailbox_list for nondestructive inspection.',
    { consumerCwd, agent, limit: z.number().int().min(1).max(100).optional() }, z.array(record), topology.mailboxReceive);
  register(server, topology, 'orchestration_mailbox_list', 'Inspect retained mailbox receipts without consuming NATS messages. Receipt status is not task completion.',
    mailboxFields, z.object({ receipts: z.array(receipt) }).passthrough(), topology.mailboxList);
  register(server, topology, 'orchestration_mailbox_dispose', 'Record handled, deferred or rejected disposition for a retained recipient obligation. Task claims and completion remain in Task Management.',
    { consumerCwd, agent, messageId: z.string().min(1), kind: z.enum(['mail', 'reply']).default('mail'),
      disposition: z.enum(['handled', 'deferred', 'rejected']), reason: z.string().max(8192).optional(), retryAt: z.string().optional(), resultRef: z.string().optional() }, receipt, topology.mailboxDispose);
  register(server, topology, 'orchestration_goal_start', 'Start a persistent feedback loop for an explicitly admitted Task Management goal, pinned authority and approved deployment recipe.',
    { consumerCwd, goalId: z.string().regex(/^EP-\d+$/), request: record }, loopRecord, topology.goalStart);
  register(server, topology, 'orchestration_goal_status', 'Inspect a goal loop or list this repository\'s loops without launching work or consuming mail.',
    { consumerCwd, loopId: loopId.optional() }, record, topology.goalStatus);
  register(server, topology, 'orchestration_goal_report', 'Record a correlated phase outcome from the current lead. Goal, obligation, attempt, source revision and evidence must match; acceptance alone cannot advance a phase.',
    { consumerCwd, loopId, report: record }, loopRecord, topology.goalReport);
  register(server, topology, 'orchestration_goal_control', 'Control an owned goal loop with a revision-bound request. This tool does not attest human identity or authorize public release, destructive work, or expanded scope.',
    { consumerCwd, loopId, request: record }, loopRecord, topology.goalControl);
  register(server, topology, 'orchestration_goal_reconcile', 'Reconcile pending obligations and expired deadlines without resetting budgets or creating a second writer.',
    { consumerCwd, loopId: loopId.optional() }, record, topology.goalReconcile);

  return { server, service };
}

async function main() {
  const { server, service } = await createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const closeProtocol = transport.onclose;
  transport.onclose = () => { closeProtocol?.(); void service.dispose(); };
}

process.stdout.on("error", (error) => {
  if (error?.code === "EPIPE") process.exit(0);
  throw error;
});

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`[agent-orchestration] ${JSON.stringify(serializeError(error))}\n`);
    process.exitCode = 1;
  });
}
