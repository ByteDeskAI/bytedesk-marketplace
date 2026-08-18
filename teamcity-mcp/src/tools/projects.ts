// Project tools: list/get, plus create/parameter writes in full mode.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamCityClient } from '../teamcity/client.js';
import { paginate } from '../teamcity/client.js';
import type { McpMode } from '../config.js';
import { handler, LOCATOR_HELP, FIELDS_HELP } from './util.js';

export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  server.registerTool(
    'list_projects',
    {
      description:
        'List projects. Locator dims include id, name, archived, and project (parent project), ' +
        'e.g. "project:MyParent,archived:false". ' +
        LOCATOR_HELP,
      inputSchema: {
        locator: z.string().optional().describe(LOCATOR_HELP),
        fields: z
          .string()
          .optional()
          .describe(
            FIELDS_HELP + ' Suggested: "count,project(id,name,parentProjectId,archived)".',
          ),
        pageSize: z.number().int().min(1).optional().default(100).describe('Items per page.'),
        maxPages: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Max pages to fetch (default 1; hard cap 50 with all).'),
        all: z
          .boolean()
          .optional()
          .describe('Keep paging until no nextHref (bounded by maxPages).'),
      },
    },
    handler(async (args) => {
      const page = await paginate(client, 'projects', {
        locator: args.locator,
        fields: args.fields,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        all: args.all,
      });
      return {
        count: page.count,
        truncated: page.truncated,
        ...(page.nextStart !== undefined ? { nextStart: page.nextStart } : {}),
        items: page.items,
      };
    }),
  );

  server.registerTool(
    'get_project',
    {
      description:
        'Get one project by locator. Full detail includes buildTypes, templates and parameters. ' +
        FIELDS_HELP,
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X" or "name:Y".'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) =>
      client.get(`projects/${args.project}`, { fields: args.fields }),
    ),
  );

  if (mode === 'full') {
    server.registerTool(
      'create_project',
      {
        description:
          'Create a project, optionally under a parent project (defaults to the root project).',
        inputSchema: {
          name: z.string().describe('Name of the new project.'),
          id: z
            .string()
            .optional()
            .describe('Explicit ID; TeamCity derives one from the name when omitted.'),
          parentProjectId: z
            .string()
            .optional()
            .describe('Parent project ID; defaults to the root project (_Root).'),
          description: z.string().optional().describe('Optional description.'),
        },
      },
      handler(async (args) =>
        client.post('projects', {
          name: args.name,
          ...(args.id && { id: args.id }),
          ...(args.description && { description: args.description }),
          parentProject: {
            locator: args.parentProjectId ? `id:${args.parentProjectId}` : 'id:_Root',
          },
        }),
      ),
    );

    server.registerTool(
      'set_project_parameter',
      {
        description:
          'Set a configuration parameter on a project, optionally with a type specification ' +
          '(e.g. a password parameter).',
        inputSchema: {
          project: z.string().describe('Project locator, e.g. "id:X".'),
          name: z.string().describe('Parameter name, e.g. "env.API_KEY".'),
          value: z.string().describe('Parameter value.'),
          typeRawValue: z
            .string()
            .optional()
            .describe('Raw parameter type, e.g. "password display=\'hidden\'".'),
        },
      },
      handler(async (args) => {
        const encoded = encodeURIComponent(args.name);
        await client.put(`projects/${args.project}/parameters/${encoded}/value`, args.value);
        if (args.typeRawValue !== undefined) {
          await client.put(
            `projects/${args.project}/parameters/${encoded}/type/rawValue`,
            args.typeRawValue,
          );
        }
        return { success: true, name: args.name };
      }),
    );
  }
}
