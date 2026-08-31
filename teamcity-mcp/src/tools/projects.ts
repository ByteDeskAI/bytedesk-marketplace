// Project tools: project lifecycle and parameter management.
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

  server.registerTool(
    'list_project_parameters',
    {
      description:
        'List configuration parameters defined on a project. Password values are not requested.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
      },
    },
    handler(async (args) =>
      client.get(`projects/${args.project}/parameters`, {
        fields: 'count,property(name,own,inherited,type(rawValue))',
      }),
    ),
  );

  server.registerTool(
    'get_project_parameter',
    {
      description:
        'Get metadata for one project configuration parameter without requesting its value.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        name: z.string().describe('Parameter name, e.g. "env.API_KEY".'),
      },
    },
    handler(async (args) => {
      const encoded = encodeURIComponent(args.name);
      return client.get(`projects/${args.project}/parameters/${encoded}`, {
        fields: 'name,own,inherited,type(rawValue)',
      });
    }),
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
          'Atomically set a project configuration parameter. Supply exactly one of value or ' +
          'valueFromEnv; environment names must start with TEAMCITY_MCP_SECRET_. Secret values ' +
          'are never returned.',
        inputSchema: {
          project: z.string().describe('Project locator, e.g. "id:X".'),
          name: z.string().describe('Parameter name, e.g. "env.API_KEY".'),
          value: z
            .string()
            .optional()
            .describe('Literal value. Mutually exclusive with valueFromEnv.'),
          valueFromEnv: z
            .string()
            .regex(/^TEAMCITY_MCP_SECRET_[A-Z0-9_]+$/)
            .optional()
            .describe(
              'Server environment variable containing the value. Must start TEAMCITY_MCP_SECRET_.',
            ),
          typeRawValue: z
            .string()
            .optional()
            .describe('Raw parameter type, e.g. "password display=\'hidden\'".'),
        },
      },
      handler(async (args) => {
        const supplied = Number(args.value !== undefined) + Number(args.valueFromEnv !== undefined);
        if (supplied !== 1) {
          throw new Error('Supply exactly one of value or valueFromEnv.');
        }
        const value =
          args.valueFromEnv !== undefined ? process.env[args.valueFromEnv] : args.value;
        if (args.valueFromEnv !== undefined && !value) {
          throw new Error(`Environment variable ${args.valueFromEnv} is not set.`);
        }
        if (value === undefined) throw new Error('No project parameter value was resolved.');
        const encoded = encodeURIComponent(args.name);
        await client.put(
          `projects/${args.project}/parameters/${encoded}`,
          {
            name: args.name,
            value,
            ...(args.typeRawValue !== undefined && { type: { rawValue: args.typeRawValue } }),
          },
          { redactValues: [value] },
        );
        return { success: true, name: args.name };
      }),
    );

    server.registerTool(
      'delete_project',
      {
        description:
          'Delete a project after resolving its ID. Refuses a non-empty project unless ' +
          'allowNonEmpty is true. confirmProjectId must exactly match the resolved ID.',
        inputSchema: {
          project: z.string().describe('Project locator, e.g. "id:X".'),
          confirmProjectId: z.string().describe('Exact resolved project ID to confirm deletion.'),
          allowNonEmpty: z
            .boolean()
            .optional()
            .default(false)
            .describe('Allow deletion when the project has child projects, build types, or templates.'),
        },
      },
      handler(async (args) => {
        const resolved = (await client.get(`projects/${args.project}`, {
          fields: 'id,buildTypes(count),templates(count),projects(count)',
        })) as Record<string, unknown>;
        const id = typeof resolved.id === 'string' ? resolved.id : undefined;
        if (!id) throw new Error('TeamCity did not return a resolved project ID.');
        if (args.confirmProjectId !== id) {
          throw new Error(`Deletion confirmation does not match resolved project ID ${id}.`);
        }
        const collectionCount = (key: string): number => {
          const collection = resolved[key];
          if (!collection || typeof collection !== 'object') return 0;
          const count = (collection as Record<string, unknown>).count;
          return typeof count === 'number' ? count : 0;
        };
        const childCount =
          collectionCount('buildTypes') +
          collectionCount('templates') +
          collectionCount('projects');
        if (childCount > 0 && !args.allowNonEmpty) {
          throw new Error(
            `Project ${id} is not empty (${childCount} child resources); set allowNonEmpty to true.`,
          );
        }
        await client.delete(`projects/id:${id}`);
        return { success: true, projectId: id };
      }),
    );
  }
}
