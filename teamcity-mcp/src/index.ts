#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { InMemoryEventStore } from '@modelcontextprotocol/sdk/examples/shared/inMemoryEventStore.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import type { Config } from './config.js';
import { TeamCityClient } from './teamcity/client.js';
import { createMcpServer } from './server.js';

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  });
}

function startHttp(config: Config, serverClient: TeamCityClient): void {
  /**
   * Resolve the TeamCity client for one inbound request. In gateway mode
   * (TEAMCITY_PER_REQUEST_AUTH) the caller's TeamCity token arrives in the
   * `x-teamcity-token` header — or, when the MCP endpoint itself is unprotected,
   * in the Authorization bearer. The token is validated once per session against
   * users/current.
   */
  async function clientFor(req: Request): Promise<TeamCityClient> {
    if (!config.perRequestAuth) return serverClient;
    const headerToken = req.headers['x-teamcity-token'];
    let token = Array.isArray(headerToken) ? headerToken[0] : headerToken;
    if (!token && !config.mcpAuthToken) {
      const auth = req.headers.authorization;
      if (auth?.startsWith('Bearer ')) token = auth.slice('Bearer '.length);
    }
    if (!token) {
      throw new HttpError(
        401,
        'Per-request auth is enabled: send your TeamCity access token in the x-teamcity-token header',
      );
    }
    const client = serverClient.withToken(token);
    await client.get('users/current', { fields: 'id,username' }); // validates the token
    return client;
  }

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // MCP endpoint auth (static bearer) — required automatically for non-loopback binds.
  app.use('/mcp', (req, res, next) => {
    if (!config.mcpAuthToken) return next();
    if (req.headers.authorization === `Bearer ${config.mcpAuthToken}`) return next();
    res.set('WWW-Authenticate', 'Bearer realm="teamcity-mcp"');
    jsonRpcError(res, 401, 'Unauthorized: missing or invalid MCP bearer token');
  });

  // DNS-rebinding hardening: Origin, when present, must match the Host header.
  app.use('/mcp', (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    try {
      if (new URL(origin).host === req.headers.host) return next();
    } catch {
      /* fall through to 403 */
    }
    jsonRpcError(res, 403, 'Forbidden: Origin header does not match Host');
  });

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', mode: config.mode, teamcityUrl: config.teamcityUrl });
  });

  const transports = new Map<string, StreamableHTTPServerTransport>();

  async function handlePost(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    try {
      if (sessionId) {
        const transport = transports.get(sessionId);
        if (!transport) return jsonRpcError(res, 404, 'Unknown or expired session; re-initialize');
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        return jsonRpcError(res, 400, 'First request must be an MCP initialize request');
      }

      const client = await clientFor(req);

      if (config.stateless) {
        // No session: dedicated server+transport, torn down with the response.
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = createMcpServer(client, config.mode);
        res.on('close', () => {
          transport.close().catch(() => {});
          server.close().catch(() => {});
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      const eventStore = new InMemoryEventStore();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      const server = createMcpServer(client, config.mode);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (err instanceof HttpError) return jsonRpcError(res, err.status, err.message);
      if (err instanceof Error && err.message.startsWith('TeamCity 401')) {
        return jsonRpcError(res, 401, 'TeamCity rejected the provided credentials');
      }
      console.error('Error handling POST /mcp:', err);
      if (!res.headersSent) jsonRpcError(res, 500, 'Internal server error');
    }
  }

  async function handleSessionRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) return jsonRpcError(res, 400, 'Missing Mcp-Session-Id header');
    const transport = transports.get(sessionId);
    if (!transport) return jsonRpcError(res, 404, 'Unknown or expired session; re-initialize');
    await transport.handleRequest(req, res);
  }

  app.post('/mcp', (req, res) => void handlePost(req, res));
  app.get('/mcp', (req, res) =>
    void handleSessionRequest(req, res).catch(() => jsonRpcError(res, 500, 'Internal server error')),
  );
  app.delete('/mcp', (req, res) =>
    void handleSessionRequest(req, res).catch(() => jsonRpcError(res, 500, 'Internal server error')),
  );

  app.listen(config.port, config.host, () => {
    console.log(
      `teamcity-mcp listening on http://${config.host}:${config.port}/mcp ` +
        `(mode=${config.mode}, stateless=${config.stateless}, ` +
        `teamcity=${config.teamcityUrl}, auth=${config.perRequestAuth ? 'per-request' : config.auth.kind})`,
    );
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const transport = process.argv.includes('--stdio') ? 'stdio' : config.transport;
  const client = new TeamCityClient(config.teamcityUrl, config.auth);

  if (transport === 'stdio') {
    // JSON-RPC owns stdout: all diagnostics go to stderr.
    const server = createMcpServer(client, config.mode);
    await server.connect(new StdioServerTransport());
    console.error(
      `teamcity-mcp stdio ready (mode=${config.mode}, teamcity=${config.teamcityUrl}, auth=${config.auth.kind})`,
    );
    return;
  }

  startHttp(config, client);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
