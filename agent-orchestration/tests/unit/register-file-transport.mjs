// The product default is NATS. This preload keeps the existing unit suite on the
// file double unless a test passes its own transport or sets AO_TRANSPORT itself.
if (!process.env.AO_TRANSPORT) process.env.AO_TRANSPORT = 'file';
// TM-272/TM-298: the managed-services opt-out lives in tests/helpers/tmux-preflight.mjs, which both
// the unit and the contract suites load.
// TM-464: a suite run from inside an agent session must not inherit that session's identity; the
// in-process MCP adapters would act as it. Tests that need an identity set one explicitly.
for (const key of ['AO_SESSION_AGENT_ID', 'AO_SESSION_CONSUMER', 'CLAUDE_CODE_SESSION_ID']) delete process.env[key];
// TM-482: quarantine and unreadable-record escalation page the operator through ntfy. A test run
// must never reach the operator's real topic, so the topic and token are scrubbed here.
for (const key of ['AO_NTFY_TOPIC', 'TM_NTFY_TOPIC', 'AO_NTFY_TOKEN', 'TM_NTFY_TOKEN']) delete process.env[key];
