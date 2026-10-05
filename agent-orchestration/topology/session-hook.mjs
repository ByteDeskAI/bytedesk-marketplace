#!/usr/bin/env node
// Claude Code hook entry for the topology layer. Reads the hook's JSON on stdin and never blocks the
// session: every failure exits 0 with a note on stderr.
//
//   SessionStart  TM-353: mint this session's AO identity and export it through CLAUDE_ENV_FILE.
import { mintSessionIdentity } from "./lib/session-identity.mjs";

async function stdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text ? JSON.parse(text) : {};
}

try {
  const input = await stdin();
  const event = input.hook_event_name ?? process.argv[2];
  if (event === "SessionStart") {
    const result = await mintSessionIdentity({ sessionId: input.session_id, cwd: input.cwd ?? process.cwd() });
    if (result.agentId && result.exported) console.log(`AO session identity: ${result.agentId} (ao-topology mailbox send uses it as the sender; read replies with \`ao-topology mailbox inbox --agent ${result.agentId}\`).`);
  }
} catch (error) {
  process.stderr.write(`ao session hook: ${error?.code ?? ""} ${error?.message ?? error}\n`);
}
