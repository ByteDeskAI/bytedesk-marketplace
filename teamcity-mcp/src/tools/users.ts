/** User and server introspection tools. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpMode } from '../config.js';
import { paginate, type TeamCityClient } from '../teamcity/client.js';
import { FIELDS_HELP, LOCATOR_HELP, handler } from './util.js';

export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  void mode; // read-only module: no write tools to gate.

  server.registerTool(
    'get_current_user',
    {
      description:
        'Get the identity and permissions of the user behind the configured token or ' +
        'credentials — use to verify auth works.',
      inputSchema: {
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) => client.get('users/current', { fields: args.fields })),
  );

  server.registerTool(
    'list_users',
    {
      description:
        'List users. Locator dims include id, username, email, name, group, role, lastLogin.',
      inputSchema: {
        locator: z.string().optional().describe(LOCATOR_HELP),
        fields: z.string().optional().describe(FIELDS_HELP),
        pageSize: z.number().optional().describe('Items per page (default 100).'),
        maxPages: z.number().optional().describe('Max pages to fetch (default 1; hard cap 50 with all).'),
        all: z.boolean().optional().describe('Page until no nextHref remains (bounded by maxPages).'),
      },
    },
    handler(async (args) =>
      paginate(client, 'users', {
        locator: args.locator,
        fields: args.fields,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        all: args.all,
      }),
    ),
  );

  server.registerTool(
    'get_server_info',
    {
      description: 'Get server version, build number, server time, and node id.',
      inputSchema: {
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) => client.get('server', { fields: args.fields })),
  );

  server.registerTool(
    'get_server_metrics',
    {
      description: 'Get server metrics (JVM, builds, agents).',
    },
    handler(async () => client.get('server/metrics')),
  );
}
