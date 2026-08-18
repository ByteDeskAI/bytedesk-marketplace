/** Build agent and agent-pool tools. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpMode } from '../config.js';
import { paginate, type TeamCityClient } from '../teamcity/client.js';
import { FIELDS_HELP, LOCATOR_HELP, handler } from './util.js';

export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  server.registerTool(
    'list_agents',
    {
      description:
        'List build agents. Locator dims include name, ip, connected, authorized, enabled, pool. ' +
        'Suggested fields: "count,agent(id,name,connected,authorized,enabled,ip,pool)".',
      inputSchema: {
        locator: z.string().optional().describe(LOCATOR_HELP),
        fields: z.string().optional().describe(FIELDS_HELP),
        pageSize: z.number().optional().describe('Items per page (default 100).'),
        maxPages: z.number().optional().describe('Max pages to fetch (default 1; hard cap 50 with all).'),
        all: z.boolean().optional().describe('Page until no nextHref remains (bounded by maxPages).'),
      },
    },
    handler(async (args) =>
      paginate(client, 'agents', {
        locator: args.locator,
        fields: args.fields,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        all: args.all,
      }),
    ),
  );

  server.registerTool(
    'list_agent_pools',
    {
      description:
        'List agent pools. Pools group agents and control which projects may run builds on them.',
      inputSchema: {
        locator: z.string().optional().describe(LOCATOR_HELP),
        fields: z.string().optional().describe(FIELDS_HELP),
        pageSize: z.number().optional().describe('Items per page (default 100).'),
        maxPages: z.number().optional().describe('Max pages to fetch (default 1; hard cap 50 with all).'),
        all: z.boolean().optional().describe('Page until no nextHref remains (bounded by maxPages).'),
      },
    },
    handler(async (args) =>
      paginate(client, 'agentPools', {
        locator: args.locator,
        fields: args.fields,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        all: args.all,
      }),
    ),
  );

  if (mode === 'full') {
    server.registerTool(
      'authorize_agent',
      {
        description:
          'Authorize or unauthorize a build agent; unauthorized agents cannot run builds.',
        inputSchema: {
          agent: z.string().describe('Agent locator, e.g. "id:3" or "name:agent-01".'),
          authorized: z.boolean().describe('true to authorize, false to unauthorize.'),
          comment: z.string().optional().describe('Optional audit comment.'),
        },
      },
      handler(async (args) => {
        await client.put(`agents/${args.agent}/authorizedInfo`, {
          status: args.authorized,
          ...(args.comment && { comment: args.comment }),
        });
        return { success: true };
      }),
    );

    server.registerTool(
      'enable_agent',
      {
        description: 'Enable or disable a build agent; disabled agents start no new builds.',
        inputSchema: {
          agent: z.string().describe('Agent locator, e.g. "id:3" or "name:agent-01".'),
          enabled: z.boolean().describe('true to enable, false to disable.'),
          comment: z.string().optional().describe('Optional audit comment.'),
        },
      },
      handler(async (args) => {
        await client.put(`agents/${args.agent}/enabledInfo`, {
          status: args.enabled,
          ...(args.comment && { comment: args.comment }),
        });
        return { success: true };
      }),
    );
  }
}
