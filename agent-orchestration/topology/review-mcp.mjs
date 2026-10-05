#!/usr/bin/env node
// TM-365: the reviewer's verdict channel. A stdio MCP server with one tool, review_submit, which
// writes the verdict through submitReviewVerdict. The restricted reviewer has no shell and no Write
// tool, so this tool is the only way its verdict leaves the session; the host never reads its pane.
//
// ponytail: hand-rolled newline-delimited JSON-RPC rather than the MCP SDK, because topology/ runs
// from the installed cache without node_modules. Four methods are all a one-tool server needs.
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { submitReviewVerdict } from './lib/reviewer.mjs';

export const REVIEW_SUBMIT_TOOL_SPEC = Object.freeze({
  name: 'review_submit',
  description: 'Submit your verdict for one review request. This is the ONLY way a verdict reaches the host; printing it does nothing. Refused submissions say what to fix; fix it and call again. Resubmitting before collection replaces your earlier verdict.',
  inputSchema: {
    type: 'object',
    required: ['request', 'verdict', 'findings'],
    properties: {
      request: { type: 'string', description: 'The review request nonce (from the AO_REVIEW_REQUEST line or the request file).' },
      verdict: { type: 'string', enum: ['approve', 'changes_requested', 'blocked'] },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          required: ['severity', 'file', 'line', 'claim'],
          properties: {
            severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit', 'note'] },
            file: { type: 'string', description: 'A path the patch changes (or CHANGELOG.md).' },
            line: { type: 'integer', minimum: 1 },
            claim: { type: 'string' },
            evidence: { type: 'string' },
            fix: { type: 'string' },
          },
        },
      },
    },
  },
});

/** One JSON-RPC message in, one response out (null for a notification). */
export async function handleMessage(message, { env = process.env, submit = submitReviewVerdict } = {}) {
  const { id, method, params } = message ?? {};
  if (id === undefined || id === null) return null;
  const reply = result => ({ jsonrpc: '2.0', id, result });
  if (method === 'initialize') return reply({ protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ao-review', version: '1.0.0' } });
  if (method === 'ping') return reply({});
  if (method === 'tools/list') return reply({ tools: [REVIEW_SUBMIT_TOOL_SPEC] });
  if (method === 'tools/call') {
    if (params?.name !== REVIEW_SUBMIT_TOOL_SPEC.name) return reply({ isError: true, content: [{ type: 'text', text: `Unknown tool ${params?.name}.` }] });
    const args = params.arguments ?? {};
    try {
      const result = await submit({ consumer: env.AO_CONSUMER, request: args.request, verdict: args.verdict, findings: args.findings ?? [], env });
      return reply({ content: [{ type: 'text', text: `Verdict ${result.verdict} submitted for ${result.task} at ${result.revision} (request ${result.nonce}, ${result.findings} finding(s)).` }] });
    } catch (error) {
      return reply({ isError: true, content: [{ type: 'text', text: `${error.code ?? 'ERROR'}: ${error.message}` }] });
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  createInterface({ input: process.stdin }).on('line', async line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const response = await handleMessage(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
