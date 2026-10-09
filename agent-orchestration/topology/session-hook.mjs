#!/usr/bin/env node
// Claude Code hook entry for the topology layer. Reads the hook's JSON on stdin and never blocks the
// session: every failure exits 0 with a note on stderr.
//
//   SessionStart  TM-353: mint this session's AO identity and export it through CLAUDE_ENV_FILE.
//   UserPromptSubmit | PostToolUse | Stop
//                 TM-222: write this pane's harness heartbeat (lib/heartbeat.mjs). Outside tmux there
//                 is no pane to vouch for, so it returns before importing anything else.

async function stdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text ? JSON.parse(text) : {};
}

try {
  const input = await stdin();
  const event = input.hook_event_name ?? process.argv[2];
  if (event !== "SessionStart") {
    if (process.env.TMUX_PANE) await (await import("./lib/heartbeat.mjs")).recordHeartbeat({ event });
  } else {
    const { mintSessionIdentity } = await import("./lib/session-identity.mjs");
    const result = await mintSessionIdentity({ sessionId: input.session_id, cwd: input.cwd ?? process.cwd() });
    if (result.agentId && result.exported) console.log(`AO session identity: ${result.agentId} (ao-topology mailbox send uses it as the sender; read replies with \`ao-topology mailbox inbox --agent ${result.agentId}\`).`);
  }
} catch (error) {
  process.stderr.write(`ao session hook: ${error?.code ?? ""} ${error?.message ?? error}\n`);
}
