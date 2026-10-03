#!/usr/bin/env node
// A stand-in agent that answers a mailbox pointer by running the REAL `ao-topology reply` as a child, so the
// reply travels through the same environment a real agent's tool call would: AO_CREDS_SOCK, no secrets.
import { execFile } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const log = (record) => process.env.CREDS_AGENT_LOG && appendFileSync(process.env.CREDS_AGENT_LOG, `${JSON.stringify({ pid: process.pid, agent: process.env.AO_AGENT_ID, ...record })}\n`);
const cli = fileURLToPath(new URL('../../topology/cli.mjs', import.meta.url));
log({ event: 'start', aoEnv: Object.keys(process.env).filter((k) => k.startsWith('AO_')).sort() });
process.stdout.write('creds-agent ready\n> ');
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return process.stdout.write('> ');
  if (/^Read (\S+) and follow it exactly/.test(text)) { process.stdout.write('READY\n> '); return; }
  process.stdout.write(`echo: ${text}\n> `);
});

// Mail arrives on the agent's durable. The agent pulls it the way a tool call would (`mailbox inbox`) and answers
// with `mailbox reply`, both as child processes inheriting this pane's environment.
const run = (args) => new Promise((resolve) => execFile(process.execPath, [cli, ...args, '--consumer', process.env.AO_CONSUMER, '--json'],
  { env: process.env, timeout: 60_000 }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) })));
const answered = new Set();
let busy = false;
setInterval(async () => {
  if (busy) return; busy = true;
  try {
    const inbox = await run(['mailbox', 'inbox']);
    let parsed = null; try { parsed = JSON.parse(inbox.stdout); } catch { /* not json */ }
    const items = Array.isArray(parsed) ? parsed : parsed?.messages ?? parsed?.inbox ?? [];
    if (items.length || !inbox.ok) log({ event: 'inbox', ok: inbox.ok, stdout: inbox.stdout.slice(0, 500), stderr: inbox.stderr.slice(0, 300) });
    for (const item of items) {
      const id = item.id ?? item.messageId;
      if (!id || answered.has(id)) continue;
      answered.add(id);
      // `run:<run id>:<message id>` -> the run's own message id, answered through the real `ao-topology reply` (token from the holder).
      const reply = await run(['reply', '--agent', process.env.AO_AGENT_ID, '--message', String(id).split(':').pop(), '--run', process.env.AO_RUN_DIR, '--body', `PONG from ${process.env.AO_AGENT_ID}`]);
      log({ event: 'replied', id, ok: reply.ok, stdout: reply.stdout.slice(0, 300), stderr: reply.stderr.slice(0, 400) });
    }
  } finally { busy = false; }
}, 1500).unref?.();
