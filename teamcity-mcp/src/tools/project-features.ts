/** Project feature lifecycle tools. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpMode } from '../config.js';
import type { TeamCityClient } from '../teamcity/client.js';
import { FIELDS_HELP, handler, sanitizeSecrets } from './util.js';

export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  server.registerTool(
    'list_project_features',
    {
      description: 'List features configured on a TeamCity project.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) =>
      sanitizeSecrets(
        await client.get(`projects/${args.project}/projectFeatures`, { fields: args.fields }),
      ),
    ),
  );

  server.registerTool(
    'get_project_feature',
    {
      description: 'Get one project feature by locator.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        feature: z.string().describe('Project feature locator, e.g. "id:PROJECT_EXT_1".'),
        fields: z.string().optional().describe(FIELDS_HELP),
      },
    },
    handler(async (args) =>
      sanitizeSecrets(
        await client.get(`projects/${args.project}/projectFeatures/${args.feature}`, {
          fields: args.fields,
        }),
      ),
    ),
  );

  if (mode !== 'full') return;

  server.registerTool(
    'create_project_feature',
    {
      description: 'Create a project feature with optional ID and string properties.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        type: z.string().describe('TeamCity project feature type.'),
        id: z.string().optional().describe('Optional explicit feature ID.'),
        properties: z.record(z.string()).optional().describe('Feature property name/value map.'),
      },
    },
    handler(async (args) => {
      const values = Object.entries(args.properties ?? {})
        .filter(([name]) => /(^secure:|password|secret|token)/i.test(name))
        .map(([, value]) => value);
      return sanitizeSecrets(
        await client.post(
          `projects/${args.project}/projectFeatures`,
          {
            type: args.type,
            ...(args.id !== undefined && { id: args.id }),
            ...(args.properties !== undefined && {
              properties: {
                property: Object.entries(args.properties).map(([name, value]) => ({ name, value })),
              },
            }),
          },
          { redactValues: values },
        ),
      );
    }),
  );

  server.registerTool(
    'delete_project_feature',
    {
      description:
        'Delete a project feature after resolving it. confirmFeatureId must exactly match its ID.',
      inputSchema: {
        project: z.string().describe('Project locator, e.g. "id:X".'),
        feature: z.string().describe('Project feature locator, e.g. "id:PROJECT_EXT_1".'),
        confirmFeatureId: z.string().describe('Exact resolved feature ID to confirm deletion.'),
      },
    },
    handler(async (args) => {
      const resolved = (await client.get(
        `projects/${args.project}/projectFeatures/${args.feature}`,
        { fields: 'id,type' },
      )) as Record<string, unknown>;
      const id = typeof resolved.id === 'string' ? resolved.id : undefined;
      if (!id) throw new Error('TeamCity did not return a resolved project feature ID.');
      if (args.confirmFeatureId !== id) {
        throw new Error(`Deletion confirmation does not match resolved feature ID ${id}.`);
      }
      await client.delete(`projects/${args.project}/projectFeatures/id:${id}`);
      return { success: true, featureId: id };
    }),
  );
}
