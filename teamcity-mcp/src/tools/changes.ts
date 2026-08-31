/** VCS change and VCS root tools. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpMode } from '../config.js';
import { paginate, type TeamCityClient } from '../teamcity/client.js';
import { FIELDS_HELP, LOCATOR_HELP, handler } from './util.js';

export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  void mode; // read-only module: no write tools to gate.

  server.registerTool(
    'list_changes',
    {
      description:
        'List VCS changes (commits). Locator dims include id, version, project, buildType, build, ' +
        'user, username, vcsRoot, pending, sinceChange. ' +
        'Suggested fields: "count,change(id,version,username,comment,date)".',
      inputSchema: {
        locator: z.string().optional().describe(LOCATOR_HELP),
        fields: z.string().optional().describe(FIELDS_HELP),
        pageSize: z.number().optional().describe('Items per page (default 100).'),
        maxPages: z.number().optional().describe('Max pages to fetch (default 1; hard cap 50 with all).'),
        all: z.boolean().optional().describe('Page until no nextHref remains (bounded by maxPages).'),
      },
    },
    handler(async (args) =>
      paginate(client, 'changes', {
        locator: args.locator,
        fields: args.fields,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        all: args.all,
      }),
    ),
  );

  server.registerTool(
    'get_change',
    {
      description:
        'Get one change by locator. Full detail includes the modified files with a per-file ' +
        'change type (added/edited/removed).',
      inputSchema: {
        change: z.string().describe('Change locator, e.g. "id:12345" or "version:<sha>".'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) => client.get(`changes/${args.change}`, { fields: args.fields })),
  );

}
