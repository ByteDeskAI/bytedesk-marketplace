/**
 * Minimal MCP streamable-HTTP client check: initialize -> tools/list -> (optional) call -> DELETE.
 * Usage: npx tsx scripts/mcp-client-check.ts [url] [bearerToken]
 * Defaults: url http://127.0.0.1:3000/mcp
 */
const url = process.argv[2] ?? 'http://127.0.0.1:3000/mcp';
const token = process.argv[3];

function headers(sessionId?: string): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (token) h.authorization = `Bearer ${token}`;
  if (sessionId) h['mcp-session-id'] = sessionId;
  return h;
}

async function rpc(
  method: string,
  params: unknown,
  id: number,
  sessionId?: string,
): Promise<{ result?: Record<string, unknown>; sessionId?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: headers(sessionId),
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const sid = res.headers.get('mcp-session-id') ?? sessionId;
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    const dataLines = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
    const last = dataLines.map((d) => JSON.parse(d)).find((m) => m.id === id);
    return { result: last?.result, sessionId: sid };
  }
  const body = (await res.json()) as { result?: Record<string, unknown> };
  return { result: body.result, sessionId: sid };
}

const init = await rpc(
  'initialize',
  {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'mcp-client-check', version: '0.1.0' },
  },
  1,
);
if (!init.sessionId) throw new Error('No session id returned (server running stateless?)');
console.log(`initialize OK — session ${init.sessionId}, server:`, JSON.stringify(init.result?.serverInfo));

await fetch(url, {
  method: 'POST',
  headers: headers(init.sessionId),
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
});

const list = await rpc('tools/list', {}, 2, init.sessionId);
const tools = (list.result?.tools ?? []) as Array<{ name: string }>;
console.log(`tools/list OK — ${tools.length} tools:`);
console.log(tools.map((t) => t.name).join(', '));

const del = await fetch(url, { method: 'DELETE', headers: headers(init.sessionId) });
console.log(`session DELETE -> HTTP ${del.status}`);
