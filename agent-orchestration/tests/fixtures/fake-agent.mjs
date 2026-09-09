#!/usr/bin/env node
// A deterministic stand-in for an interactive agent CLI. It prints a prompt, reads typed lines,
// answers the bootstrap pointer with READY, and answers a mailbox pointer by writing a reply file.
import { readFile, writeFile, mkdir, readdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const model = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "fake";
// `--fail limit` imitates a CLI that refuses to serve; `--fail crash` exits immediately.
const failMode = process.argv.includes("--fail") ? process.argv[process.argv.indexOf("--fail") + 1] : null;
if (failMode === "limit") {
  process.stdout.write(`fake-agent ${model}: You have reached your usage limit. Try again later.\n`);
  setTimeout(() => process.exit(1), 60_000);
} else if (failMode === "crash") {
  process.exit(3);
}
if (!failMode) process.stdout.write(`fake-agent ${model} ready\n> `);

let bootstrapped = false;
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const defer = stage => arg('--defer-stage') === stage && arg('--defer-model') === model;
async function reply({ id, from, stage, inbox, outbox }) {
  if (defer(stage)) return;
  if (await access(outbox).then(() => true, () => false)) return;
  const body = await readFile(inbox, 'utf8');
  await mkdir(dirname(outbox), { recursive: true });
  await writeFile(outbox, `# Reply to ${id}\n\nfrom-agent: ${process.env.AO_AGENT_ID}\nstage: ${stage}\nmodel: ${model}\nsaw-body: ${body.includes('PING') ? 'PING' : 'no'}\n`);
  process.stdout.write(`replied to ${from}\n> `);
}
// Cooperative file polling is this fixture's safe-boundary behavior. It proves durable receipt,
// not guaranteed wakeup support in any production coding-agent CLI.
let polling = false;
setInterval(async () => {
  if (!bootstrapped || polling || failMode || !process.env.AO_RUN_DIR || !process.env.AO_AGENT_ID) return;
  polling = true;
  try {
    const inboxDir = join(process.env.AO_RUN_DIR, 'agents', process.env.AO_AGENT_ID, 'inbox');
    for (const name of await readdir(inboxDir).catch(() => [])) {
      if (!name.endsWith('.md')) continue;
      const inbox = join(inboxDir, name);
      const body = await readFile(inbox, 'utf8');
      const field = key => body.match(new RegExp('^' + key + ': (.+)$', 'm'))?.[1];
      const id = field('id'), from = field('from'), stage = field('stage'), outbox = field('reply_to');
      if (id && from && stage && outbox) await reply({ id, from, stage, inbox, outbox });
    }
  } finally { polling = false; }
}, 100).unref();

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return process.stdout.write("> ");
  const bootstrap = text.match(/^Read (\S+) and follow it exactly/);
  if (bootstrap) {
    const content = await readFile(bootstrap[1], "utf8").catch(() => "");
    bootstrapped = content.includes("# Bootstrap");
    process.stdout.write(`${bootstrapped ? "READY" : "BOOTSTRAP MISSING"}\n> `);
    return;
  }
  const pointer = text.match(/^\[ao\] Message (\S+) from (\S+) \((\S+)\): read (\S+) then write your complete reply to (\S+)/);
  if (pointer) {
    const [, id, from, stage, inbox, outbox] = pointer;
    await reply({ id, from, stage, inbox, outbox });
    return;
  }
  if (text === "exit") process.exit(0);
  process.stdout.write(`echo: ${text}\n> `);
});
