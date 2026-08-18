/** Test mute and investigation tools. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpMode } from '../config.js';
import { paginate, type TeamCityClient } from '../teamcity/client.js';
import { FIELDS_HELP, LOCATOR_HELP, handler } from './util.js';

export function register(server: McpServer, client: TeamCityClient, mode: McpMode): void {
  server.registerTool(
    'list_mutes',
    {
      description:
        'List mutes, which silence failing tests/problems so they do not fail builds. ' +
        'Locator dims include id, test, problem, project, reporter, resolution.',
      inputSchema: {
        locator: z.string().optional().describe(LOCATOR_HELP),
        fields: z.string().optional().describe(FIELDS_HELP),
        pageSize: z.number().optional().describe('Items per page (default 100).'),
        maxPages: z.number().optional().describe('Max pages to fetch (default 1; hard cap 50 with all).'),
        all: z.boolean().optional().describe('Page until no nextHref remains (bounded by maxPages).'),
      },
    },
    handler(async (args) =>
      paginate(client, 'mutes', {
        locator: args.locator,
        fields: args.fields,
        pageSize: args.pageSize,
        maxPages: args.maxPages,
        all: args.all,
      }),
    ),
  );

  server.registerTool(
    'list_investigations',
    {
      description:
        'List investigations: assignments of failing tests/problems to a responsible user. ' +
        'Locator dims include assignee, reporter, test, problem, buildType, state.',
      inputSchema: {
        locator: z.string().optional().describe(LOCATOR_HELP),
        fields: z.string().optional().describe(FIELDS_HELP),
        pageSize: z.number().optional().describe('Items per page (default 100).'),
        maxPages: z.number().optional().describe('Max pages to fetch (default 1; hard cap 50 with all).'),
        all: z.boolean().optional().describe('Page until no nextHref remains (bounded by maxPages).'),
      },
    },
    handler(async (args) =>
      paginate(client, 'investigations', {
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
      'mute_test',
      {
        description: 'Mute a failing test by name within a project, until it is fixed.',
        inputSchema: {
          testName: z.string().describe('Fully qualified test name, as shown in test results.'),
          projectId: z.string().describe('Project id scoping the mute.'),
          comment: z.string().optional().describe('Optional note recorded on the mute assignment.'),
        },
      },
      handler(async (args) => {
        await client.post('mutes', {
          scope: { project: { id: args.projectId } },
          target: { tests: { test: [{ name: args.testName }] } },
          ...(args.comment && { assignment: { text: args.comment } }),
          resolution: { type: 'whenFixed' },
        });
        return { success: true };
      }),
    );

    server.registerTool(
      'unmute',
      {
        description: 'Delete a mute, restoring failure reporting for the test/problem.',
        inputSchema: {
          mute: z.string().describe('Mute locator, e.g. "id:12".'),
        },
      },
      handler(async (args) => {
        await client.delete(`mutes/${args.mute}`);
        return { success: true };
      }),
    );

    server.registerTool(
      'assign_investigation',
      {
        description:
          'Assign an investigation for a failing test (or any problem) within a project or ' +
          'build configuration to a user.',
        inputSchema: {
          assignee: z.string().describe('Username of the user taking the investigation.'),
          projectId: z
            .string()
            .optional()
            .describe('Project id scope. Required when buildTypeId is absent.'),
          buildTypeId: z
            .string()
            .optional()
            .describe('Build configuration id scope; takes precedence over projectId.'),
          testName: z
            .string()
            .optional()
            .describe('Test to investigate; omit to target any problem in the scope.'),
          anyProblem: z
            .boolean()
            .optional()
            .describe('Target any problem in the scope (implied when testName is omitted).'),
          state: z.enum(['TAKEN', 'FIXED']).optional().describe('Initial state (default TAKEN).'),
        },
      },
      handler(async (args) => {
        const { assignee, projectId, buildTypeId, testName, state } = args;
        if (!buildTypeId && !projectId) {
          throw new Error('Provide buildTypeId or projectId to scope the investigation.');
        }
        const scope = buildTypeId
          ? { buildType: { id: buildTypeId } }
          : { project: { id: projectId } };
        const target = testName ? { tests: { test: [{ name: testName }] } } : { anyProblem: true };
        await client.post('investigations', {
          state: state ?? 'TAKEN',
          assignee: { username: assignee },
          scope,
          target,
          resolution: { type: 'whenFixed' },
        });
        return { success: true };
      }),
    );
  }
}
