/**
 * Stdio transport check: spawn the bundled server, run initialize + tools/list + a live call.
 * Usage: TEAMCITY_URL=... TEAMCITY_TOKEN=... npx tsx scripts/mcp-stdio-check.ts [path-to-bundle]
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const bin = process.argv[2] ?? 'dist/bundle.cjs';

if (!process.env.TEAMCITY_URL) {
  console.error('Set TEAMCITY_URL and credentials (TEAMCITY_TOKEN or USERNAME/PASSWORD) first');
  process.exit(1);
}

const child = spawn('node', [bin, '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'] });
const rl = createInterface({ input: child.stdout });

type RpcMessage = { id?: number; result?: Record<string, unknown>; error?: { message: string } };
const pending = new Map<number, { resolve: (m: RpcMessage) => void; reject: (e: Error) => void }>();

rl.on('line', (line) => {
  let msg: RpcMessage;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // not JSON-RPC (shouldn't happen on stdout)
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)!.resolve(msg);
    pending.delete(msg.id);
  }
});

let nextId = 0;
function rpc(method: string, params: unknown): Promise<RpcMessage> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 20_000);
    pending.set(id, {
      resolve: (m) => {
        clearTimeout(timer);
        resolve(m);
      },
      reject,
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function expectResult(msg: RpcMessage, label: string): Record<string, unknown> {
  if (msg.error) throw new Error(`${label} failed: ${msg.error.message}`);
  return msg.result ?? {};
}

try {
  const init = expectResult(
    await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mcp-stdio-check', version: '0.1.0' },
    }),
    'initialize',
  );
  console.log('initialize OK —', JSON.stringify(init.serverInfo));

  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = expectResult(await rpc('tools/list', {}), 'tools/list');
  const tools = (list.tools ?? []) as Array<{ name: string }>;
  console.log(`tools/list OK — ${tools.length} tools`);

  const call = expectResult(
    await rpc('tools/call', { name: 'get_server_info', arguments: {} }),
    'tools/call get_server_info',
  );
  const content = (call.content ?? []) as Array<{ text: string }>;
  const info = JSON.parse(content[0].text);
  console.log(`get_server_info OK — TeamCity ${info.version} (build ${info.buildNumber})`);

  console.log('\nStdio transport check passed');
} finally {
  child.kill();
}
