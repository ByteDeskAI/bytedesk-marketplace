// Build configuration (build type) tools: list/get, plus create/update/parameter writes in full mode.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TeamCityClient } from '../teamcity/client.js';
import { paginate } from '../teamcity/client.js';
import type { McpMode } from '../config.js';
import { handler, LOCATOR_HELP, FIELDS_HELP } from './util.js';

export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  server.registerTool(
    'list_build_types',
    {
      description:
        'List build configurations. Locator dims include id, name, project, paused, template ' +
        '(e.g. "project:MyProject,paused:false"). ' +
        LOCATOR_HELP,
      inputSchema: {
        locator: z.string().optional().describe(LOCATOR_HELP),
        fields: z
          .string()
          .optional()
          .describe(
            FIELDS_HELP + ' Suggested: "count,buildType(id,name,projectId,paused)".',
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
      const page = await paginate(client, 'buildTypes', {
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
    'get_build_type',
    {
      description:
        'Get one build configuration by locator. Full detail includes steps, triggers and ' +
        'vcs-root-entries; steps/triggers/features/parameters also have their own sub-endpoints ' +
        'reachable via the teamcity_rest_* passthrough tools. ' +
        FIELDS_HELP,
      inputSchema: {
        buildType: z.string().describe('Build configuration locator, e.g. "id:X" or "name:Y".'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) =>
      client.get(`buildTypes/${args.buildType}`, { fields: args.fields }),
    ),
  );

  if (mode === 'full') {
    server.registerTool(
      'create_build_config',
      {
        description:
          'Create a build configuration in a project, optionally attached to a template.',
        inputSchema: {
          projectId: z.string().describe('ID of the parent project.'),
          name: z.string().describe('Name of the new build configuration.'),
          id: z
            .string()
            .optional()
            .describe('Explicit ID; TeamCity derives one from the name when omitted.'),
          description: z.string().optional().describe('Optional description.'),
          templateId: z
            .string()
            .optional()
            .describe('Template ID to base the new configuration on.'),
          copyAllSettings: z
            .boolean()
            .optional()
            .describe('Copy all settings associated with the template.'),
        },
      },
      handler(async (args) =>
        client.post(`projects/${args.projectId}/buildTypes`, {
          name: args.name,
          ...(args.id && { id: args.id }),
          ...(args.description && { description: args.description }),
          ...(args.templateId && { template: { id: args.templateId } }),
          ...(args.copyAllSettings !== undefined && {
            copyAllAssociatedSettings: args.copyAllSettings,
          }),
        }),
      ),
    );

    server.registerTool(
      'update_build_config',
      {
        description:
          'Update individual fields of a build configuration (name, description, paused, ' +
          'artifact rules) via its single-field endpoints, then return the updated configuration.',
        inputSchema: {
          buildType: z.string().describe('Build configuration locator, e.g. "id:X".'),
          name: z.string().optional().describe('New name.'),
          description: z.string().optional().describe('New description.'),
          paused: z.boolean().optional().describe('Pause (true) or unpause (false).'),
          artifactRules: z
            .string()
            .optional()
            .describe('Artifact rules, one per line (e.g. "dist => dist.zip").'),
        },
      },
      handler(async (args) => {
        if (args.name !== undefined) {
          await client.put(`buildTypes/${args.buildType}/name`, args.name);
        }
        if (args.description !== undefined) {
          await client.put(`buildTypes/${args.buildType}/description`, args.description);
        }
        if (args.paused !== undefined) {
          await client.put(`buildTypes/${args.buildType}/paused`, String(args.paused));
        }
        if (args.artifactRules !== undefined) {
          await client.put(`buildTypes/${args.buildType}/artifactRules`, args.artifactRules);
        }
        return client.get(`buildTypes/${args.buildType}`, {
          fields: 'id,name,description,paused,artifactRules',
        });
      }),
    );

    server.registerTool(
      'set_build_config_parameter',
      {
        description:
          'Set a configuration parameter on a build configuration, optionally with a type ' +
          'specification (e.g. a password parameter).',
        inputSchema: {
          buildType: z.string().describe('Build configuration locator, e.g. "id:X".'),
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
        await client.put(`buildTypes/${args.buildType}/parameters/${encoded}/value`, args.value);
        if (args.typeRawValue !== undefined) {
          await client.put(
            `buildTypes/${args.buildType}/parameters/${encoded}/type/rawValue`,
            args.typeRawValue,
          );
        }
        return { success: true, name: args.name };
      }),
    );
  }
}
